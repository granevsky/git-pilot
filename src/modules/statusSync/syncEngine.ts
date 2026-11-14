import * as vscode from 'vscode';
import { extractIssueNumber } from '../../core/git/gitService';
import { errorMessage } from '../../core/logger';
import { exclusiveRemovals } from '../../core/labels';
import { isProviderError, isStatusLabel, sameStatus } from '../../core/providers/baseProvider';
import type { EntityKind, EntityRef, GitPlatformProvider, PilotContext, RepoContext, SyncState } from '../../core/types';
import { mrRef, mrTerm } from '../../core/format';
import type { SyncViewState } from './statusBarUi';

export type SyncReason = 'activation' | 'branch' | 'focus' | 'poll' | 'manual' | 'config' | 'auth';

const FOCUS_THROTTLE_MS = 30_000;
const TRIGGER_DEBOUNCE_MS = 300;

interface Conflict {
  issueStatus: string;
  mrStatus: string;
  mr: EntityRef;
}

/** Stable key of an Issue/MR inside a SyncState (`issue`, `mr:<projectRef>!<id>`). */
export function entityKey(kind: EntityKind, entity: EntityRef): string {
  return kind === 'issue' ? 'issue' : `mr:${entity.projectRef ?? ''}!${entity.id}`;
}

export function findEntity(state: SyncState, key: string): { kind: EntityKind; entity: EntityRef } | null {
  if (key === 'issue') {
    return { kind: 'issue', entity: state.issue };
  }
  const mr = state.mergeRequests.find((m) => entityKey('mr', m) === key);
  return mr ? { kind: 'mr', entity: mr } : null;
}

/** All Issue/MR keys of a state, Issue first. */
export function entityKeys(state: SyncState): string[] {
  return ['issue', ...state.mergeRequests.map((m) => entityKey('mr', m))];
}

/** One label change on one Issue/MR. */
export interface LabelEdit {
  entity: string;
  add: string[];
  remove: string[];
}

/** Returns the Issue-vs-MR conflict (if any): both sides carry a status and they differ. */
export function findConflict(state: SyncState): Conflict | null {
  const issueStatus = state.issue.statusLabel;
  const mr = state.mergeRequests.find((m) => m.statusLabel);
  const mrStatus = mr?.statusLabel ?? null;
  if (!mr || !issueStatus || !mrStatus || sameStatus(issueStatus, mrStatus)) {
    return null;
  }
  return { issueStatus, mrStatus, mr };
}

/**
 * Drives Status Sync: listens to triggers (activation, branch switch, window focus,
 * polling), fetches SyncState, reconciles divergent labels according to
 * `gitPilot.statusSync.sourceOfTruth` (only while auto-sync — `gitPilot.statusSync.enabled` —
 * is on), and publishes a view model for the UI. Manual status/label edits always work.
 *
 * All network work runs through a single exclusive queue so syncs and manual
 * status changes never interleave.
 */
export class SyncEngine implements vscode.Disposable {
  private readonly _onDidChangeView = new vscode.EventEmitter<SyncViewState>();
  readonly onDidChangeView = this._onDidChangeView.event;

