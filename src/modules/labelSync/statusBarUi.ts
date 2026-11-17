import * as vscode from 'vscode';
import { sameStatus, statusValue } from '../../core/providers/baseProvider';
import { code, escapeMd, mrRef, mrTerm } from '../../core/format';
import type { Platform, SyncState } from '../../core/types';
import { type Conflict, buildSyncPlan, entityName, hasChanges } from './syncPlan';

// ---------------------------------------------------------------------------
// View model produced by the SyncEngine and rendered here
// ---------------------------------------------------------------------------

export type SyncViewState =
  | { kind: 'hidden'; reason: string }
  | { kind: 'noIssue'; branch: string | null; reason: string }
  | { kind: 'unknownPlatform'; host: string }
  | { kind: 'missingToken'; host: string; platform: Platform }
  | { kind: 'syncing'; issueNumber: number }
  | { kind: 'issueNotFound'; issueNumber: number; projectPath: string }
  | { kind: 'ready'; state: SyncState; lastSyncAt: Date }
  | { kind: 'error'; issueNumber: number | null; message: string; authError: boolean };

export type StatusPickResult =
  | { type: 'status'; label: string }
  | { type: 'refresh' }
  | { type: 'syncFromMr' }
  | { type: 'open'; url: string }
  | { type: 'setToken' };

export const COMMANDS = {
  setToken: 'gitPilot.setToken',
  selectStatus: 'gitPilot.labelSync.selectStatus',
  refresh: 'gitPilot.labelSync.refresh',
  syncFromMr: 'gitPilot.labelSync.syncFromMr',
  openInBrowser: 'gitPilot.openInBrowser',
  applyStatus: 'gitPilot.labelSync.applyStatus',
  addLabel: 'gitPilot.labelSync.addLabel',
  removeLabel: 'gitPilot.labelSync.removeLabel',
  replaceLabel: 'gitPilot.labelSync.replaceLabel',
  copyLabel: 'gitPilot.labelSync.copyLabelToOthers',
  copyName: 'gitPilot.labelSync.copyLabelName',
} as const;

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

