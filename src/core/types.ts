import type * as vscode from 'vscode';
import type { EventBus } from './eventBus';
import type { Logger } from './logger';
import type { SettingsManager } from './config/settings';
import type { SecretsManager } from './config/secrets';
import type { GitService } from './git/gitService';
import type { ProviderManager } from './providers/providerManager';

// ---------------------------------------------------------------------------
// Platform / repository models
// ---------------------------------------------------------------------------

export type Platform = 'gitlab' | 'github';

export type EntityState = 'opened' | 'closed' | 'merged';

/** Which side an EntityRef is on: the Issue or one of its MRs/PRs. */
export type EntityKind = 'issue' | 'mr';

/** A parsed git remote (`origin` by default). */
export interface RemoteInfo {
  /** Remote name, e.g. `origin`. */
  name: string;
  /** Raw fetch URL as configured in git. */
  url: string;
  /** Hostname without port, e.g. `gitlab.company.com`. */
  hostname: string;
  /** Full project path including nested GitLab subgroups, e.g. `group/sub/repo`. */
  projectPath: string;
  /** Everything before the last path segment (GitHub owner / GitLab namespace). */
  owner: string;
  /** Last path segment (repository name). */
  repo: string;
  /** Best-effort web base URL derived from the remote, e.g. `https://gitlab.company.com`. */
  webBaseUrl: string;
}

export interface RepoContext {
  rootUri: vscode.Uri;
  /** Current branch name, or `null` for detached HEAD / unborn branch. */
  branch: string | null;
  remote: RemoteInfo | null;
}

/** An open git repository, as offered by "Select Repository…". */
export interface RepositoryInfo {
  /** Root URI as a string — the identity used for pinning. */
  key: string;
  /** Folder name of the repository root. */
  name: string;
  branch: string | null;
  /** `group/repo` from the remote, when it could be parsed. */
  projectPath: string | null;
  /** Local path of the root (display only). */
  path: string;
}

/** What the sidebar shows about the active repository so the user can tell why a section looks the way it does. */
export interface RepoSummary {
  /** Root URI string (same as `RepositoryInfo.key`). */
  key: string;
  name: string;
  branch: string | null;
  /** The repository was chosen with "Select Repository…" instead of following the active editor. */
  pinned: boolean;
  /** Number of open repositories. */
  repoCount: number;
}

export interface User {
  id: number;
  username: string;
  name: string;
  webUrl: string;
}

/** Issue, MR or PR as seen by Git Pilot. */
export interface EntityRef {
  /** IID in GitLab, Number in GitHub. */
  id: number;
  title: string;
  state: EntityState;
  webUrl: string;
  allLabels: string[];
  statusLabel: string | null;
  /** ISO timestamp of the last update; used to determine the "latest" MR/PR. */
  updatedAt: string;
  /**
   * Provider-specific project reference (GitLab project id, GitHub `owner/repo`). Only entities of
   * the current project are ever returned: MRs/PRs that live in other projects are dropped.
   */
  projectRef?: string;
}

export type Issue = EntityRef;
export type PullRequest = EntityRef;

export interface SyncState {
  platform: Platform;
  host: string;
  projectPath: string;
  issue: EntityRef;
  /** Open MRs/PRs linked to the issue or branch, most recently updated first. */
  mergeRequests: EntityRef[];
  availableStatusLabels: string[];
}

/** A label defined in the project (and, on GitLab, its ancestor groups). */
export interface ProjectLabel {
  name: string;
  description: string;
}

/** A user-written comment on an Issue or MR/PR (system notes — label changes, weight, … — are never included). */
export interface EntityComment {
  /** Numeric id as a digit string (validated by the provider before it reaches a URL or a tree). */
  id: string;
  /** Login of the author (`ghost` when the account is gone). */
  author: string;
  /** Raw Markdown body. Untrusted: never render it as HTML or trusted Markdown. */
  body: string;
  createdAt: string;
  updatedAt: string;
  /** Permalink to the comment on the web page (already passed through `safeWebUrl`), if known. */
  webUrl: string | null;
  /** The body references images / videos / uploads (they are viewed in the browser, not in VS Code). */
  hasMedia: boolean;
  /** GitLab internal note (visible to project members only). */
  isPrivate: boolean;
}

/** One page of comments, newest first. */
export interface CommentPage {
  comments: EntityComment[];
  /** Opaque cursor for the next (older) page, or `null` when there are no more comments. */
  nextCursor: string | null;
}

export interface GitPlatformProvider {
  readonly platform: Platform;
  readonly host: string;
  readonly projectPath: string;
  readonly webBaseUrl: string;

  getCurrentUser(): Promise<User>;
  getSyncState(issueNumber: number, branchName: string): Promise<SyncState | null>;
  setUnifiedStatus(state: SyncState, newStatusLabel: string): Promise<SyncState>;
  /**
   * Adds/removes labels on one Issue or MR/PR as a minimal diff (other labels and concurrent edits
   * are kept). Labels must already exist in the project. Returns the entity with server-reported labels.
   */
  editLabels(entity: EntityRef, kind: EntityKind, add: readonly string[], remove: readonly string[]): Promise<EntityRef>;

  // Extensibility hooks for future modules:
  getAssignedIssues?(labels?: string[]): Promise<EntityRef[]>;
  /** Every label available in the project (GitLab: including ancestor group labels). */
  getLabels?(): Promise<ProjectLabel[]>;
  /**
   * User comments of one Issue or MR/PR, newest first, without system notes. Returns at least
   * `limit` comments when that many exist (providers may return a few more). Pass the previous
   * page's `nextCursor` to continue with older comments.
   */
  getComments?(entity: EntityRef, kind: EntityKind, limit: number, cursor?: string | null): Promise<CommentPage>;
  /** Posts a new comment on one Issue or MR/PR of the current project. */
  addComment?(entity: EntityRef, kind: EntityKind, body: string): Promise<EntityComment>;
}

// ---------------------------------------------------------------------------
// Module contract
// ---------------------------------------------------------------------------

export interface PilotContext {
  extensionContext: vscode.ExtensionContext;
  eventBus: EventBus;
  logger: Logger;
  settings: SettingsManager;
  secrets: SecretsManager;
  gitService: GitService;
  providerManager: ProviderManager;
}

export interface PilotModule extends vscode.Disposable {
  readonly id: string;
  activate(ctx: PilotContext): Promise<void> | void;
}

export type PilotModuleFactory = () => PilotModule;
