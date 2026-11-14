import * as vscode from 'vscode';
import { openExternalSafe } from '../../core/commands';
import { mrRef, mrTerm, oneLine } from '../../core/format';
import { labelGroup } from '../../core/labels';
import { errorMessage } from '../../core/logger';
import { isStatusLabel } from '../../core/providers/baseProvider';
import type { PilotContext, PilotModule, ProjectLabel, SyncState } from '../../core/types';
import { TreeNode } from '../../core/ui/sectionView';
import { pickLabels, pickTargets } from './labelPicker';
import { COMMANDS, StatusBarUi, type SyncViewState } from './statusBarUi';
import { StatusTree } from './statusTree';
import { SyncEngine, entityKeys, findConflict, findEntity, type LabelEdit } from './syncEngine';

/** Settings whose change only affects presentation of the section / status bar. */
const RENDER_SETTINGS = ['gitPilot.statusSync.enabled', 'gitPilot.statusSync.labelPrefix', 'gitPilot.labels.groups'];

/**
 * Feature Module #1 — the "Issue & MR" sidebar section and the status bar item.
 *
 * Keeps `status:` labels synchronized between an Issue and its open Merge Requests (GitLab) /
 * Pull Requests (GitHub) while auto-sync (`gitPilot.statusSync.enabled`) is on, and always lets
 * the user change the status and add / remove / replace the other labels of the Issue and MRs.
 */
export class StatusSyncModule implements PilotModule {
  readonly id = 'statusSync';

  private ctx: PilotContext | undefined;
  private engine: SyncEngine | undefined;
  private ui: StatusBarUi | undefined;
  private tree: StatusTree | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  activate(ctx: PilotContext): void {
    this.ctx = ctx;
    const ui = (this.ui = new StatusBarUi(() => ctx.settings.statusSync.labelPrefix));
    const tree = (this.tree = new StatusTree(() => ({
      prefix: ctx.settings.statusSync.labelPrefix,
      masks: ctx.settings.labels.groups,
      autoSync: ctx.settings.statusSync.enabled,
    })));
    const engine = (this.engine = new SyncEngine(ctx));

    this.disposables.push(
      ui,
      tree,
      engine,
      engine.onDidChangeView((view) => this.render(view)),
      vscode.commands.registerCommand(COMMANDS.selectStatus, () => this.selectStatus()),
      vscode.commands.registerCommand(COMMANDS.syncNow, () => this.syncNow()),
      vscode.commands.registerCommand(COMMANDS.applyStatus, (node: unknown) => this.applyStatusFromNode(node)),
      vscode.commands.registerCommand(COMMANDS.addLabel, (node: unknown) => this.addLabel(node)),
      vscode.commands.registerCommand(COMMANDS.removeLabel, (node: unknown) => this.removeLabel(node)),
      vscode.commands.registerCommand(COMMANDS.replaceLabel, (node: unknown) => this.replaceLabel(node)),
      vscode.commands.registerCommand(COMMANDS.copyLabel, (node: unknown) => this.copyLabelToOthers(node)),
      ctx.eventBus.onDidChangeConfig((e) => {
        if (e.affectsConfiguration('gitPilot.statusSync.enabled')) {
          ctx.logger.info(`Status Sync auto-sync ${ctx.settings.statusSync.enabled ? 'enabled' : 'disabled'}.`);
        }
        if (RENDER_SETTINGS.some((s) => e.affectsConfiguration(s))) {
          this.render(engine.currentView);
        }
      }),
    );
    this.render(engine.currentView);
    // The engine always runs: the section needs data even with auto-sync off.
    engine.start();
  }

  private render(view: SyncViewState): void {
    // The status bar item is the auto-sync indicator; the sidebar section is always available.
    this.ui?.render(this.ctx?.settings.statusSync.enabled ? view : { kind: 'disabled' });
    this.tree?.render(view);
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  private async syncNow(): Promise<void> {
    await this.engine?.requestSync('manual');
  }

  /**
   * Sidebar action (Issue & MR statuses, or a status label in the Labels section). Only nodes
   * created by Git Pilot that carry a status label are applied; anything else opens the picker.
   */
  private async applyStatusFromNode(node: unknown): Promise<void> {
    if (!this.engine || !this.ctx) {
      return;
    }
    const label = node instanceof TreeNode ? node.value : undefined;
    if (!label || !isStatusLabel(label, this.ctx.settings.statusSync.labelPrefix)) {
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
    const pick = await this.ui.pickStatus(state, findConflict(state) ?? undefined);
    if (!pick) {
      return;
    }
    switch (pick.type) {
      case 'status':
        await engine.applyStatus(pick.label);
        break;
      case 'syncNow':
        await engine.requestSync('manual');
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
    if (preset && isStatusLabel(preset, ctx.settings.statusSync.labelPrefix)) {
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
        statusPrefix: ctx.settings.statusSync.labelPrefix,
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
    if (!engine || !ctx || !(arg instanceof TreeNode) || !arg.value || isStatusLabel(arg.value, ctx.settings.statusSync.labelPrefix)) {
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
      statusPrefix: ctx.settings.statusSync.labelPrefix,
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

  /** A non-status label node of the Issue & MR section that belongs to a known entity. */
  private labelTarget(arg: unknown): { entity: string; label: string; where: string } | null {
    const state = this.engine?.currentState;
    const prefix = this.ctx?.settings.statusSync.labelPrefix ?? '';
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
    return `${withIcon ? '$(git-pull-request) ' : ''}${mrTerm(state.platform)} ${mrRef(state.platform, found.entity.id)}`;
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
