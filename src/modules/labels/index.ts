import * as vscode from 'vscode';
import { extractIssueNumber } from '../../core/git/gitService';
import { errorMessage } from '../../core/logger';
import { isProviderError } from '../../core/providers/baseProvider';
import type { PilotContext, PilotModule, ProjectLabel, RepoContext, SyncState } from '../../core/types';
import { SectionView, TreeNode } from '../../core/ui/sectionView';
import { LABEL_COMMANDS, buildLabelsTree, info, type LabelsSnapshot } from './labelsTree';

export const LABELS_VIEW_ID = 'gitPilot.labels';

/** `entities` = Issue/MR labels only; `all` = also the (rarely changing) project label list. */
type Scope = 'entities' | 'all';

type LabelsData = Omit<LabelsSnapshot, 'statusPrefix' | 'masks'>;

const DEBOUNCE_MS = 300;
const FOCUS_THROTTLE_MS = 60_000;

/** Settings that change which project/issue is resolved and therefore require a reload. */
const RELOAD_SETTINGS = ['gitPilot.provider', 'gitPilot.instanceUrl', 'gitPilot.allowInsecureHttp', 'gitPilot.branchIssueRegex'];
/** Settings that only change presentation. */
const RENDER_SETTINGS = ['gitPilot.labels.groups', 'gitPilot.statusSync.labelPrefix'];

function merge(a: Scope | null, b: Scope): Scope {
  return a === 'all' || b === 'all' ? 'all' : 'entities';
}

/**
 * Sidebar section "Labels": the labels of the current branch's Issue and of each open MR/PR,
 * plus every project label grouped by prefix (`status:*`, `app:*`, …) or configured masks.
 *
 * Read-only and lazy: data is fetched only while the section is visible. Status Sync results
 * arrive through `syncStateChanged`, so label changes made there show up without a refetch.
 */
export class LabelsModule implements PilotModule {
  readonly id = 'labels';

  private ctx: PilotContext | undefined;
  private section: SectionView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  private data: LabelsData | null = null;
  private labelsCache: { key: string; labels: ProjectLabel[] | null } | null = null;
  private dirty: Scope | null = 'all';
  private pendingScope: Scope | null = null;
  private running: Promise<void> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastLoadAt = 0;

