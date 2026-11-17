import * as vscode from 'vscode';
import { extractIssueNumber } from '../../core/git/gitService';
import { errorMessage } from '../../core/logger';
import { exclusiveRemovals } from '../../core/labels';
import { isProviderError, isStatusLabel } from '../../core/providers/baseProvider';
import type { EntityRef, GitPlatformProvider, PilotContext, RepoContext, SyncState } from '../../core/types';
import type { SyncViewState } from './statusBarUi';
import { type EntityChange, entityKey, findEntity } from './syncPlan';

export type SyncReason = 'activation' | 'branch' | 'focus' | 'poll' | 'manual' | 'config' | 'auth' | 'recover';

const FOCUS_THROTTLE_MS = 30_000;
const TRIGGER_DEBOUNCE_MS = 300;

/** One label change on one Issue/MR. */
export interface LabelEdit {
  entity: string;
  add: string[];
  remove: string[];
}

/**
 * Drives the "Labels" section data: listens to triggers (activation, branch switch, window focus,
 * read-only polling), fetches the SyncState and publishes a view model for the UI.
 *
 * Nothing is ever written automatically. Writes happen only on explicit user actions: changing the
 * status, editing labels, or a confirmed "sync from MR/PR" (`applyChanges`).
 *
 * All network work runs through a single exclusive queue so refreshes and edits never interleave.
 */
export class SyncEngine implements vscode.Disposable {
  private readonly _onDidChangeView = new vscode.EventEmitter<SyncViewState>();
  readonly onDidChangeView = this._onDidChangeView.event;

  private view: SyncViewState = { kind: 'hidden', reason: 'Starting' };
  private lastState: SyncState | null = null;
  private lastSyncAt = 0;

  private lock: Promise<unknown> = Promise.resolve();
  private queuedSync: Promise<void> | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private started = false;

  constructor(private readonly ctx: PilotContext) {}

  get currentView(): SyncViewState {
    return this.view;
  }

  get currentState(): SyncState | null {
    return this.lastState;
  }

  // -------------------------------------------------------------------------
  // Lifecycle & triggers
  // -------------------------------------------------------------------------

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    const { eventBus } = this.ctx;