export class StatusBarUi implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly getPrefix: () => string) {
    this.item = vscode.window.createStatusBarItem('gitPilot.labelSync', vscode.StatusBarAlignment.Left, 50);
    this.item.name = 'Git Pilot: Labels';
  }

  render(view: SyncViewState): void {
    const item = this.item;
    item.backgroundColor = undefined;
    item.command = COMMANDS.selectStatus;

    switch (view.kind) {
      case 'hidden':
        item.hide();
        return;

      case 'noIssue':
        item.text = '$(tag) Git Pilot';
        item.tooltip = new vscode.MarkdownString(`**Git Pilot** — ${escapeMd(view.reason)}`);
        item.command = COMMANDS.refresh;
        break;

      case 'unknownPlatform':
        item.text = '$(question) Git Pilot: Unknown host';
        item.tooltip = `Cannot tell whether ${view.host} is GitLab or GitHub. Click to choose, or set "gitPilot.provider".`;
        item.command = COMMANDS.setToken;
        break;

      case 'missingToken':
        item.text = '$(key) Git Pilot: Set Token';
        item.tooltip = `No ${view.platform === 'gitlab' ? 'GitLab' : 'GitHub'} token stored for ${view.host}. Click to add one.`;
        item.command = COMMANDS.setToken;
        break;

      case 'syncing':
        item.text = `$(sync~spin) Git Pilot: #${view.issueNumber}...`;
        item.tooltip = `Loading issue #${view.issueNumber}…`;
        break;

      case 'issueNotFound':
        item.text = `$(circle-slash) #${view.issueNumber}: not found`;
        item.tooltip = `Issue #${view.issueNumber} does not exist in ${view.projectPath} (or the token cannot see it). Click to retry.`;
        item.command = COMMANDS.refresh;
        break;

      case 'ready': {
        const { state } = view;
        const prefix = this.getPrefix();
        const plan = buildSyncPlan(state, prefix);
        const value = (label: string | null) => (label ? statusValue(label, prefix) : 'no status');
        if (plan.source && plan.status.length) {
          // The status differs from the MR/PR (the source of truth): one click opens the confirmed sync.
          const ref = entityName(state.platform, 'mr', plan.source);
          item.text = `$(warning) #${state.issue.id}: ${value(state.issue.statusLabel)} ≠ ${ref}: ${value(plan.source.statusLabel)}`;
          item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
          item.command = COMMANDS.syncFromMr;
        } else {
          const mrPart = this.mrSummary(state);
          item.text = `$(tag) #${state.issue.id}: ${value(state.issue.statusLabel)}${mrPart ? ` (${mrPart})` : ''}${plan.labels.length ? ' $(diff)' : ''}`;
        }
        item.tooltip = this.tooltip(state, view.lastSyncAt, plan.status.length > 0, hasChanges(plan));
        break;
      }

      case 'error':
        item.text = view.authError ? '$(key) Git Pilot: Token rejected' : `$(error) Git Pilot${view.issueNumber ? `: #${view.issueNumber}` : ''}`;
        item.tooltip = `${view.message}\n\nClick to ${view.authError ? 'update the token' : 'retry'}.`;
        item.command = view.authError ? COMMANDS.setToken : COMMANDS.refresh;
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
    }
    item.show();
  }

  private mrSummary(state: SyncState): string {
    const [first, ...rest] = state.mergeRequests;
    if (!first) {
      return '';
    }
    return `${mrTerm(state.platform)} ${mrRef(state.platform, first.id)}${rest.length ? ` +${rest.length}` : ''}`;
  }

  private tooltip(state: SyncState, lastSyncAt: Date, statusDiffers: boolean, outOfSync: boolean): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = { enabledCommands: [COMMANDS.selectStatus, COMMANDS.refresh, COMMANDS.syncFromMr] };
    const term = mrTerm(state.platform);
    const note = statusDiffers ? ' $(warning) _status differs_' : outOfSync ? ' $(diff) _labels differ_' : '';

    md.appendMarkdown(`**Git Pilot — Issue & ${term}**${note}\n\n`);
    md.appendMarkdown(`$(issues) Issue [#${state.issue.id} ${escapeMd(state.issue.title)}](${state.issue.webUrl}) — ${code(state.issue.statusLabel)}\n\n`);
    if (state.mergeRequests.length === 0) {
      md.appendMarkdown(`$(git-pull-request) _No open ${term} linked to this issue or branch_\n\n`);
    }
    for (const mr of state.mergeRequests) {
      md.appendMarkdown(
        `$(git-pull-request) ${term} [${mrRef(state.platform, mr.id)} ${escapeMd(mr.title)}](${mr.webUrl}) — ${code(mr.statusLabel)}\n\n`,
      );
    }
    md.appendMarkdown(`---\n\n`);
    const sync = outOfSync ? `[$(sync) Sync from ${term}…](command:${COMMANDS.syncFromMr}) · ` : '';
    md.appendMarkdown(
      `${sync}[$(tag) Change status](command:${COMMANDS.selectStatus}) · [$(refresh) Refresh](command:${COMMANDS.refresh}) · _updated ${lastSyncAt.toLocaleTimeString()}_`,
    );
    return md;
  }

  // -------------------------------------------------------------------------
  // QuickPick
  // -------------------------------------------------------------------------

  /**
   * Shows available status labels (with `$(check)` on the current one) plus quick actions.
   * Only labels that exist in the project are offered; new labels are never created.
   */
  async pickStatus(state: SyncState, conflict?: Conflict, outOfSync = false): Promise<StatusPickResult | undefined> {
    type Item = vscode.QuickPickItem & { result?: StatusPickResult };
    const prefix = this.getPrefix();
    const term = mrTerm(state.platform);
    const current = state.issue.statusLabel;

    const statusItems: Item[] = state.availableStatusLabels.map((label) => {
      const isCurrent = sameStatus(label, current);
      const marks: string[] = [];
      if (isCurrent) {
        marks.push('current');
      }
      if (conflict && sameStatus(label, conflict.issueStatus)) {
        marks.push('Issue');
      }
      if (conflict && sameStatus(label, conflict.mrStatus)) {
        marks.push(`${term} ${mrRef(state.platform, conflict.mr.id)}`);
      }
      return {
        label: `${isCurrent ? '$(check)' : '$(tag)'} ${label}`,
        description: marks.join(' · ') || undefined,
        result: { type: 'status', label },
      };
    });

    const actionItems: Item[] = [
      ...(outOfSync ? [{ label: `$(sync) Sync Labels from ${term}…`, result: { type: 'syncFromMr' } } as Item] : []),
      { label: '$(refresh) Refresh', result: { type: 'refresh' } },
      { label: '$(issues) Open Issue in Browser', description: `#${state.issue.id}`, result: { type: 'open', url: state.issue.webUrl } },
      ...state.mergeRequests.map<Item>((mr) => ({
        label: `$(git-pull-request) Open ${term} in Browser`,
        description: `${mrRef(state.platform, mr.id)} ${mr.title}`,
        result: { type: 'open', url: mr.webUrl },
      })),
      { label: '$(key) Update API Token', result: { type: 'setToken' } },
    ];

    const baseItems: Item[] = [
      { label: 'Status labels', kind: vscode.QuickPickItemKind.Separator },
      ...(statusItems.length
        ? statusItems
        : [{ label: `$(info) No labels starting with "${prefix}" found in the project`, alwaysShow: true } as Item]),
      { label: 'Actions', kind: vscode.QuickPickItemKind.Separator },
      ...actionItems,
    ];

    const qp = vscode.window.createQuickPick<Item>();
    qp.title = conflict
      ? `Status for #${state.issue.id} (differs from ${term} ${mrRef(state.platform, conflict.mr.id)})`
      : `Status for #${state.issue.id}${state.mergeRequests.length ? ` and ${state.mergeRequests.length} open ${term}` : ''}`;
    qp.placeholder = `Select a status to apply to the issue and all open ${term}s`;
    qp.matchOnDescription = true;
    qp.items = baseItems;

    return new Promise<StatusPickResult | undefined>((resolve) => {
      let done = false;
      qp.onDidAccept(() => {
        const result = qp.selectedItems[0]?.result;
        if (result) {
          done = true;
          resolve(result);
          qp.hide();
        }
      });
      qp.onDidHide(() => {
        if (!done) {
          resolve(undefined);
        }
        qp.dispose();
      });
      qp.show();
    });
  }

  flash(message: string, timeoutMs = 5000): void {
    vscode.window.setStatusBarMessage(message, timeoutMs);
  }

  dispose(): void {
    this.item.dispose();
  }
}
