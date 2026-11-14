import * as vscode from 'vscode';
import { mrRef, mrTerm, oneLine } from '../../core/format';
import { labelGroup } from '../../core/labels';
import { isStatusLabel, sameStatus, statusValue } from '../../core/providers/baseProvider';
import type { EntityKind, EntityRef, SyncState } from '../../core/types';
import { SectionView, TreeNode } from '../../core/ui/sectionView';
import { COMMANDS, type SyncViewState } from './statusBarUi';
import { type SyncPlan, buildSyncPlan, describeChanges, entityKey, entityName, hasChanges } from './syncPlan';

export const STATUS_VIEW_ID = 'gitPilot.statusSync';

const OK_COLOR = new vscode.ThemeColor('charts.green');
const STATUS_COLOR = new vscode.ThemeColor('charts.blue');
const WARN_COLOR = new vscode.ThemeColor('problemsWarningIcon.foreground');
const ERROR_COLOR = new vscode.ThemeColor('problemsErrorIcon.foreground');

function node(label: string, icon: string | vscode.ThemeIcon, tooltip?: string, command?: string): TreeNode {
  return new TreeNode({ label, icon, tooltip: tooltip ?? label, command });
}

interface Place {
  key: string;
  /** `Issue` / `MR !5` / `PR #5`. */
  name: string;
  labels: Set<string>;
}

export interface StatusTreeSettings {
  prefix: string;
  masks: string[];
}

/**
 * Sidebar section "Issue & MR": sync status (quick status change, confirmed sync from the MR/PR),
 * the current Issue and its open MRs/PRs with their labels (add / remove / replace / copy), and
 * the list of status labels. Renders the same view model as the status bar item.
 */
export class StatusTree implements vscode.Disposable {
  private readonly section = new SectionView(STATUS_VIEW_ID, { showCollapseAll: true });

  constructor(private readonly getSettings: () => StatusTreeSettings) {}

  render(view: SyncViewState): void {
    const s = this.section;
    const settings = this.getSettings();
    switch (view.kind) {
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
        return s.render([node(`Loading issue #${view.issueNumber}…`, 'sync~spin')]);
      case 'issueNotFound':
        s.description = `#${view.issueNumber}`;
        return s.render([
          node(
            `Issue #${view.issueNumber} not found`,
            'circle-slash',
            `Issue #${view.issueNumber} does not exist in ${view.projectPath} (or the token cannot see it). Click to retry.`,
            COMMANDS.refresh,
          ),
        ]);
      case 'error':
        s.description = view.issueNumber ? `#${view.issueNumber}` : undefined;
        return s.render([
          view.authError
            ? node('Token rejected — update the API token…', new vscode.ThemeIcon('key', ERROR_COLOR), view.message, COMMANDS.setToken)
            : node(oneLine(view.message), new vscode.ThemeIcon('error', ERROR_COLOR), `${view.message}\n\nClick to retry.`, COMMANDS.refresh),
        ]);
      case 'ready':
        s.description = `#${view.state.issue.id}`;
        return s.render(this.stateNodes(view.state, view.lastSyncAt, settings));
    }
  }

