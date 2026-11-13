import type { EntityRef, EntityState, SyncState, User } from '../types';
import { BaseProvider, type EntityKind, isProviderError, statusPrefixBase, stringLabels } from './baseProvider';

// ----- GitLab REST v4 payloads (only the fields we use) -----------------------

interface GlUser {
  id: number;
  username: string;
  name: string;
  web_url: string;
}

interface GlIssue {
  iid: number;
  project_id: number;
  title: string;
  state: 'opened' | 'closed';
  web_url: string;
  labels: string[];
  updated_at: string;
}

interface GlMergeRequest {
  iid: number;
  project_id: number;
  title: string;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  web_url: string;
  labels: string[];
  updated_at: string;
  source_branch: string;
}

interface GlLabel {
  name: string;
}

/**
 * GitLab Free (CE) & Premium (EE) client. Works with both regular `status:` labels
 * and Premium scoped `status::` labels (status exclusivity is enforced client-side
 * anyway, so CE behaves exactly like EE).
 */
export class GitLabProvider extends BaseProvider {
  readonly platform = 'gitlab' as const;

  protected get apiBaseUrl(): string {
    return `${this.webBaseUrl}/api/v4`;
  }

  private get projectId(): string {
    return encodeURIComponent(this.projectPath);
  }

  protected authHeaders(): Record<string, string> {
    return { 'PRIVATE-TOKEN': this.token };
  }

  async getCurrentUser(): Promise<User> {
    const u = await this.get<GlUser>('/user');
    return { id: u.id, username: u.username, name: u.name, webUrl: u.web_url };
  }

  async getSyncState(issueNumber: number, branchName: string): Promise<SyncState | null> {
    let issue: GlIssue;
    try {
      issue = await this.get<GlIssue>(`/projects/${this.projectId}/issues/${issueNumber}`);
    } catch (err) {
      if (isProviderError(err, 'notFound')) {
        this.logger.info(`[gitlab] Issue #${issueNumber} not found in ${this.projectPath}`);
        return null;
      }
      throw err;
    }

    const [related, byBranch, labels] = await Promise.all([
      this.paginate<GlMergeRequest>(`/projects/${this.projectId}/issues/${issueNumber}/related_merge_requests`, { per_page: 100 }).catch(
        (err: unknown) => {
          // Not fatal: endpoint can be restricted on some instances.
          this.logger.warn(`[gitlab] related_merge_requests failed: ${String(err)}`);
          return [] as GlMergeRequest[];
        },
      ),
      branchName
        ? this.paginate<GlMergeRequest>(`/projects/${this.projectId}/merge_requests`, {
            state: 'opened',
            source_branch: branchName,
            per_page: 100,
          })
        : Promise.resolve([] as GlMergeRequest[]),
      this.fetchStatusLabels(),
    ]);

    const unique = new Map<string, GlMergeRequest>();
    for (const mr of [...byBranch, ...related]) {
      if (mr.state === 'opened') {
        unique.set(`${mr.project_id}!${mr.iid}`, mr);
      }
    }

    return this.buildSyncState(
      this.toEntity(issue),
      [...unique.values()].map((mr) => this.toEntity(mr)),
      labels,
    );
  }

  async getAssignedIssues(labels?: string[]): Promise<EntityRef[]> {
    const issues = await this.paginate<GlIssue>(`/projects/${this.projectId}/issues`, {
      scope: 'assigned_to_me',
      state: 'opened',
      labels: labels?.join(','),
      per_page: 100,
    });
    return issues.map((i) => this.toEntity(i));
  }

  protected async writeLabels(entity: EntityRef, kind: EntityKind, currentLabels: string[], nextLabels: string[]): Promise<string[]> {
    // add_labels/remove_labels is a minimal diff, so concurrent edits to other labels are not clobbered.
    const current = new Set(currentLabels.map((l) => l.toLowerCase()));
    const next = new Set(nextLabels.map((l) => l.toLowerCase()));
    const add = nextLabels.filter((l) => !current.has(l.toLowerCase()));
    const remove = currentLabels.filter((l) => !next.has(l.toLowerCase()));

    // projectRef comes from the server; only numeric GitLab project ids may enter the path.
    const project = entity.projectRef && /^\d+$/.test(entity.projectRef) ? entity.projectRef : this.projectId;
    const resource = kind === 'issue' ? 'issues' : 'merge_requests';
    const res = await this.request<GlIssue | GlMergeRequest>('PUT', `/projects/${project}/${resource}/${entity.id}`, {
      body: {
        ...(add.length ? { add_labels: add.join(',') } : {}),
        ...(remove.length ? { remove_labels: remove.join(',') } : {}),
      },
    });
    return Array.isArray(res.data?.labels) ? stringLabels(res.data.labels) : nextLabels;
  }

  private async fetchStatusLabels(): Promise<string[]> {
    const labels = await this.paginate<GlLabel>(`/projects/${this.projectId}/labels`, {
      search: statusPrefixBase(this.labelPrefix),
      include_ancestor_groups: true,
      per_page: 100,
    });
    return this.filterStatusLabels(labels.map((l) => l.name));
  }

  private toEntity(raw: GlIssue | GlMergeRequest): EntityRef {
    const state: EntityState = raw.state === 'opened' || raw.state === 'merged' ? raw.state : 'closed';
    const isMr = 'source_branch' in raw;
    const labels = stringLabels(raw.labels);
    return {
      id: raw.iid,
      title: String(raw.title ?? ''),
      state,
      webUrl: this.safeWebUrl(raw.web_url, `${this.projectPath}/-/${isMr ? 'merge_requests' : 'issues'}/${raw.iid}`),
      allLabels: labels,
      statusLabel: this.toStatus(labels),
      updatedAt: String(raw.updated_at ?? ''),
      projectRef: String(raw.project_id),
    };
  }
}
