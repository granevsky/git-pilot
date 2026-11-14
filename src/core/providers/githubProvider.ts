import type { EntityRef, ProjectLabel, SyncState, User } from '../types';
import { BaseProvider, type EntityKind, ProviderError, isProviderError, labelDiff, stringLabels } from './baseProvider';

// ----- GitHub REST v3 / GraphQL v4 payloads (only the fields we use) ----------

interface GhUser {
  id: number;
  login: string;
  name: string | null;
  html_url: string;
}

interface GhLabel {
  name: string;
  description?: string | null;
}

interface GhIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  labels: Array<GhLabel | string>;
  updated_at: string;
  pull_request?: unknown;
}

interface GhPull {
  number: number;
  title: string;
  state: 'open' | 'closed';
  merged_at: string | null;
  html_url: string;
  labels: GhLabel[];
  updated_at: string;
  base: { repo: { full_name: string } };
}

interface GqlClosingPrs {
  repository: {
    id: string;
    issue: {
      closedByPullRequestsReferences: {
        nodes: Array<{
          number: number;
          title: string;
          state: 'OPEN' | 'CLOSED' | 'MERGED';
          url: string;
          updatedAt: string;
          repository: { id: string } | null;
          labels: { nodes: GhLabel[] } | null;
        } | null>;
      } | null;
    } | null;
  } | null;
}

const CLOSING_PRS_QUERY = `
query GitPilotClosingPrs($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    id
    issue(number: $number) {
      closedByPullRequestsReferences(first: 20, includeClosedPrs: false) {
        nodes {
          number
          title
          state
          url
          updatedAt
          repository { id }
          labels(first: 100) { nodes { name } }
        }
      }
    }
  }
}`;

/** GitHub.com and GitHub Enterprise Server client (REST v3 + GraphQL v4). */
export class GitHubProvider extends BaseProvider {
  readonly platform = 'github' as const;

  private get isDotCom(): boolean {
    const host = new URL(this.webBaseUrl).hostname;
    return host === 'github.com' || host === 'www.github.com' || host === 'api.github.com';
  }

  protected get apiBaseUrl(): string {
    return this.isDotCom ? 'https://api.github.com' : `${this.webBaseUrl}/api/v3`;
  }

  private get graphqlUrl(): string {
    return this.isDotCom ? 'https://api.github.com/graphql' : `${this.webBaseUrl}/api/graphql`;
  }

  private get owner(): string {
    return this.projectPath.split('/')[0];
  }

  private get repoName(): string {
    return this.projectPath.split('/').slice(1).join('/');
  }

  private get repoRef(): string {
    return `${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repoName)}`;
  }

  protected authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async getCurrentUser(): Promise<User> {
    const u = await this.get<GhUser>('/user');
    return { id: u.id, username: u.login, name: u.name ?? u.login, webUrl: u.html_url };
  }

  async getSyncState(issueNumber: number, branchName: string): Promise<SyncState | null> {
    let issue: GhIssue;
    try {
      issue = await this.get<GhIssue>(`/repos/${this.repoRef}/issues/${issueNumber}`);
    } catch (err) {
      if (isProviderError(err, 'notFound')) {
        this.logger.info(`[github] Issue #${issueNumber} not found in ${this.projectPath}`);
        return null;
      }
      throw err;
    }
    if (issue.pull_request) {
      this.logger.info(`[github] #${issueNumber} is a pull request, not an issue — skipping.`);
      return null;
    }

    const [byBranch, closing, labels] = await Promise.all([
      branchName
        ? this.paginate<GhPull>(`/repos/${this.repoRef}/pulls`, {
            state: 'open',
            head: `${this.owner}:${branchName}`,
            per_page: 100,
          })
        : Promise.resolve([] as GhPull[]),
      // Linked "closing" PRs (e.g. "Fixes #142") may live on a differently named branch.
      this.fetchClosingPullRequests(issueNumber).catch((err: unknown) => {
        this.logger.warn(`[github] GraphQL closing PR lookup failed: ${String(err)}`);
        return [] as EntityRef[];
      }),
      this.fetchStatusLabels(),
    ]);

    // byBranch comes from this repository's own /pulls endpoint; closing PRs are already restricted
    // to this repository in fetchClosingPullRequests.
    const unique = new Map<number, EntityRef>();
    for (const pr of byBranch) {
      if (pr?.state === 'open' && Number.isSafeInteger(pr.number)) {
        unique.set(pr.number, this.pullToEntity(pr));
      }
    }
    for (const entity of closing) {
      if (!unique.has(entity.id)) {
        unique.set(entity.id, entity);
      }
    }

    return this.buildSyncState(this.issueToEntity(issue), [...unique.values()], labels);
  }

  async getAssignedIssues(labels?: string[]): Promise<EntityRef[]> {
    const me = await this.getCurrentUser();
    const issues = await this.paginate<GhIssue>(`/repos/${this.repoRef}/issues`, {
      assignee: me.username,
      state: 'open',
      labels: labels?.join(','),
      per_page: 100,
    });
    return issues.filter((i) => !i.pull_request).map((i) => this.issueToEntity(i));
  }

