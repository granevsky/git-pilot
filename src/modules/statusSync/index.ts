import * as vscode from 'vscode';
import { openExternalSafe } from '../../core/commands';
import type { PilotContext, PilotModule } from '../../core/types';
import { COMMANDS, StatusBarUi } from './statusBarUi';
import { SyncEngine, findConflict } from './syncEngine';

/**
 * Feature Module #1 — keeps `status:` labels synchronized between an Issue and
 * its open Merge Requests (GitLab) / Pull Requests (GitHub).
 */
export class StatusSyncModule implements PilotModule {
  readonly id = 'statusSync';

  private ctx: PilotContext | undefined;
  private engine: SyncEngine | undefined;
  private ui: StatusBarUi | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  activate(ctx: PilotContext): void {
    this.ctx = ctx;
    const ui = (this.ui = new StatusBarUi(() => ctx.settings.statusSync.labelPrefix));
    const engine = (this.engine = new SyncEngine(ctx));

    this.disposables.push(
      ui,
      engine,
      engine.onDidChangeView((view) => ui.render(view)),
      vscode.commands.registerCommand(COMMANDS.selectStatus, () => this.selectStatus()),
      vscode.commands.registerCommand(COMMANDS.syncNow, () => this.syncNow()),
      ctx.eventBus.onDidChangeConfig((e) => {
        if (e.affectsConfiguration('gitPilot.statusSync.enabled')) {
          this.applyEnabled();
        }
      }),
    );
    this.applyEnabled();
  }

  private applyEnabled(): void {
    if (!this.ctx || !this.engine) {
      return;
    }
    if (this.ctx.settings.statusSync.enabled) {
      this.ctx.logger.info('Status Sync enabled.');
      this.engine.start();
    } else {
      this.ctx.logger.info('Status Sync disabled.');
      this.engine.stop();
    }
  }

  private ensureEnabled(): boolean {
    if (this.ctx?.settings.statusSync.enabled) {
      return true;
    }
    void vscode.window.showInformationMessage('Git Pilot: Status Sync is disabled.', 'Enable').then(async (a) => {
      if (a === 'Enable') {
        await vscode.workspace.getConfiguration('gitPilot').update('statusSync.enabled', true, vscode.ConfigurationTarget.Global);
      }
    });
    return false;
  }

  private async syncNow(): Promise<void> {
    if (!this.ensureEnabled() || !this.engine) {
      return;
    }
    await this.engine.requestSync('manual');
  }

  private async selectStatus(): Promise<void> {
    if (!this.ensureEnabled() || !this.engine || !this.ui) {
      return;
    }
    const engine = this.engine;
    const view = engine.currentView;

    // States without sync data: route the click to the relevant fix.
    if (view.kind === 'missingToken' || view.kind === 'unknownPlatform' || (view.kind === 'error' && view.authError)) {
      await vscode.commands.executeCommand(COMMANDS.setToken);
      return;
    }

    let state = engine.currentState;
    if (!state) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Git Pilot: fetching status…' },
        () => engine.requestSync('manual'),
      );
      state = engine.currentState;
    }
    if (!state) {
      const v = engine.currentView;
      const reason = v.kind === 'noIssue' ? v.reason : v.kind === 'issueNotFound' ? `Issue #${v.issueNumber} not found.` : 'No linked issue for the current branch.';
      void vscode.window.showInformationMessage(`Git Pilot: ${reason}`);
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

  dispose(): void {
    vscode.Disposable.from(...this.disposables.splice(0)).dispose();
    this.engine = undefined;
    this.ui = undefined;
  }
}
