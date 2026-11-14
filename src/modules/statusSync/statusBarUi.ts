import * as vscode from 'vscode';
import { sameStatus, statusValue } from '../../core/providers/baseProvider';
import { code, escapeMd, mrRef, mrTerm } from '../../core/format';
import type { EntityRef, Platform, SyncState } from '../../core/types';

// ---------------------------------------------------------------------------
// View model produced by the SyncEngine and rendered here
// ---------------------------------------------------------------------------

export type SyncViewState =
  | { kind: 'disabled' }
  | { kind: 'hidden'; reason: string }
  | { kind: 'noIssue'; branch: string | null; reason: string }
  | { kind: 'unknownPlatform'; host: string }
  | { kind: 'missingToken'; host: string; platform: Platform }
  | { kind: 'syncing'; issueNumber: number }
  | { kind: 'issueNotFound'; issueNumber: number; projectPath: string }
  | { kind: 'synced'; state: SyncState; lastSyncAt: Date }
  | { kind: 'conflict'; state: SyncState; issueStatus: string; mrStatus: string; mr: EntityRef; lastSyncAt: Date }
  | { kind: 'error'; issueNumber: number | null; message: string; authError: boolean };

export type StatusPickResult =
  | { type: 'status'; label: string }
  | { type: 'syncNow' }
  | { type: 'open'; url: string }
  | { type: 'setToken' };

export const COMMANDS = {
  setToken: 'gitPilot.setToken',
  selectStatus: 'gitPilot.statusSync.selectStatus',
  syncNow: 'gitPilot.statusSync.syncNow',
  openInBrowser: 'gitPilot.openInBrowser',
  applyStatus: 'gitPilot.statusSync.applyStatus',
  addLabel: 'gitPilot.statusSync.addLabel',
  removeLabel: 'gitPilot.statusSync.removeLabel',
  replaceLabel: 'gitPilot.statusSync.replaceLabel',
  copyLabel: 'gitPilot.statusSync.copyLabelToOthers',
} as const;

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

export class StatusBarUi implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly getPrefix: () => string) {
    this.item = vscode.window.createStatusBarItem('gitPilot.statusSync', vscode.StatusBarAlignment.Left, 50);
    this.item.name = 'Git Pilot: Status Sync';
  }

  render(view: SyncViewState): void {
    const item = this.item;
    item.backgroundColor = undefined;
    item.command = COMMANDS.selectStatus;

    switch (view.kind) {
      case 'disabled':
      case 'hidden':
        item.hide();
        return;

      case 'noIssue':
        item.text = '$(tag) Git Pilot';
        item.tooltip = new vscode.MarkdownString(`**Git Pilot** — ${escapeMd(view.reason)}`);
        item.command = COMMANDS.syncNow;
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
        item.tooltip = `Syncing issue #${view.issueNumber}…`;
        break;

      case 'issueNotFound':
        item.text = `$(circle-slash) #${view.issueNumber}: not found`;
        item.tooltip = `Issue #${view.issueNumber} does not exist in ${view.projectPath} (or the token cannot see it). Click to retry.`;
        item.command = COMMANDS.syncNow;
        break;

      case 'synced': {
        const { state } = view;
        const status = state.issue.statusLabel ?? 'no status';
        const mrPart = this.mrSummary(state);
        item.text = `$(tag) #${state.issue.id}: ${status}${mrPart ? ` (${mrPart})` : ''}`;
        item.tooltip = this.tooltip(state, view.lastSyncAt);
        break;
      }

      case 'conflict': {
        const prefix = this.getPrefix();
        const term = mrTerm(view.state.platform);
        item.text = `$(warning) #${view.state.issue.id}: ${statusValue(view.issueStatus, prefix)} ≠ ${term}: ${statusValue(view.mrStatus, prefix)}`;
        item.tooltip = this.tooltip(view.state, view.lastSyncAt, true);
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        break;
      }

      case 'error':
        item.text = view.authError ? '$(key) Git Pilot: Token rejected' : `$(error) Git Pilot${view.issueNumber ? `: #${view.issueNumber}` : ''}`;
        item.tooltip = `${view.message}\n\nClick to ${view.authError ? 'update the token' : 'retry'}.`;
        item.command = view.authError ? COMMANDS.setToken : COMMANDS.syncNow;
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

  private tooltip(state: SyncState, lastSyncAt: Date, conflict = false): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = { enabledCommands: [COMMANDS.selectStatus, COMMANDS.syncNow] };
    const term = mrTerm(state.platform);

    md.appendMarkdown(`**Git Pilot — Status Sync**${conflict ? ' $(warning) _conflict_' : ''}\n\n`);
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
    md.appendMarkdown(
      `[$(tag) Change status](command:${COMMANDS.selectStatus}) · [$(sync) Sync now](command:${COMMANDS.syncNow}) · _last sync ${lastSyncAt.toLocaleTimeString()}_`,
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
  async pickStatus(state: SyncState, conflict?: { issueStatus: string; mrStatus: string; mr: EntityRef }): Promise<StatusPickResult | undefined> {
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
      { label: '$(sync) Force Sync Now', result: { type: 'syncNow' } },
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
      ? `Resolve status conflict for #${state.issue.id}`
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
