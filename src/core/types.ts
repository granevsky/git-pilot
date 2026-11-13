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
   * Provider-specific project reference the entity belongs to (GitLab project id,
   * GitHub `owner/repo`). Needed because related MRs may live in another project (forks).
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
  isSynced: boolean;
  effectiveStatus: string | null;
}

export interface GitPlatformProvider {
  readonly platform: Platform;
  readonly host: string;
  readonly projectPath: string;
  readonly webBaseUrl: string;

  getCurrentUser(): Promise<User>;
  getSyncState(issueNumber: number, branchName: string): Promise<SyncState | null>;
  setUnifiedStatus(state: SyncState, newStatusLabel: string): Promise<SyncState>;

  // Extensibility hooks for future modules:
  getAssignedIssues?(labels?: string[]): Promise<EntityRef[]>;
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