  async getLabels(): Promise<ProjectLabel[]> {
    return this.toProjectLabels(await this.paginate<GhLabel>(`/repos/${this.repoRef}/labels`, { per_page: 100 }));
  }

  protected async writeLabels(entity: EntityRef, _kind: EntityKind, currentLabels: string[], nextLabels: string[]): Promise<string[]> {
    // PRs share the issue labels endpoint on GitHub. Writes only ever go to the current repository
    // (PRs of other repositories are filtered out in getSyncState).
    const base = `/repos/${this.repoRef}/issues/${entity.id}/labels`;
    const toNames = (data: unknown) => (Array.isArray(data) ? stringLabels(data.map((l: GhLabel | null) => l?.name)) : null);

    // Minimal diff instead of PUT (replace-all), so concurrent edits to other labels survive.
    const { add, remove } = labelDiff(currentLabels, nextLabels);
    // A label name becomes a path segment. URL parsing resolves "." / ".." as dot segments (encoding
    // can't prevent it), which would turn `DELETE …/labels/.` into `DELETE …/labels` = remove ALL labels.
    const unsafe = remove.find((name) => name === '.' || name === '..');
    if (unsafe !== undefined) {
      throw new ProviderError(`Cannot remove the label "${unsafe}" through the GitHub REST API (its name is a path dot segment)`, 'invalidResponse');
    }
    let labels: string[] | null = null;
    for (const name of remove) {
      try {
        labels = toNames((await this.request<GhLabel[]>('DELETE', `${base}/${encodeURIComponent(name)}`)).data) ?? labels;
      } catch (err) {
        if (!isProviderError(err, 'notFound')) {
          throw err; // 404 = already removed: nothing to do
        }
      }
    }
    if (add.length) {
      labels = toNames((await this.request<GhLabel[]>('POST', base, { body: { labels: add } })).data) ?? labels;
    }
    return labels ?? nextLabels;
  }

  private async fetchStatusLabels(): Promise<string[]> {
    const labels = await this.getLabels();
    return this.filterStatusLabels(labels.map((l) => l.name));
  }

  private async fetchClosingPullRequests(issueNumber: number): Promise<EntityRef[]> {
    const data = await this.graphql<GqlClosingPrs>(CLOSING_PRS_QUERY, {
      owner: this.owner,
      name: this.repoName,
      number: issueNumber,
    });
    const repoId = data.repository?.id;
    const nodes = data.repository?.issue?.closedByPullRequestsReferences?.nodes ?? [];
    return nodes
      // Only PRs of this repository (compared by node id, so renames don't matter): a PR elsewhere can
      // reference the issue too, and must neither drive the status nor receive writes.
      .filter((n): n is NonNullable<typeof n> => !!n && n.state === 'OPEN' && !!repoId && n.repository?.id === repoId)
      .filter((n) => Number.isSafeInteger(n.number))
      .map((n) => {
        const labels = stringLabels((n.labels?.nodes ?? []).map((l) => l?.name));
        return {
          id: n.number,
          title: String(n.title ?? ''),
          state: 'opened' as const,
          webUrl: this.safeWebUrl(n.url, `${this.projectPath}/pull/${n.number}`),
          allLabels: labels,
          statusLabel: this.toStatus(labels),
          updatedAt: String(n.updatedAt ?? ''),
          projectRef: this.projectPath,
        };
      });
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.request<{ data?: T; errors?: Array<{ message: string }> }>('POST', this.graphqlUrl, {
      body: { query, variables },
    });
    if (res.data.errors?.length) {
      throw new ProviderError(`GraphQL: ${res.data.errors.map((e) => e.message).join('; ')}`, 'http', res.status);
    }
    if (!res.data.data) {
      throw new ProviderError('GraphQL: empty response', 'invalidResponse', res.status);
    }
    return res.data.data;
  }

  private issueToEntity(raw: GhIssue): EntityRef {
    const labels = stringLabels((Array.isArray(raw.labels) ? raw.labels : []).map((l) => (typeof l === 'string' ? l : l?.name)));
    return {
      id: raw.number,
      title: String(raw.title ?? ''),
      state: raw.state === 'open' ? 'opened' : 'closed',
      webUrl: this.safeWebUrl(raw.html_url, `${this.projectPath}/issues/${raw.number}`),
      allLabels: labels,
      statusLabel: this.toStatus(labels),
      updatedAt: raw.updated_at,
      projectRef: this.projectPath,
    };
  }

  private pullToEntity(raw: GhPull): EntityRef {
    const labels = stringLabels((Array.isArray(raw.labels) ? raw.labels : []).map((l) => l?.name));
    return {
      id: raw.number,
      title: String(raw.title ?? ''),
      state: raw.state === 'open' ? 'opened' : raw.merged_at ? 'merged' : 'closed',
      webUrl: this.safeWebUrl(raw.html_url, `${this.projectPath}/pull/${raw.number}`),
      allLabels: labels,
      statusLabel: this.toStatus(labels),
      updatedAt: String(raw.updated_at ?? ''),
      projectRef: this.projectPath,
    };
  }
}
