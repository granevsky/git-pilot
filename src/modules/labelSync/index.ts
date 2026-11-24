import * as vscode from 'vscode';
import { openExternalSafe } from '../../core/commands';
import { mrTerm, oneLine } from '../../core/format';
import { labelGroup } from '../../core/labels';
import { errorMessage } from '../../core/logger';
import { isStatusLabel } from '../../core/providers/baseProvider';
import type { PilotContext, PilotModule, ProjectLabel, SyncState } from '../../core/types';
import { TreeNode } from '../../core/ui/sectionView';
import { ALL_LABELS_ID, type CatalogData } from './catalogTree';
import { pickLabels, pickTargets } from './labelPicker';
import { COMMANDS, StatusBarUi, type SyncViewState } from './statusBarUi';
import { LabelsTree } from './labelsTree';
import { SyncEngine, type LabelEdit } from './syncEngine';
import { buildSyncPlan, describeChanges, entityKeys, entityName, findConflict, findEntity, hasChanges } from './syncPlan';

/** Settings whose change only affects presentation of the section / status bar. */
const RENDER_SETTINGS = ['gitPilot.labelSync.showStatusBar', 'gitPilot.labelSync.labelPrefix', 'gitPilot.labels.groups'];
/** Settings that change which project is resolved, so the cached label catalog is stale. */
const RELOAD_SETTINGS = ['gitPilot.provider', 'gitPilot.instanceUrl', 'gitPilot.allowInsecureHttp'];

/** Max change lines per option in the confirmation dialog. */
const MAX_DETAIL_LINES = 12;

/**
 * Feature Module #1 — the "Labels" sidebar section and the status bar item.
 *
 * Shows the Issue of the current branch and its open Merge Requests (GitLab) / Pull Requests
 * (GitHub) of the same project, lets the user change the status and add / remove / replace labels,
 * and — only after confirmation — syncs the Issue's labels from the MR/PR (the source of truth).
 * The "All labels" node lists the project's label catalog (loaded lazily, on first expansion).
 * Nothing is written automatically.
 */
export class LabelSyncModule implements PilotModule {
  readonly id = 'labelSync';

  private ctx: PilotContext | undefined;
  private engine: SyncEngine | undefined;
  private ui: StatusBarUi | undefined;
  private tree: LabelsTree | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  // Label catalog behind the "All labels" node.
  private catalog: CatalogData | null = null;
  /** `true` while the "All labels" node is expanded: only then is the catalog kept fresh. */
  private catalogWanted = false;
  private catalogRun: Promise<void> | null = null;
  private catalogRerun = false;

  activate(ctx: PilotContext): void {
    this.ctx = ctx;
    const ui = (this.ui = new StatusBarUi(() => ctx.settings.labelSync.labelPrefix));
    const tree = (this.tree = new LabelsTree(
      () => ({
        prefix: ctx.settings.labelSync.labelPrefix,
        masks: ctx.settings.labels.groups,
      }),
      () => this.catalog,
      () => ctx.gitService.getRepoSummary(),
    ));
    const engine = (this.engine = new SyncEngine(ctx));

    this.disposables.push(
      ui,
      tree,
      engine,
      engine.onDidChangeView((view) => this.render(view)),
      tree.view.onDidExpandElement((e) => this.onAllLabelsToggled(e.element, true)),
      tree.view.onDidCollapseElement((e) => this.onAllLabelsToggled(e.element, false)),
      ctx.eventBus.onDidChangeRepo(() => this.invalidateCatalog()),
      ctx.eventBus.onDidChangeAuth(() => this.invalidateCatalog()),
      // Pinning may keep the same repository active: only the header / hints change.
      ctx.eventBus.onDidChangeRepoPin(() => this.render(engine.currentView)),
      vscode.commands.registerCommand(COMMANDS.selectStatus, () => this.selectStatus()),
      vscode.commands.registerCommand(COMMANDS.refresh, () => this.refresh()),
      vscode.commands.registerCommand(COMMANDS.copyName, (node: unknown) => this.copyLabelName(node)),
      vscode.commands.registerCommand(COMMANDS.syncFromMr, () => this.syncFromMr()),
      vscode.commands.registerCommand(COMMANDS.applyStatus, (node: unknown) => this.applyStatusFromNode(node)),
      vscode.commands.registerCommand(COMMANDS.addLabel, (node: unknown) => this.addLabel(node)),
      vscode.commands.registerCommand(COMMANDS.removeLabel, (node: unknown) => this.removeLabel(node)),
      vscode.commands.registerCommand(COMMANDS.replaceLabel, (node: unknown) => this.replaceLabel(node)),
      vscode.commands.registerCommand(COMMANDS.copyLabel, (node: unknown) => this.copyLabelToOthers(node)),
      ctx.eventBus.onDidChangeConfig((e) => {
        if (RELOAD_SETTINGS.some((s) => e.affectsConfiguration(s))) {
          this.invalidateCatalog();
        } else if (RENDER_SETTINGS.some((s) => e.affectsConfiguration(s))) {
          this.render(engine.currentView);
        }
      }),
    );
    this.render(engine.currentView);
    engine.start();
  }

