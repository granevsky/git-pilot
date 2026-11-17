import { hasMediaLinks } from '../format';
import type { CommentPage, EntityComment, EntityRef, EntityState, ProjectLabel, SyncState, User } from '../types';
import { BaseProvider, type EntityKind, type HttpResponse, ProviderError, isProviderError, labelDiff, statusPrefixBase, stringLabels } from './baseProvider';

/** Upper bound for one "load comments" call: system notes are skipped client-side, so several API pages may be needed. */
const MAX_NOTE_PAGES_PER_LOAD = 5;
const MAX_NOTE_PAGE = 100_000;

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
  description?: string | null;
}

interface GlNote {
  id: number;
  body: string;
  author?: { username?: string; name?: string } | null;
  created_at: string;
  updated_at: string;
  /** `true` for automatic entries: label / weight / assignee changes, "mentioned in commit", … */
  system?: boolean;
  internal?: boolean;
  confidential?: boolean;
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

    // Only MRs of this very project. related_merge_requests also returns MRs of *other* projects that
    // merely mention the issue — anyone can create those, so they must neither drive the status nor
    // receive writes made with the user's token.
    const unique = new Map<number, GlMergeRequest>();
    for (const mr of [...byBranch, ...related]) {
      if (mr?.state === 'opened' && mr.project_id === issue.project_id && Number.isSafeInteger(mr.iid)) {
        unique.set(mr.iid, mr);
      } else if (mr && mr.project_id !== issue.project_id) {
        this.logger.debug(`[gitlab] Ignoring MR !${String(mr.iid)} of another project (${String(mr.project_id)}).`);
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

  async getLabels(): Promise<ProjectLabel[]> {
    const labels = await this.paginate<GlLabel>(`/projects/${this.projectId}/labels`, {
      include_ancestor_groups: true,
      per_page: 100,
    });
    return this.toProjectLabels(labels);
  }

  async getComments(entity: EntityRef, kind: EntityKind, limit: number, cursor?: string | null): Promise<CommentPage> {
    const path = this.notesPath(entity, kind);
    // The cursor is the next API page number. It comes back from our own previous call, but is still validated.
    let page = 1;
    if (cursor) {
      page = Number(cursor);
      if (!Number.isSafeInteger(page) || page < 1 || page > MAX_NOTE_PAGE) {
        throw new ProviderError('Invalid comments cursor', 'invalidRequest');
      }
    }
    const wanted = Math.max(1, Math.floor(limit));
    const perPage = Math.min(100, Math.max(20, wanted * 2));
    const comments: EntityComment[] = [];
    let next: number | null = page;

    // `sort=desc` = newest first. The notes API cannot exclude system notes, so skip them here and keep
    // reading pages until enough real comments are collected.
    for (let i = 0; next !== null && i < MAX_NOTE_PAGES_PER_LOAD && comments.length < wanted; i++) {
      const res: HttpResponse<GlNote[]> = await this.request<GlNote[]>('GET', path, {
        query: { order_by: 'created_at', sort: 'desc', per_page: perPage, page: next },
      });
      for (const note of Array.isArray(res.data) ? res.data : []) {
        const comment = note && !note.system ? this.toComment(note, entity) : null;
        if (comment) {
          comments.push(comment);
        }
      }
      const following: number = Number(res.headers.get('x-next-page'));
      next = Number.isSafeInteger(following) && following > page && following <= MAX_NOTE_PAGE ? following : null;
      page = next ?? page;
    }
    return { comments, nextCursor: next === null ? null : String(next) };
  }

  async addComment(entity: EntityRef, kind: EntityKind, body: string): Promise<EntityComment> {
    const path = this.notesPath(entity, kind);
    const text = this.assertCommentBody(body);
    const res = await this.request<GlNote>('POST', path, { body: { body: text } });
    const comment = res.data ? this.toComment(res.data, entity) : null;
    if (!comment) {
      throw new ProviderError('Unexpected response while posting the comment', 'invalidResponse', res.status);
    }
    this.logger.info(`[gitlab] Commented on ${kind === 'issue' ? 'issue' : 'MR'} ${entity.id} (${text.length} chars)`);
    return comment;
  }

  private notesPath(entity: EntityRef, kind: EntityKind): string {
    const id = this.assertEntityId(entity, kind);
    return `/projects/${this.projectId}/${kind === 'issue' ? 'issues' : 'merge_requests'}/${id}/notes`;
  }

  private toComment(raw: GlNote, entity: EntityRef): EntityComment | null {
    const id = this.commentId(raw.id);
    if (!id) {
      return null;
    }
    const body = typeof raw.body === 'string' ? raw.body : '';
    let webUrl: string | null = null;
    try {
      // `entity.webUrl` has already passed `safeWebUrl`; only the fragment is added.
      const url = new URL(entity.webUrl);
      url.hash = `note_${id}`;
      webUrl = url.href;
    } catch {
      // no permalink
    }
    const author = raw.author?.username ?? raw.author?.name;
    return {
      id,
      author: typeof author === 'string' && author ? author : 'ghost',
      body,
      createdAt: String(raw.created_at ?? ''),
      updatedAt: String(raw.updated_at ?? raw.created_at ?? ''),
      webUrl,
      hasMedia: hasMediaLinks(body),
      isPrivate: raw.internal === true || raw.confidential === true,
    };
  }

  protected async writeLabels(entity: EntityRef, kind: EntityKind, currentLabels: string[], nextLabels: string[]): Promise<string[]> {
    // add_labels/remove_labels is a minimal diff, so concurrent edits to other labels are not clobbered.
    const { add, remove } = labelDiff(currentLabels, nextLabels);

    // Writes only ever go to the current project (foreign MRs are filtered out in getSyncState).
    const resource = kind === 'issue' ? 'issues' : 'merge_requests';
    const res = await this.request<GlIssue | GlMergeRequest>('PUT', `/projects/${this.projectId}/${resource}/${entity.id}`, {
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
