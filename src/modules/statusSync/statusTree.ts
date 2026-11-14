import * as vscode from 'vscode';
import { mrRef, mrTerm, oneLine } from '../../core/format';
import { sameStatus, statusValue } from '../../core/providers/baseProvider';
import type { EntityRef, SyncState } from '../../core/types';
import { SectionView, TreeNode } from '../../core/ui/sectionView';
import { COMMANDS, type SyncViewState } from './statusBarUi';

export const STATUS_VIEW_ID = 'gitPilot.statusSync';

const OK_COLOR = new vscode.ThemeColor('charts.green');
const WARN_COLOR = new vscode.ThemeColor('problemsWarningIcon.foreground');
const ERROR_COLOR = new vscode.ThemeColor('problemsErrorIcon.foreground');

function node(label: string, icon: string | vscode.ThemeIcon, tooltip?: string, command?: string): TreeNode {
  return new TreeNode({ label, icon, tooltip: tooltip ?? label, command });
}

/** Sidebar section "Status Sync": renders the same view model as the status bar item. */
export class StatusTree implements vscode.Disposable {
  private readonly section = new SectionView(STATUS_VIEW_ID);

  constructor(private readonly getPrefix: () => string) {}

  render(view: SyncViewState): void {
    const s = this.section;
    switch (view.kind) {
      case 'disabled':
        s.description = undefined;
        return s.render([], 'Status Sync is disabled (gitPilot.statusSync.enabled).');
      case 'hidden':
        s.description = undefined;
        return s.render([], `${view.reason}.`);
      case 'noIssue':
        s.description = view.branch ?? undefined;
        return s.render([], view.reason);
      case 'unknownPlatform':
        s.description = undefined;
        return s.render([node(`Choose the platform for ${view.host}…`, 'question', 'Cannot tell whether this host is GitLab or GitHub.', COMMANDS.setToken)]);
      case 'missingToken':
        s.description = undefined;
        return s.render([node(`Set an API token for ${view.host}…`, 'key', 'No token stored for this host.', COMMANDS.setToken)]);
      case 'syncing':
        s.description = `#${view.issueNumber}`;
        return s.render([node(`Syncing issue #${view.issueNumber}…`, 'sync~spin')]);
      case 'issueNotFound':
        s.description = `#${view.issueNumber}`;
        return s.render([
          node(
            `Issue #${view.issueNumber} not found`,
            'circle-slash',
            `Issue #${view.issueNumber} does not exist in ${view.projectPath} (or the token cannot see it). Click to retry.`,
            COMMANDS.syncNow,
          ),
        ]);
      case 'error':
        s.description = view.issueNumber ? `#${view.issueNumber}` : undefined;
        return s.render([
          view.authError
            ? node('Token rejected — update the API token…', new vscode.ThemeIcon('key', ERROR_COLOR), view.message, COMMANDS.setToken)
            : node(oneLine(view.message), new vscode.ThemeIcon('error', ERROR_COLOR), `${view.message}\n\nClick to retry.`, COMMANDS.syncNow),
        ]);
      case 'synced':
        s.description = `#${view.state.issue.id}`;
        return s.render(this.stateNodes(view.state, view.lastSyncAt, null));
      case 'conflict':
        s.description = `#${view.state.issue.id}`;
        return s.render(this.stateNodes(view.state, view.lastSyncAt, view));
    }
  }

  private value(label: string | null): string {
    return label ? statusValue(label, this.getPrefix()) : 'no status';
  }

  private stateNodes(state: SyncState, lastSyncAt: Date, conflict: { issueStatus: string; mrStatus: string; mr: EntityRef } | null): TreeNode[] {
    const term = mrTerm(state.platform);
    const time = lastSyncAt.toLocaleTimeString();
    const roots: TreeNode[] = [];

    if (conflict) {
      const ref = `${term} ${mrRef(state.platform, conflict.mr.id)}`;
      roots.push(
        new TreeNode({
          id: 'summary',
          label: 'Status conflict',
          description: `Issue: ${this.value(conflict.issueStatus)} ≠ ${ref}: ${this.value(conflict.mrStatus)}`,
          tooltip: `Issue #${state.issue.id} is "${conflict.issueStatus}" but ${ref} is "${conflict.mrStatus}". Choose which status wins.\nLast sync ${time}`,
          icon: new vscode.ThemeIcon('warning', WARN_COLOR),
          children: [
            this.applyNode('resolve:issue', `Use Issue status: ${oneLine(conflict.issueStatus)}`, conflict.issueStatus, 'issues'),
            this.applyNode('resolve:mr', `Use ${ref} status: ${oneLine(conflict.mrStatus)}`, conflict.mrStatus, 'git-pull-request'),
            node('Choose another status…', 'list-selection', undefined, COMMANDS.selectStatus),
          ],
        }),
      );
    } else {
      roots.push(
        new TreeNode({
          id: 'summary',
          label: 'In sync',
          description: `${this.value(state.issue.statusLabel)} · ${time}`,
          tooltip: `Issue and all open ${term}s carry ${state.issue.statusLabel ? `"${state.issue.statusLabel}"` : 'no status'}.\nLast sync ${time}`,
          icon: new vscode.ThemeIcon('pass', OK_COLOR),
        }),
      );
    }

    roots.push(this.entityNode('issue', `Issue #${state.issue.id}`, state.issue, 'issues'));
    for (const mr of state.mergeRequests) {
      roots.push(this.entityNode(`mr:${mr.projectRef ?? ''}!${mr.id}`, `${term} ${mrRef(state.platform, mr.id)}`, mr, 'git-pull-request'));
    }
    if (!state.mergeRequests.length) {
      roots.push(node(`No open ${term} linked to this issue or branch`, 'git-pull-request'));
    }

    const current = state.issue.statusLabel;
    const options = state.availableStatusLabels.map(
      (label) =>
        new TreeNode({
          id: `status:${label.toLowerCase()}`,
          label: oneLine(label),
          description: sameStatus(label, current) ? 'current' : undefined,
          tooltip: `Apply "${label}" to the issue and all open ${term}s`,
          icon: sameStatus(label, current) ? new vscode.ThemeIcon('check', OK_COLOR) : 'circle-outline',
          contextValue: sameStatus(label, current) ? 'statusOption current' : 'statusOption',
          value: label,
        }),
    );
    roots.push(
      new TreeNode({
        id: 'statuses',
        label: 'Statuses',
        description: `${options.length}`,
        tooltip: `Status labels (prefix "${this.getPrefix()}"). Use the ✓ button to apply one.`,
        icon: 'tag',
        children: options.length ? options : [node(`No labels starting with "${this.getPrefix()}"`, 'info', undefined, COMMANDS.selectStatus)],
        expanded: false,
      }),
    );
    return roots;
  }

  private entityNode(id: string, title: string, entity: EntityRef, icon: string): TreeNode {
    return new TreeNode({
      id,
      label: title,
      description: `${this.value(entity.statusLabel)} · ${oneLine(entity.title, 120)}`,
      tooltip: `${title}: ${oneLine(entity.title)}\nStatus: ${entity.statusLabel ?? 'none'}`,
      icon,
      contextValue: 'openable',
      url: entity.webUrl,
    });
  }

  private applyNode(id: string, label: string, status: string, icon: string): TreeNode {
    return new TreeNode({ id, label, icon, tooltip: label, value: status, command: COMMANDS.applyStatus });
  }

  dispose(): void {
    this.section.dispose();
  }
}