  private render(view: SyncViewState): void {
    this.ui?.render(this.ctx?.settings.labelSync.showStatusBar ? view : { kind: 'hidden', reason: 'Status bar item disabled' });
    this.tree?.render(view);
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  private async refresh(): Promise<void> {
    // The catalog is reloaded too: right away while "All labels" is open, otherwise on next expansion.
    if (this.catalogWanted) {
      void this.loadCatalog();
    } else {
      this.catalog = null;
    }
    await this.engine?.requestSync('manual');
  }

  // -------------------------------------------------------------------------
  // "All labels" catalog (lazy: loaded while the node is expanded)
  // -------------------------------------------------------------------------

  private onAllLabelsToggled(node: TreeNode, expanded: boolean): void {
    if (node.item.id !== ALL_LABELS_ID) {
      return;
    }
    this.catalogWanted = expanded;
    if (expanded && !this.catalog) {
      void this.loadCatalog();
    }
  }

  /** Drops the cached catalog (project/auth changed); reloads at once if the node is open. */
  private invalidateCatalog(): void {
    this.catalog = null;
    if (this.catalogRun) {
      this.catalogRerun = true; // the in-flight result belongs to the old project
    }
    if (this.engine) {
      this.render(this.engine.currentView);
    }
    if (this.catalogWanted) {
      void this.loadCatalog();
    }
  }

  /** One load at a time; a request arriving mid-flight triggers exactly one follow-up load. */
  private loadCatalog(): Promise<void> {
    if (this.catalogRun) {
      this.catalogRerun = true;
      return this.catalogRun;
    }
    this.catalogRun = (async () => {
      do {
        this.catalogRerun = false;
        await this.fetchCatalog();
      } while (this.catalogRerun && this.catalogWanted);
    })().finally(() => {
      this.catalogRun = null;
    });
    return this.catalogRun;
  }

  private async fetchCatalog(): Promise<void> {
    const ctx = this.ctx;
    const tree = this.tree;
    if (!ctx || !tree) {
      return;
    }
    let result: CatalogData;
    try {
      const res = await ctx.providerManager.resolve();
      if (res.status !== 'ready') {
        result = { projectPath: '', labels: null, error: 'The project is not available yet (check the repository remote and API token).' };
      } else {
        const provider = res.provider;
        const getLabels = provider.getLabels?.bind(provider);
        let labels: ProjectLabel[] | null = null;
        let error: string | null = null;
        try {
          labels = getLabels ? await tree.withProgress(() => getLabels()) : null;
        } catch (err) {
          error = errorMessage(err);
          ctx.logger.warn(`Loading project labels failed: ${error}`);
        }
        result = { projectPath: provider.projectPath, labels, error };
      }
    } catch (err) {
      ctx.logger.error(`Loading project labels failed: ${errorMessage(err)}`);
      result = { projectPath: '', labels: null, error: errorMessage(err) };
    }
    if (this.catalogRerun || !this.tree) {
      return; // invalidated mid-flight (or disposed): this result is stale
    }
    this.catalog = result;
    if (this.engine) {
      this.render(this.engine.currentView);
    }
  }

  private async copyLabelName(node: unknown): Promise<void> {
    if (node instanceof TreeNode && node.value) {
      await vscode.env.clipboard.writeText(node.value);
      vscode.window.setStatusBarMessage(`$(copy) Copied "${node.value}"`, 3000);
    }
  }

  /**
   * Syncs labels from the MR/PR (source of truth: the most recently updated open MR/PR with a status)
   * after a modal confirmation that lists every change: "Sync Statuses" copies only its status label
   * to the Issue and the other MRs/PRs; "Sync All Labels" makes their label sets equal to its labels.
   */
  private async syncFromMr(): Promise<void> {
    const engine = this.engine;
    const ctx = this.ctx;
    if (!engine || !ctx) {
      return;
    }
    // Always decide on fresh data: the dialog must show exactly what will be written.
    const state = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Git Pilot: loading labels…' }, () =>
      engine.refreshState(),
    );
    if (!state) {
      return; // the view / error message already explains why
    }
    const plan = buildSyncPlan(state, ctx.settings.labelSync.labelPrefix);
    const term = mrTerm(state.platform);
    const source = plan.source;
    if (!source) {
      void vscode.window.showInformationMessage(`Git Pilot: issue #${state.issue.id} has no open ${term} in this project — nothing to sync from.`);
      return;
    }
    const ref = entityName(state.platform, 'mr', source);
    if (!hasChanges(plan)) {
      void vscode.window.showInformationMessage(`Git Pilot: issue #${state.issue.id} already has the same labels as ${ref}.`);
      return;
    }

    const SYNC_STATUS = 'Sync Statuses';
    const SYNC_ALL = 'Sync All Labels';
    const section = (title: string, changes: Parameters<typeof describeChanges>[1], empty: string) => {
      if (!changes.length) {
        return `${title}: ${empty}`;
      }
      const lines = describeChanges(state.platform, changes);
      const shown = lines.slice(0, MAX_DETAIL_LINES);
      const more = lines.length - shown.length;
      return [`${title}:`, ...shown.map((l) => `  ${l}`), ...(more > 0 ? [`  …and ${more} more`] : [])].join('\n');
    };
    const sourceWhy = source.statusLabel ? `the most recently updated open ${term} with a status` : `the most recently updated open ${term}`;
    const detail = [
      `Source of truth: ${ref} "${oneLine(source.title, 80)}" (${sourceWhy}).`,
      '',
      section(SYNC_STATUS, plan.status, source.statusLabel ? 'nothing to change.' : `${ref} has no status label.`),
      '',
      section(SYNC_ALL, plan.labels, 'nothing to change.'),
      '',
      `"${SYNC_ALL}" makes the labels of the Issue and the other open ${term}s exactly match ${ref}: labels missing on ${ref} are removed.`,
    ].join('\n');

    const buttons = [...(plan.status.length ? [SYNC_STATUS] : []), ...(plan.labels.length ? [SYNC_ALL] : [])];
    const choice = await vscode.window.showWarningMessage(`Sync labels of issue #${state.issue.id} from ${ref}?`, { modal: true, detail }, ...buttons);
    if (choice === SYNC_STATUS) {
      await engine.applyChanges(state, plan.status, `Synced statuses from ${ref}`);
    } else if (choice === SYNC_ALL) {
      await engine.applyChanges(state, plan.labels, `Synced all labels from ${ref}`);
    }
  }

