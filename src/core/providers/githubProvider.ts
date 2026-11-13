import type { EntityRef, SyncState, User } from '../types';
import { BaseProvider, type EntityKind, ProviderError, isProviderError, stringLabels } from './baseProvider';

// ----- GitHub REST v3 / GraphQL v4 payloads (only the fields we use) ----------

interface GhUser {
  id: number;
  login: string;
  name: string | null;
  html_url: string;
}

interface GhLabel {
  name: string;
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
    issue: {
      closedByPullRequestsReferences: {
        nodes: Array<{
          number: number;
          title: string;
          state: 'OPEN' | 'CLOSED' | 'MERGED';
          url: string;
          updatedAt: string;
          repository: { nameWithOwner: string };
          labels: { nodes: GhLabel[] } | null;
        } | null>;
      } | null;
    } | null;
  } | null;
}

const CLOSING_PRS_QUERY = `
query GitPilotClosingPrs($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      closedByPullRequestsReferences(first: 20, includeClosedPrs: false) {
        nodes {
          number
          title
          state
          url
          updatedAt
          repository { nameWithOwner }
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

    const unique = new Map<string, EntityRef>();
    for (const pr of byBranch) {
      if (pr.state === 'open') {
        const entity = this.pullToEntity(pr);
        unique.set(`${entity.projectRef}#${entity.id}`, entity);
      }
    }
    for (const entity of closing) {
      const key = `${entity.projectRef}#${entity.id}`;
      if (!unique.has(key)) {
        unique.set(key, entity);
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

  protected async writeLabels(entity: EntityRef, _kind: EntityKind, _currentLabels: string[], nextLabels: string[]): Promise<string[]> {
    // PRs share the issue labels endpoint on GitHub. projectRef comes from the server, so only a
    // strict `owner/repo` shape may enter the path.
    const ref = entity.projectRef;
    const repo = ref && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(ref) && !ref.split('/').some((s) => s === '.' || s === '..')
      ? ref.split('/').map(encodeURIComponent).join('/')
      : this.repoRef;
    const res = await this.request<GhLabel[]>('PUT', `/repos/${repo}/issues/${entity.id}/labels`, {
      body: { labels: nextLabels },
    });
    return Array.isArray(res.data) ? stringLabels(res.data.map((l) => l?.name)) : nextLabels;
  }

  private async fetchStatusLabels(): Promise<string[]> {
    const labels = await this.paginate<GhLabel>(`/repos/${this.repoRef}/labels`, { per_page: 100 });
    return this.filterStatusLabels(labels.map((l) => l.name));
  }

  private async fetchClosingPullRequests(issueNumber: number): Promise<EntityRef[]> {
    const data = await this.graphql<GqlClosingPrs>(CLOSING_PRS_QUERY, {
      owner: this.owner,
      name: this.repoName,
      number: issueNumber,
    });
    const nodes = data.repository?.issue?.closedByPullRequestsReferences?.nodes ?? [];
    return nodes
      .filter((n): n is NonNullable<typeof n> => !!n && n.state === 'OPEN')
      .map((n) => {
        const labels = stringLabels((n.labels?.nodes ?? []).map((l) => l?.name));
        return {
          id: n.number,
          title: String(n.title ?? ''),
          state: 'opened' as const,
          webUrl: this.safeWebUrl(n.url, `${n.repository?.nameWithOwner ?? this.projectPath}/pull/${n.number}`),
          allLabels: labels,
          statusLabel: this.toStatus(labels),
          updatedAt: n.updatedAt,
          projectRef: n.repository.nameWithOwner,
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
      updatedAt: raw.updated_at,
      projectRef: raw.base?.repo?.full_name ?? this.projectPath,
    };
  }
}