    this.disposables.push(
      eventBus.onDidChangeBranch((e) => {
        if (this.lastState && e.previousBranch !== e.branch) {
          this.lastState = null;
        }
        this.schedule('branch');
      }),
      eventBus.onDidChangeAuth(() => this.schedule('auth')),
      eventBus.onDidChangeConfig((e) => {
        if (e.affectsConfiguration('gitPilot.statusSync.refreshInterval')) {
          this.restartPolling();
        }
        this.schedule('config');
      }),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused && Date.now() - this.lastSyncAt >= FOCUS_THROTTLE_MS) {
          this.schedule('focus');
        }
      }),
    );
    this.restartPolling();
    this.schedule('activation', 0);
  }

  private restartPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    const seconds = this.ctx.settings.statusSync.refreshInterval;
    if (seconds > 0) {
      this.pollTimer = setInterval(() => {
        // Don't burn API quota while VS Code is in the background; focus triggers a catch-up refresh.
        if (vscode.window.state.focused) {
          void this.requestSync('poll');
        }
      }, seconds * 1000);
    }
  }

  /** Debounced trigger — coalesces bursts of git/config events. */
  private schedule(reason: SyncReason, delay = TRIGGER_DEBOUNCE_MS): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.requestSync(reason);
    }, delay);
  }

  private clearTimers(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Public operations
  // -------------------------------------------------------------------------

  /** Queues a (read-only) refresh; concurrent requests while one is waiting are coalesced. */
  requestSync(reason: SyncReason): Promise<void> {
    if (this.queuedSync) {
      return this.queuedSync;
    }
    const run = this.exclusive(async () => {
      this.queuedSync = undefined;
      await this.doSync(reason);
    });
    this.queuedSync = run;
    return run;
  }

  /** Refreshes now and returns the fresh state (`null` when there is none; the view explains why). */
  async refreshState(): Promise<SyncState | null> {
    await this.exclusive(() => this.doSync('manual'));
    return this.lastState;
  }

  /** Applies `label` to the issue and every open MR/PR (manual status selection). */
  applyStatus(label: string): Promise<void> {
    return this.exclusive(async () => {
      const resolved = await this.resolveTarget();
      if (!resolved) {
        void vscode.window.showWarningMessage('Git Pilot: no linked issue for the current branch.');
        return;
      }
      const { provider, branch, issueNumber, repo } = resolved;
      this.setView({ kind: 'syncing', issueNumber });
      try {
        // Re-fetch so labels are computed from fresh data, not a possibly stale cache.
        const fresh = await provider.getSyncState(issueNumber, branch);
        if (!fresh) {
          this.lastState = null;
          this.setView({ kind: 'issueNotFound', issueNumber, projectPath: provider.projectPath });
          return;
        }
        const updated = await provider.setUnifiedStatus(fresh, label);
        if (!this.isCurrent(repo)) {
          return;
        }
        this.commit(updated);
        this.ctx.logger.info(`Status of #${issueNumber} set to "${label}" (manual).`);
        this.flash(`$(check) Git Pilot: #${issueNumber} → ${label}`);
      } catch (err) {
        this.handleError(err, issueNumber, true);
      }
    });
  }

  /**
   * Applies label edits to the Issue / MRs of the current branch (fresh state is fetched first).
   * Status labels are never touched here — they go through `applyStatus`. Adding a label of a group
   * (`app:*`) replaces the entity's other label of that group. Returns `false` if nothing was written.
   */
  editLabels(edits: readonly LabelEdit[]): Promise<boolean> {
    return this.exclusive(async () => {
      const resolved = await this.resolveTarget();
      if (!resolved) {
        void vscode.window.showWarningMessage('Git Pilot: no linked issue for the current branch.');
        return false;
      }
      const { provider, branch, issueNumber, repo } = resolved;
      const { labelPrefix: prefix } = this.ctx.settings.statusSync;
      const masks = this.ctx.settings.labels.groups;
      const notStatus = (l: string) => !isStatusLabel(l, prefix);
      try {
        const fresh = await provider.getSyncState(issueNumber, branch);
        if (!fresh) {
          this.lastState = null;
          this.setView({ kind: 'issueNotFound', issueNumber, projectPath: provider.projectPath });
          return false;
        }
        const updates = new Map<string, EntityRef>();
        await Promise.all(
          edits.map(async (edit) => {
            const found = findEntity(fresh, edit.entity);
            if (!found) {
              return;
            }
            const add = edit.add.filter(notStatus);
            const remove = [...edit.remove, ...exclusiveRemovals(found.entity.allLabels, add, masks)].filter(notStatus);
            updates.set(edit.entity, await provider.editLabels(found.entity, found.kind, add, remove));
          }),
        );
        if (!this.isCurrent(repo)) {
          return false;
        }
        this.commit(this.withUpdates(fresh, updates));
        return updates.size > 0;
      } catch (err) {
        this.handleError(err, issueNumber, true);
        return false;
      }
    });
  }

  /**
   * Writes exactly the changes the user confirmed (computed from `state` by `buildSyncPlan`) as
   * minimal diffs, so labels edited elsewhere in the meantime are kept. Refuses if the branch,
   * issue or project changed since `state` was fetched. Returns `false` if nothing was written.
   */
  applyChanges(state: SyncState, changes: readonly EntityChange[], what: string): Promise<boolean> {
    return this.exclusive(async () => {
      const resolved = await this.resolveTarget();
      if (
        !resolved ||
        resolved.issueNumber !== state.issue.id ||
        resolved.provider.projectPath !== state.projectPath ||
        resolved.provider.host !== state.host
      ) {
        void vscode.window.showWarningMessage('Git Pilot: the branch or repository changed — sync cancelled.');
        return false;
      }
      const { provider, issueNumber, repo } = resolved;
      if (!changes.length) {
        return false;
      }
      this.setView({ kind: 'syncing', issueNumber });
      try {
        const updates = new Map<string, EntityRef>();
        await Promise.all(
          changes.map(async (c) => {
            updates.set(c.key, await provider.editLabels(c.entity, c.kind, c.add, c.remove));
          }),
        );
        if (!this.isCurrent(repo)) {
          return false;
        }
        this.commit(this.withUpdates(state, updates));
        this.ctx.logger.info(`${what}: updated ${changes.length} item(s) of #${issueNumber}.`);
        this.flash(`$(sync) Git Pilot: ${what.toLowerCase()} for #${issueNumber}`);
        return true;
      } catch (err) {
        this.handleError(err, issueNumber, true);
        // Some writes may have succeeded: show the real server state.
        void this.requestSync('recover');
        return false;
      }
    });
  }

  /** Fetches state on demand (e.g. a sidebar action before the first sync finished). */
  async ensureState(): Promise<SyncState | null> {
    if (!this.lastState) {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Git Pilot: fetching issue…' }, () =>
        this.requestSync('manual'),
      );
    }
    return this.lastState;
  }

  // -------------------------------------------------------------------------
  // Core refresh
  // -------------------------------------------------------------------------

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private withUpdates(state: SyncState, updates: ReadonlyMap<string, EntityRef>): SyncState {
    return {
      ...state,
      issue: updates.get('issue') ?? state.issue,
      mergeRequests: state.mergeRequests.map((m) => updates.get(entityKey('mr', m)) ?? m),
    };
  }

  private async resolveTarget(): Promise<
    { provider: GitPlatformProvider; repo: RepoContext; branch: string; issueNumber: number } | null
  > {
    const res = await this.ctx.providerManager.resolve();
    if (res.status !== 'ready' || !res.repo.branch) {
      return null;
    }
    const issueNumber = extractIssueNumber(res.repo.branch, this.ctx.settings.branchIssueRegex);
    return issueNumber ? { provider: res.provider, repo: res.repo, branch: res.repo.branch, issueNumber } : null;
  }

  private async doSync(reason: SyncReason): Promise<void> {
    if (!this.started) {
      return;
    }
    const res = await this.ctx.providerManager.resolve();
    switch (res.status) {
      case 'noRepository':
        this.lastState = null;
        this.setView({ kind: 'hidden', reason: 'No git repository open' });
        return;
      case 'noRemote':
        this.lastState = null;
        this.setView({ kind: 'hidden', reason: 'Repository has no recognizable remote' });
        return;
      case 'unknownPlatform':
        this.lastState = null;
        this.setView({ kind: 'unknownPlatform', host: res.target.host });
        return;
      case 'missingToken':
        this.lastState = null;
        this.setView({ kind: 'missingToken', host: res.target.host, platform: res.target.platform });
        return;
      case 'ready':
        break;
    }

    const { provider, repo } = res;
    const branch = repo.branch;
    if (!branch) {
      this.lastState = null;
      this.setView({ kind: 'noIssue', branch: null, reason: 'Detached HEAD — no branch to derive an issue from.' });
      return;
    }
    const issueNumber = extractIssueNumber(branch, this.ctx.settings.branchIssueRegex);
    if (!issueNumber) {
      this.lastState = null;
      this.setView({
        kind: 'noIssue',
        branch,
        reason: `Branch "${branch}" contains no issue number (gitPilot.branchIssueRegex).`,
      });
      return;
    }

    // Background polls keep the current display instead of flashing a spinner.
    const quiet = (reason === 'poll' || reason === 'focus') && this.lastState?.issue.id === issueNumber;
    if (!quiet) {
      this.setView({ kind: 'syncing', issueNumber });
    }

    try {
      const state = await provider.getSyncState(issueNumber, branch);
      if (!this.isCurrent(repo)) {
        return; // branch/repo switched mid-flight; the switch already queued a new refresh
      }
      if (!state) {
        this.lastState = null;
        this.setView({ kind: 'issueNotFound', issueNumber, projectPath: provider.projectPath });
        return;
      }
      this.commit(state);
    } catch (err) {
      this.handleError(err, issueNumber, reason === 'manual');
    }
  }

  /** Stores the state and publishes it. Whether Issue and MRs differ is derived by the UI (`buildSyncPlan`). */
  private commit(state: SyncState): void {
    this.lastState = state;
    this.lastSyncAt = Date.now();
    this.setView({ kind: 'ready', state, lastSyncAt: new Date(this.lastSyncAt) });
  }

  private isCurrent(repo: RepoContext): boolean {
    const now = this.ctx.gitService.getRepoContext();
    return !!now && now.rootUri.toString() === repo.rootUri.toString() && now.branch === repo.branch;
  }

  private handleError(err: unknown, issueNumber: number, interactive: boolean): void {
    const message = errorMessage(err);
    const authError = isProviderError(err, 'auth');
    this.ctx.logger.error(`Request failed for #${issueNumber}: ${message}`);
    this.setView({ kind: 'error', issueNumber, message, authError });
    if (interactive) {
      const actions = authError ? ['Update Token', 'Show Log'] : ['Show Log'];
      void vscode.window.showErrorMessage(`Git Pilot: ${message}`, ...actions).then((a) => {
        if (a === 'Update Token') {
          void vscode.commands.executeCommand('gitPilot.setToken');
        } else if (a === 'Show Log') {
          this.ctx.logger.show();
        }
      });
    }
  }

  private flash(message: string): void {
    vscode.window.setStatusBarMessage(message, 5000);
  }

  private setView(view: SyncViewState): void {
    this.view = view;
    this._onDidChangeView.fire(view);
    // Share Issue/MR labels with other modules; transient states (syncing, error) keep the last value.
    if (view.kind === 'ready') {
      this.ctx.eventBus.emit('syncStateChanged', view.state);
    } else if (view.kind !== 'syncing' && view.kind !== 'error') {
      this.ctx.eventBus.emit('syncStateChanged', null);
    }
  }

  dispose(): void {
    this.started = false;
    this.clearTimers();
    vscode.Disposable.from(...this.disposables.splice(0)).dispose();
    this._onDidChangeView.dispose();
  }
}
