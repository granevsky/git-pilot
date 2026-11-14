import * as vscode from 'vscode';
import { errorMessage } from '../../core/logger';
import type { PilotContext, PilotModule, ProjectLabel, SyncState } from '../../core/types';
import { SectionView, TreeNode } from '../../core/ui/sectionView';
import { LABEL_COMMANDS, buildCatalogTree, info } from './labelsTree';

export const LABELS_VIEW_ID = 'gitPilot.labels';

const DEBOUNCE_MS = 300;
const FOCUS_THROTTLE_MS = 60_000;

/** Settings that change which project is resolved and therefore require a reload. */
const RELOAD_SETTINGS = ['gitPilot.provider', 'gitPilot.instanceUrl', 'gitPilot.allowInsecureHttp'];
/** Settings that only change presentation. */
const RENDER_SETTINGS = ['gitPilot.labels.groups', 'gitPilot.statusSync.labelPrefix'];

interface Catalog {
  projectPath: string;
  labels: ProjectLabel[] | null;
  error: string | null;
}

/**
 * Sidebar section "Labels": the project's label catalog grouped by prefix (`status:*`, `app:*`, …)
 * or by `gitPilot.labels.groups` masks, with "Other" last.
 *
 * Read-only and lazy: the catalog is fetched only while the section is visible. Which labels are
 * applied to the current Issue / MRs comes from Status Sync via `syncStateChanged` (no extra calls);
 * attaching labels is delegated to the Issue & MR section's commands.
 */
export class LabelsModule implements PilotModule {
  readonly id = 'labels';

  private ctx: PilotContext | undefined;
  private section: SectionView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  private catalog: Catalog | null = null;
  private state: SyncState | null = null;
  private dirty = true;
  private running: Promise<void> | null = null;
  private rerun = false;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastLoadAt = 0;

  activate(ctx: PilotContext): void {
    this.ctx = ctx;
    const section = (this.section = new SectionView(LABELS_VIEW_ID, { showCollapseAll: true }));
    const { eventBus } = ctx;

    this.disposables.push(
      section,
      // Commands are registered unconditionally (even while the section is disabled).
      vscode.commands.registerCommand(LABEL_COMMANDS.refresh, () => this.manualRefresh()),
      vscode.commands.registerCommand(LABEL_COMMANDS.copyName, (node: unknown) => this.copyName(node)),
      eventBus.onDidChangeRepo(() => this.invalidate()),
      eventBus.onDidChangeAuth(() => this.invalidate()),
      eventBus.onDidChangeConfig((e) => {
        if (e.affectsConfiguration('gitPilot.labels.enabled')) {
          this.applyEnabled();
        } else if (RELOAD_SETTINGS.some((s) => e.affectsConfiguration(s))) {
          this.invalidate();
        } else if (RENDER_SETTINGS.some((s) => e.affectsConfiguration(s))) {
          this.render();
        }
      }),
      eventBus.onDidChangeSyncState((state) => {
        this.state = state;
        this.render();
      }),
      section.view.onDidChangeVisibility((e) => {
        if (e.visible && this.dirty) {
          this.schedule(0);
        }
      }),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused && this.section?.visible && Date.now() - this.lastLoadAt >= FOCUS_THROTTLE_MS) {
          this.invalidate();
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
    this.ctx.logger.info(`Labels section ${this.enabled ? 'enabled' : 'disabled'}.`);
    if (this.enabled) {
      this.invalidate();
    } else {
      this.clearTimer();
      this.catalog = null;
      this.dirty = true;
      this.section.render([], 'The Labels section is disabled (gitPilot.labels.enabled).');
    }
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  /** Marks the catalog stale; loads now if the section is visible, otherwise on next reveal. */
  private invalidate(): void {
    if (!this.enabled) {
      return;
    }
    this.dirty = true;
    if (this.section?.visible) {
      this.schedule();
    }
  }

  private schedule(delay = DEBOUNCE_MS): void {
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

  /** One load at a time; a request arriving mid-flight triggers exactly one follow-up load. */
  private run(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.rerun = false;
        this.dirty = false;
        await this.load();
      } while (this.rerun && this.enabled);
    })().finally(() => {
      this.running = null;
    });
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
    await this.run();
  }

  // -------------------------------------------------------------------------
  // Loading & rendering
  // -------------------------------------------------------------------------

  private async load(): Promise<void> {
    const ctx = this.ctx;
    const section = this.section;
    if (!ctx || !section) {
      return;
    }
    try {
      const res = await ctx.providerManager.resolve();
      switch (res.status) {
        case 'noRepository':
          return this.showOnly([], 'No git repository is open.');
        case 'noRemote':
          return this.showOnly([], 'This repository has no GitLab/GitHub remote.');
        case 'unknownPlatform':
          return this.showOnly([
            info(`Choose the platform for ${res.target.host}…`, 'question', 'Cannot tell whether this host is GitLab or GitHub.', 'gitPilot.setToken'),
          ]);
        case 'missingToken':
          return this.showOnly([info(`Set an API token for ${res.target.host}…`, 'key', 'No token stored for this host.', 'gitPilot.setToken')]);
        case 'ready':
          break;
      }
      const provider = res.provider;
      const getLabels = provider.getLabels?.bind(provider);
      if (!this.catalog) {
        section.render([info('Loading…', 'loading~spin')]);
      }
      let labels: ProjectLabel[] | null = null;
      let error: string | null = null;
      try {
        labels = getLabels ? await section.withProgress(() => getLabels()) : null;
      } catch (err) {
        error = errorMessage(err);
        ctx.logger.warn(`Labels: loading project labels failed: ${error}`);
      }
      this.catalog = { projectPath: provider.projectPath, labels, error };
      this.lastLoadAt = Date.now();
      this.render();
    } catch (err) {
      ctx.logger.error(`Labels: refresh failed: ${errorMessage(err)}`);
      this.showOnly([info('Could not load labels', 'error', errorMessage(err), LABEL_COMMANDS.refresh)]);
    }
  }

  private render(): void {
    const ctx = this.ctx;
    const section = this.section;
    const catalog = this.catalog;
    if (!ctx || !section || !catalog || !this.enabled) {
      return;
    }
    section.description = catalog.projectPath;
    section.render(
      buildCatalogTree({
        projectLabels: catalog.labels,
        labelsError: catalog.error,
        state: this.state?.projectPath === catalog.projectPath ? this.state : null,
        statusPrefix: ctx.settings.statusSync.labelPrefix,
        masks: ctx.settings.labels.groups,
      }),
    );
  }

  private showOnly(nodes: TreeNode[], message?: string): void {
    this.catalog = null;
    if (this.section) {
      this.section.description = undefined;
      this.section.render(nodes, message);
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
    this.catalog = null;
  }
}