  private stateNodes(state: SyncState, lastSyncAt: Date, settings: StatusTreeSettings): TreeNode[] {
    const term = mrTerm(state.platform);
    const value = (label: string | null) => (label ? statusValue(label, settings.prefix) : 'no status');
    const time = lastSyncAt.toLocaleTimeString();
    const roots: TreeNode[] = [];

    // 1. Summary — "change status" entry point; when the Issue differs from the MR/PR, the sync action.
    const plan = buildSyncPlan(state, settings.prefix);
    roots.push(this.summaryNode(state, plan, time, value));

    // 2. Issue and MRs with their labels.
    const places: Place[] = [
      { key: 'issue', name: 'Issue', labels: lowerSet(state.issue.allLabels) },
      ...state.mergeRequests.map((mr) => ({
        key: entityKey('mr', mr),
        name: `${term} ${mrRef(state.platform, mr.id)}`,
        labels: lowerSet(mr.allLabels),
      })),
    ];
    roots.push(this.entityNode('issue', `Issue #${state.issue.id}`, state.issue, places, settings));
    for (const mr of state.mergeRequests) {
      roots.push(this.entityNode('mr', `${term} ${mrRef(state.platform, mr.id)}`, mr, places, settings));
    }
    if (!state.mergeRequests.length) {
      roots.push(node(`No open ${term} linked to this issue or branch`, 'git-pull-request'));
    }

    // 3. Status list.
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
        tooltip: `Status labels (prefix "${settings.prefix}"). Use the ✓ button to apply one.`,
        icon: 'list-unordered',
        children: options.length ? options : [node(`No labels starting with "${settings.prefix}"`, 'info')],
        expanded: false,
      }),
    );
    return roots;
  }

  private entityNode(kind: EntityKind, title: string, entity: EntityRef, places: Place[], settings: StatusTreeSettings): TreeNode {
    const key = entityKey(kind, entity);
    const others = places.filter((p) => p.key !== key);
    const count = entity.allLabels.length;
    return new TreeNode({
      id: key,
      label: title,
      description: oneLine(entity.title, 120),
      tooltip: `${title}: ${oneLine(entity.title)}\nStatus: ${entity.statusLabel ?? 'none'}\n${count} label${count === 1 ? '' : 's'}`,
      icon: kind === 'issue' ? 'issues' : 'git-pull-request',
      // Flags must not be substrings of each other: menus match them with plain `=~ /flag/`.
      contextValue: 'openable issueOrMr',
      url: entity.webUrl,
      entity: key,
      children: this.labelNodes(key, entity, others, settings),
    });
  }

  /** Labels of one Issue/MR, status first; each marked where it is missing. */
  private labelNodes(key: string, entity: EntityRef, others: Place[], settings: StatusTreeSettings): TreeNode[] {
    if (!entity.allLabels.length) {
      return [new TreeNode({ label: 'No labels — add…', icon: 'add', tooltip: 'Add labels', entity: key, command: COMMANDS.addLabel })];
    }
    const sorted = [...entity.allLabels].sort((a, b) => {
      const sa = isStatusLabel(a, settings.prefix) ? 0 : 1;
      const sb = isStatusLabel(b, settings.prefix) ? 0 : 1;
      return sa - sb || a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
    });
    return sorted.map((name) => {
      const isStatus = isStatusLabel(name, settings.prefix);
      const missing = others.filter((p) => !p.labels.has(name.toLowerCase())).map((p) => p.name);
      const grouped = !!labelGroup(name, settings.masks);
      const flags = isStatus ? ['entityStatus'] : ['entityLabel', grouped ? 'grouped' : '', missing.length ? 'missingElsewhere' : ''];
      const notes = [isStatus ? 'status' : '', missing.length ? `not on ${missing.join(', ')}` : ''].filter(Boolean);
      return new TreeNode({
        id: `${key}/label:${name.toLowerCase()}`,
        label: oneLine(name),
        description: notes.join(' · ') || undefined,
        tooltip: [
          name,
          missing.length ? `Missing on: ${missing.join(', ')}` : '',
          isStatus ? 'Status label — change it with "Change Status".' : grouped ? 'Group label: one per issue / MR.' : '',
        ]
          .filter(Boolean)
          .join('\n'),
        icon: new vscode.ThemeIcon('tag', isStatus ? STATUS_COLOR : missing.length ? WARN_COLOR : undefined),
        contextValue: flags.filter(Boolean).join(' '),
        value: name,
        entity: key,
      });
    });
  }

  private summaryNode(state: SyncState, plan: SyncPlan, time: string, value: (label: string | null) => string): TreeNode {
    const term = mrTerm(state.platform);
    const source = plan.source;
    if (!source || !hasChanges(plan)) {
      return new TreeNode({
        id: 'summary',
        label: `Status: ${value(state.issue.statusLabel)}`,
        description: `${source ? 'in sync' : `no open ${term}`} · ${time}`,
        tooltip: `${source ? `Issue and all open ${term}s carry the same labels.` : `No open ${term} is linked to this issue or branch.`}\nClick to change the status.\nUpdated ${time}`,
        icon: new vscode.ThemeIcon('pass', OK_COLOR),
        contextValue: 'summary',
        command: COMMANDS.selectStatus,
      });
    }
    const ref = entityName(state.platform, 'mr', source);
    const statusDiffers = plan.status.length > 0;
    // Show what "Sync All Labels" would change (a superset of the status changes on the other items).
    const changes = plan.labels.length ? plan.labels : plan.status;
    const lines = describeChanges(state.platform, changes);
    return new TreeNode({
      id: 'summary',
      label: statusDiffers ? 'Status differs' : 'Labels differ',
      description: statusDiffers
        ? `Issue: ${value(state.issue.statusLabel)} ≠ ${ref}: ${value(source.statusLabel)}`
        : `from ${ref} · ${time}`,
      tooltip: `${ref} is the source of truth. Click to review and sync labels from it.\n\n${lines.join('\n')}\n\nUpdated ${time}`,
      icon: new vscode.ThemeIcon('warning', WARN_COLOR),
      contextValue: 'summary outOfSync',
      command: COMMANDS.syncFromMr,
      expanded: false,
      children: [
        new TreeNode({ id: 'summary/sync', label: `Sync from ${ref}…`, icon: 'sync', tooltip: `Review and confirm the changes`, command: COMMANDS.syncFromMr }),
        ...changes.map(
          (c, i) =>
            new TreeNode({
              id: `summary/diff:${c.key}`,
              label: entityName(state.platform, c.kind, c.entity),
              description: lines[i].slice(lines[i].indexOf(': ') + 2),
              tooltip: lines[i],
              icon: 'diff',
            }),
        ),
        node('Choose another status…', 'list-selection', undefined, COMMANDS.selectStatus),
      ],
    });
  }

  dispose(): void {
    this.section.dispose();
  }
}

function lowerSet(labels: readonly string[]): Set<string> {
  return new Set(labels.map((l) => l.toLowerCase()));
}