  activate(ctx: PilotContext): void {
    this.ctx = ctx;
    const section = (this.section = new SectionView(LABELS_VIEW_ID, { showCollapseAll: true }));
    const { eventBus } = ctx;

    this.disposables.push(
      section,
      // Commands are registered unconditionally (even while the module is disabled).
      vscode.commands.registerCommand(LABEL_COMMANDS.refresh, () => this.manualRefresh()),
      vscode.commands.registerCommand(LABEL_COMMANDS.copyName, (node: unknown) => this.copyName(node)),
      eventBus.onDidChangeRepo(() => this.invalidate('all')),
      eventBus.onDidChangeBranch(() => this.invalidate('entities')),
      eventBus.onDidChangeAuth(() => this.invalidate('all')),
      eventBus.onDidChangeConfig((e) => {
        if (e.affectsConfiguration('gitPilot.labels.enabled')) {
          this.applyEnabled();
        } else if (RELOAD_SETTINGS.some((s) => e.affectsConfiguration(s))) {
          this.invalidate('all');
        } else if (RENDER_SETTINGS.some((s) => e.affectsConfiguration(s))) {
          this.render();
        }
      }),
      eventBus.onDidChangeSyncState((state) => this.patch(state)),
      section.view.onDidChangeVisibility((e) => {
        if (e.visible && this.dirty) {
          this.schedule(this.dirty, 0);
        }
      }),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused && this.section?.visible && Date.now() - this.lastLoadAt >= FOCUS_THROTTLE_MS) {
          this.invalidate('all');
        }
      }),
    );
    this.applyEnabled();
  }

  private get enabled(): boolean {
    return !!this.ctx?.settings.labels.enabled;
  }

  private applyEnabled(): void {
    if (!this.ctx || !this.section) {
      return;
    }
    if (this.enabled) {
      this.ctx.logger.info('Labels section enabled.');
      this.invalidate('all');
    } else {
      this.ctx.logger.info('Labels section disabled.');
      this.clearTimer();
      this.data = null;
      this.dirty = 'all';
      this.section.render([], 'The Labels section is disabled (gitPilot.labels.enabled).');
    }
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  /** Marks data stale; loads now if the section is visible, otherwise on next reveal. */
  private invalidate(scope: Scope): void {
    if (!this.enabled) {
      return;
    }
    this.dirty = merge(this.dirty, scope);
    if (this.section?.visible) {
      this.schedule(this.dirty);
    }
  }

  private schedule(scope: Scope, delay = DEBOUNCE_MS): void {
    this.pendingScope = merge(this.pendingScope, scope);
    this.clearTimer();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.run();
    }, delay);
  }

  private clearTimer(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  /** Runs loads one at a time; requests arriving mid-flight are coalesced into one follow-up. */
  private run(): Promise<void> {
    if (!this.running) {
      this.running = (async () => {
        while (this.pendingScope && this.enabled) {
          const scope = this.pendingScope;
          this.pendingScope = null;
          this.dirty = null;
          await this.load(scope);
        }
      })().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async manualRefresh(): Promise<void> {
    if (!this.enabled) {
      void vscode.window.showInformationMessage('Git Pilot: the Labels section is disabled.', 'Enable').then(async (a) => {
        if (a === 'Enable') {
          await vscode.workspace.getConfiguration('gitPilot').update('labels.enabled', true, vscode.ConfigurationTarget.Global);
        }
      });
      return;
    }
    this.clearTimer();
    this.pendingScope = 'all';
    await this.run();
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  private async load(scope: Scope): Promise<void> {
    const ctx = this.ctx;
    const section = this.section;
    if (!ctx || !section) {
      return;
    }
    try {
      const res = await ctx.providerManager.resolve();
      switch (res.status) {
        case 'noRepository':
          return this.showMessage('No git repository is open.');
        case 'noRemote':
          return this.showMessage('This repository has no GitLab/GitHub remote.');
        case 'unknownPlatform':
          return this.showNodes([
            info(`Choose the platform for ${res.target.host}…`, 'question', 'Cannot tell whether this host is GitLab or GitHub.', 'gitPilot.setToken'),
          ]);
        case 'missingToken':
          return this.showNodes([info(`Set an API token for ${res.target.host}…`, 'key', 'No token stored for this host.', 'gitPilot.setToken')]);
        case 'ready':
          break;
      }

      const { provider, repo } = res;
      const branch = repo.branch;
      const issueNumber = branch ? extractIssueNumber(branch, ctx.settings.branchIssueRegex) : null;
      const labelsKey = `${provider.platform}|${provider.webBaseUrl}|${provider.projectPath}`;
      const cached = scope === 'entities' && this.labelsCache?.key === labelsKey ? this.labelsCache : null;

      if (!this.data) {
        section.render([info('Loading…', 'loading~spin')]);
      }
      const [stateRes, labelsRes] = await section.withProgress(() =>
        Promise.allSettled([
          issueNumber && branch ? provider.getSyncState(issueNumber, branch) : Promise.resolve(null),
          cached ? Promise.resolve(cached.labels) : provider.getLabels ? provider.getLabels() : Promise.resolve(null),
        ]),
      );
      if (!this.isCurrent(repo)) {
        return; // branch/repo switched mid-flight; the switch already queued a reload
      }

      let labelsError: string | null = null;
      if (labelsRes.status === 'fulfilled') {
        this.labelsCache = { key: labelsKey, labels: labelsRes.value };
      } else {
        labelsError = errorMessage(labelsRes.reason);
        this.labelsCache = null;
        ctx.logger.warn(`Labels: project labels failed: ${labelsError}`);
      }

      let issueError: LabelsData['issueError'] = null;
      const state = stateRes.status === 'fulfilled' ? stateRes.value : null;
      if (stateRes.status === 'rejected') {
        issueError = { message: errorMessage(stateRes.reason), authError: isProviderError(stateRes.reason, 'auth') };
        ctx.logger.warn(`Labels: issue #${issueNumber ?? '?'} failed: ${issueError.message}`);
      }

      this.data = {
        platform: provider.platform,
        projectPath: provider.projectPath,
        branch,
        issueNumber,
        issue: state?.issue ?? null,
        mergeRequests: state?.mergeRequests ?? [],
        projectLabels: this.labelsCache?.labels ?? null,
        labelsError,
        issueError,
      };
      this.lastLoadAt = Date.now();
      this.render();
    } catch (err) {
      ctx.logger.error(`Labels: refresh failed: ${errorMessage(err)}`);
      this.showNodes([info('Could not load labels', 'error', errorMessage(err), LABEL_COMMANDS.refresh)]);
    }
  }

  private isCurrent(repo: RepoContext): boolean {
    const now = this.ctx?.gitService.getRepoContext();
    return !!now && now.rootUri.toString() === repo.rootUri.toString() && now.branch === repo.branch;
  }

  /** Applies a fresh Status Sync result for the same issue without another API round-trip. */
  private patch(state: SyncState): void {
    const data = this.data;
    if (!this.enabled || !data || data.projectPath !== state.projectPath || data.issueNumber !== state.issue.id) {
      return;
    }
    this.data = { ...data, issue: state.issue, mergeRequests: state.mergeRequests, issueError: null };
    this.render();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private render(): void {
    const ctx = this.ctx;
    const section = this.section;
    const data = this.data;
    if (!ctx || !section || !data || !this.enabled) {
      return;
    }
    const snapshot: LabelsSnapshot = {
      ...data,
      statusPrefix: ctx.settings.statusSync.labelPrefix,
      masks: ctx.settings.labels.groups,
    };
    section.description = data.projectPath;
    section.render(buildLabelsTree(snapshot));
  }

  private showMessage(message: string): void {
    this.data = null;
    if (this.section) {
      this.section.description = undefined;
      this.section.render([], message);
    }
  }

  private showNodes(nodes: TreeNode[]): void {
    this.data = null;
    if (this.section) {
      this.section.description = undefined;
      this.section.render(nodes);
    }
  }

  private async copyName(node: unknown): Promise<void> {
    if (node instanceof TreeNode && node.value) {
      await vscode.env.clipboard.writeText(node.value);
      vscode.window.setStatusBarMessage(`$(copy) Copied "${node.value}"`, 3000);
    }
  }

  dispose(): void {
    this.clearTimer();
    vscode.Disposable.from(...this.disposables.splice(0)).dispose();
    this.section = undefined;
    this.data = null;
  }
}