  /**
   * Sidebar action (a status label in "All labels"). Only nodes
   * created by Git Pilot that carry a status label are applied; anything else opens the picker.
   */
  private async applyStatusFromNode(node: unknown): Promise<void> {
    if (!this.engine || !this.ctx) {
      return;
    }
    const label = node instanceof TreeNode ? node.value : undefined;
    if (!label || !isStatusLabel(label, this.ctx.settings.labelSync.labelPrefix)) {
      await this.selectStatus();
      return;
    }
    await this.engine.applyStatus(label);
  }

  private async selectStatus(): Promise<void> {
    if (!this.engine || !this.ui) {
      return;
    }
    const engine = this.engine;
    const view = engine.currentView;

    // States without sync data: route the click to the relevant fix.
    if (view.kind === 'missingToken' || view.kind === 'unknownPlatform' || (view.kind === 'error' && view.authError)) {
      await vscode.commands.executeCommand(COMMANDS.setToken);
      return;
    }

    const state = await this.requireState();
    if (!state) {
      return;
    }
    const outOfSync = hasChanges(buildSyncPlan(state, this.ctx?.settings.labelSync.labelPrefix ?? ''));
    const pick = await this.ui.pickStatus(state, findConflict(state) ?? undefined, outOfSync);
    if (!pick) {
      return;
    }
    switch (pick.type) {
      case 'status':
        await engine.applyStatus(pick.label);
        break;
      case 'refresh':
        await engine.requestSync('manual');
        break;
      case 'syncFromMr':
        await this.syncFromMr();
        break;
      case 'open':
        await openExternalSafe(pick.url);
        break;
      case 'setToken':
        await vscode.commands.executeCommand(COMMANDS.setToken);
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Labels (non-status). Labels are only attached/detached — never created or deleted.
  // -------------------------------------------------------------------------

  /** `+`: on an Issue/MR node → that entity; from the Labels catalog → a preset label; else ask. */
  private async addLabel(arg: unknown): Promise<void> {
    const ctx = this.ctx;
    const engine = this.engine;
    const state = await this.requireState();
    if (!ctx || !engine || !state) {
      return;
    }
    const node = arg instanceof TreeNode ? arg : undefined;
    const preset = node && !node.entity ? node.value : undefined;
    if (preset && isStatusLabel(preset, ctx.settings.labelSync.labelPrefix)) {
      await engine.applyStatus(preset);
      return;
    }

    let targets = node?.entity && findEntity(state, node.entity) ? [node.entity] : undefined;
    if (!targets) {
      const candidates = entityKeys(state)
        .filter((key) => !preset || !findEntity(state, key)?.entity.allLabels.some((l) => l.toLowerCase() === preset.toLowerCase()))
        .map((key) => ({ key, label: this.entityTitle(state, key, true), description: findEntity(state, key)?.entity.title ?? '' }));
      if (!candidates.length) {
        void vscode.window.showInformationMessage(`Git Pilot: "${preset}" is already applied everywhere.`);
        return;
      }
      targets = await pickTargets(preset ? `Add "${oneLine(preset)}" to…` : 'Add labels to…', candidates);
    }
    if (!targets?.length) {
      return;
    }

    let labels: string[] | undefined = preset ? [preset] : undefined;
    if (!labels) {
      const projectLabels = await this.loadProjectLabels();
      if (!projectLabels) {
        return;
      }
      const targetLabels = targets.map((key) => findEntity(state, key)?.entity.allLabels ?? []);
      const onAll = new Set(
        targetLabels[0].map((l) => l.toLowerCase()).filter((l) => targetLabels.every((ls) => ls.some((x) => x.toLowerCase() === l))),
      );
      labels = await pickLabels({
        title: `Add labels to ${targets.map((key) => this.entityTitle(state, key)).join(', ')}`,
        projectLabels,
        exclude: onAll,
        current: targetLabels.flat(),
        masks: ctx.settings.labels.groups,
        statusPrefix: ctx.settings.labelSync.labelPrefix,
      });
    }
    if (labels?.length) {
      const add = labels;
      await engine.editLabels(targets.map((entity) => ({ entity, add, remove: [] })));
    }
  }

  /**
   * `✕`: detaches the label (the label itself stays in the project). On an Issue/MR label row it
   * acts on that item; from the Labels catalog it acts on the items carrying the label (asks when
   * there are several). Offers Undo.
   */
  private async removeLabel(arg: unknown): Promise<void> {
    const engine = this.engine;
    const ctx = this.ctx;
    if (!engine || !ctx || !(arg instanceof TreeNode) || !arg.value || isStatusLabel(arg.value, ctx.settings.labelSync.labelPrefix)) {
      return;
    }
    const label = arg.value;
    let state: SyncState | null;
    let entities: string[] | undefined;
    if (arg.entity) {
      const target = this.labelTarget(arg);
      state = this.engine?.currentState ?? null;
      entities = target ? [target.entity] : undefined;
    } else {
      state = await this.requireState();
      const lower = label.toLowerCase();
      const carrying = state
        ? entityKeys(state).filter((key) => findEntity(state!, key)?.entity.allLabels.some((l) => l.toLowerCase() === lower))
        : [];
      if (state && !carrying.length) {
        void vscode.window.showInformationMessage(`Git Pilot: "${label}" is not applied to the issue or its MRs.`);
        return;
      }
      if (state) {
        const s = state;
        entities = await pickTargets(
          `Remove "${oneLine(label)}" from…`,
          carrying.map((key) => ({ key, label: this.entityTitle(s, key, true), description: findEntity(s, key)?.entity.title ?? '' })),
          'Where should the label be removed from?',
          '$(layers) Everywhere it is applied',
        );
      }
    }
    if (!state || !entities?.length) {
      return;
    }
    const where = entities.map((key) => this.entityTitle(state!, key)).join(', ');
    const targets = entities;
    if (await engine.editLabels(targets.map((entity) => ({ entity, add: [], remove: [label] })))) {
      const choice = await vscode.window.showInformationMessage(`Git Pilot: removed "${label}" from ${where}.`, 'Undo');
      if (choice === 'Undo') {
        await engine.editLabels(targets.map((entity) => ({ entity, add: [label], remove: [] })));
      }
    }
  }

  /** `⇄`: replaces a group label (`app:web`) with another label of the same group. */
  private async replaceLabel(arg: unknown): Promise<void> {
    const ctx = this.ctx;
    const target = this.labelTarget(arg);
    if (!ctx || !target || !this.engine) {
      return;
    }
    const group = labelGroup(target.label, ctx.settings.labels.groups);
    if (!group) {
      void vscode.window.showInformationMessage(`Git Pilot: "${target.label}" belongs to no group; remove it or add other labels instead.`);
      return;
    }
    const projectLabels = await this.loadProjectLabels();
    if (!projectLabels) {
      return;
    }
    const picked = await pickLabels({
      title: `Replace "${oneLine(target.label)}" on ${target.where}`,
      projectLabels,
      exclude: new Set([target.label.toLowerCase()]),
      current: [target.label],
      masks: ctx.settings.labels.groups,
      statusPrefix: ctx.settings.labelSync.labelPrefix,
      onlyGroup: group.key,
    });
    if (picked?.length) {
      await this.engine.editLabels([{ entity: target.entity, add: [picked[0]], remove: [target.label] }]);
    }
  }

  /** `→`: adds the label to every other Issue/MR of the branch that lacks it. */
  private async copyLabelToOthers(arg: unknown): Promise<void> {
    const target = this.labelTarget(arg);
    const state = this.engine?.currentState;
    if (!target || !state || !this.engine) {
      return;
    }
    const lower = target.label.toLowerCase();
    const edits: LabelEdit[] = entityKeys(state)
      .filter((key) => key !== target.entity && !findEntity(state, key)?.entity.allLabels.some((l) => l.toLowerCase() === lower))
      .map((entity) => ({ entity, add: [target.label], remove: [] }));
    if (!edits.length) {
      void vscode.window.showInformationMessage(`Git Pilot: "${target.label}" is already applied everywhere.`);
      return;
    }
    await this.engine.editLabels(edits);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** A non-status label node of the Labels section that belongs to a known entity. */
  private labelTarget(arg: unknown): { entity: string; label: string; where: string } | null {
    const state = this.engine?.currentState;
    const prefix = this.ctx?.settings.labelSync.labelPrefix ?? '';
    if (!(arg instanceof TreeNode) || !arg.entity || !arg.value || !state || isStatusLabel(arg.value, prefix)) {
      return null;
    }
    if (!findEntity(state, arg.entity)) {
      return null;
    }
    return { entity: arg.entity, label: arg.value, where: this.entityTitle(state, arg.entity) };
  }

  private entityTitle(state: SyncState, key: string, withIcon = false): string {
    const found = findEntity(state, key);
    if (!found || found.kind === 'issue') {
      return `${withIcon ? '$(issues) ' : ''}Issue #${state.issue.id}`;
    }
    return `${withIcon ? '$(git-pull-request) ' : ''}${entityName(state.platform, 'mr', found.entity)}`;
  }

  /** Current state, fetched on demand; explains why there is none. */
  private async requireState(): Promise<SyncState | null> {
    const engine = this.engine;
    if (!engine) {
      return null;
    }
    const state = await engine.ensureState();
    if (!state) {
      const v = engine.currentView;
      const reason =
        v.kind === 'noIssue' ? v.reason : v.kind === 'issueNotFound' ? `Issue #${v.issueNumber} not found.` : 'No linked issue for the current branch.';
      void vscode.window.showInformationMessage(`Git Pilot: ${reason}`);
    }
    return state;
  }

  private async loadProjectLabels(): Promise<ProjectLabel[] | null> {
    const ctx = this.ctx;
    if (!ctx) {
      return null;
    }
    const res = await ctx.providerManager.resolve();
    if (res.status !== 'ready' || !res.provider.getLabels) {
      void vscode.window.showWarningMessage('Git Pilot: cannot list project labels for this repository.');
      return null;
    }
    const getLabels = res.provider.getLabels.bind(res.provider);
    try {
      return await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Git Pilot: loading labels…' }, () => getLabels());
    } catch (err) {
      ctx.logger.error(`Loading project labels failed: ${errorMessage(err)}`);
      void vscode.window.showErrorMessage(`Git Pilot: ${errorMessage(err)}`);
      return null;
    }
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables.splice(0)).dispose();
    this.engine = undefined;
    this.ui = undefined;
    this.tree = undefined;
  }
}