  private view: SyncViewState = { kind: 'hidden', reason: 'Starting' };
  private lastState: SyncState | null = null;
  private lastSyncAt = 0;
  private promptedConflictKey: string | null = null;

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
        if (e.affectsConfiguration('gitPilot.statusSync.autoSyncInterval') || e.affectsConfiguration('gitPilot.statusSync.enabled')) {
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
    const { enabled, autoSyncInterval: seconds } = this.ctx.settings.statusSync;
    // Polling only serves auto-sync; with auto-sync off the section still refreshes on branch/focus.
    if (enabled && seconds > 0) {
      this.pollTimer = setInterval(() => {
        // Don't burn API quota while VS Code is in the background; focus triggers a catch-up sync.
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

  /** Queues a sync; concurrent requests while one is waiting are coalesced. */
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

  /** Applies `label` to the issue and every open MR/PR (manual selection or conflict resolution). */
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
        // Status labels were not touched, so isSynced / effectiveStatus stay valid.
        this.commit({
          ...fresh,
          issue: updates.get('issue') ?? fresh.issue,
          mergeRequests: fresh.mergeRequests.map((m) => updates.get(entityKey('mr', m)) ?? m),
        });
        return updates.size > 0;
      } catch (err) {
        this.handleError(err, issueNumber, true);
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
  // Core sync
  // -------------------------------------------------------------------------

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
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
    const settings = this.ctx.settings.statusSync;
    const res = await this.ctx.providerManager.resolve();
    switch (res.status) {
      case 'noRepository':
        this.setView({ kind: 'hidden', reason: 'No git repository open' });
        return;
      case 'noRemote':
        this.setView({ kind: 'hidden', reason: 'Repository has no recognizable remote' });
        return;
      case 'unknownPlatform':
        this.setView({ kind: 'unknownPlatform', host: res.target.host });
        return;
      case 'missingToken':
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
        return; // branch/repo switched mid-flight; the switch already queued a new sync
      }
      if (!state) {
        this.lastState = null;
        this.setView({ kind: 'issueNotFound', issueNumber, projectPath: provider.projectPath });
        return;
      }
      const reconciled = settings.enabled ? await this.reconcile(provider, state) : state;
      if (!this.isCurrent(repo)) {
        return;
      }
      this.commit(reconciled);
    } catch (err) {
      this.handleError(err, issueNumber, reason === 'manual');
    }
  }

  /** Auto-applies `effectiveStatus` in `mr`/`issue` modes (and gap-filling in `prompt` mode). */
  private async reconcile(provider: GitPlatformProvider, state: SyncState): Promise<SyncState> {
    if (state.isSynced || !state.effectiveStatus) {
      return state; // synced, or a genuine conflict awaiting the user (prompt mode)
    }
    const target = state.effectiveStatus;
    const before = state.issue.statusLabel;
    const updated = await provider.setUnifiedStatus(state, target);

    const term = mrTerm(state.platform);
    const direction = sameStatus(before, target) ? `${term}s` : 'issue';
    this.ctx.logger.info(
      `Auto-sync (${this.ctx.settings.statusSync.sourceOfTruth}): #${state.issue.id} ${before ?? '(none)'} -> ${target}; updated ${direction}.`,
    );
    this.flash(`$(sync) Git Pilot: synced #${state.issue.id} → ${target}`);
    return updated;
  }

  /** Stores the state and derives the view (synced or conflict); prompts once per new conflict. */
  private commit(state: SyncState): void {
    this.lastState = state;
    this.lastSyncAt = Date.now();
    const conflict = state.isSynced ? null : findConflict(state);
    if (!conflict) {
      this.promptedConflictKey = null;
      this.setView({ kind: 'synced', state, lastSyncAt: new Date(this.lastSyncAt) });
      return;
    }
    this.setView({ kind: 'conflict', state, ...conflict, lastSyncAt: new Date(this.lastSyncAt) });
    const key = `${state.projectPath}#${state.issue.id}|${conflict.issueStatus}|${conflict.mrStatus}`;
    if (this.ctx.settings.statusSync.enabled && this.promptedConflictKey !== key) {
      this.promptedConflictKey = key;
      void this.promptConflict(state, conflict);
    }
  }

  private async promptConflict(state: SyncState, conflict: Conflict): Promise<void> {
    const term = mrTerm(state.platform);
    const useMr = `Use ${term}: ${conflict.mrStatus}`;
    const useIssue = `Use Issue: ${conflict.issueStatus}`;
    const choice = await vscode.window.showWarningMessage(
      `Git Pilot: Issue #${state.issue.id} is "${conflict.issueStatus}" but ${term} ${mrRef(state.platform, conflict.mr.id)} is "${conflict.mrStatus}". Which status should win?`,
      useMr,
      useIssue,
      'Choose…',
    );
    if (choice === useMr) {
      await this.applyStatus(conflict.mrStatus);
    } else if (choice === useIssue) {
      await this.applyStatus(conflict.issueStatus);
    } else if (choice === 'Choose…') {
      await vscode.commands.executeCommand('gitPilot.statusSync.selectStatus');
    }
  }

  private isCurrent(repo: RepoContext): boolean {
    const now = this.ctx.gitService.getRepoContext();
    return !!now && now.rootUri.toString() === repo.rootUri.toString() && now.branch === repo.branch;
  }

  private handleError(err: unknown, issueNumber: number, interactive: boolean): void {
    const message = errorMessage(err);
    const authError = isProviderError(err, 'auth');
    this.ctx.logger.error(`Sync failed for #${issueNumber}: ${message}`);
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
    if (view.kind === 'synced' || view.kind === 'conflict') {
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
