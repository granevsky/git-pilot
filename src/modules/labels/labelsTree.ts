import * as vscode from 'vscode';
import { mrRef, mrTerm, oneLine } from '../../core/format';
import { isStatusLabel } from '../../core/providers/baseProvider';
import type { EntityRef, Platform, ProjectLabel } from '../../core/types';
import { TreeNode } from '../../core/ui/sectionView';
import { groupLabels } from './labelGroups';

/** Everything the Labels section renders; produced by the module, rendered by `buildLabelsTree`. */
export interface LabelsSnapshot {
  platform: Platform;
  projectPath: string;
  branch: string | null;
  /** Issue number derived from the branch, or `null` when the branch has none. */
  issueNumber: number | null;
  /** `null` with an `issueNumber` means the issue was not found. */
  issue: EntityRef | null;
  mergeRequests: EntityRef[];
  /** Error loading the issue / MRs (`labelsError` covers the project label list). */
  issueError: { message: string; authError: boolean } | null;
  /** `null` when the provider cannot list project labels. */
  projectLabels: ProjectLabel[] | null;
  labelsError: string | null;
  statusPrefix: string;
  masks: string[];
}

export const LABEL_COMMANDS = {
  refresh: 'gitPilot.labels.refresh',
  copyName: 'gitPilot.labels.copyName',
  openItem: 'gitPilot.openItem',
} as const;

const APPLIED_COLOR = new vscode.ThemeColor('charts.green');
const STATUS_COLOR = new vscode.ThemeColor('charts.blue');
const WARN_COLOR = new vscode.ThemeColor('problemsWarningIcon.foreground');

interface Place {
  /** `Issue` / `MR !5` / `PR #5`. */
  name: string;
  labels: Set<string>;
}

export function info(label: string, icon: string, tooltip?: string, command?: string | vscode.Command): TreeNode {
  return new TreeNode({ label, icon, tooltip: tooltip ?? label, command });
}

function labelContext(name: string, prefix: string): string {
  return isStatusLabel(name, prefix) ? 'label statusLabel' : 'label';
}

function lowerSet(labels: readonly string[]): Set<string> {
  return new Set(labels.map((l) => l.toLowerCase()));
}

/** Children of an Issue/MR node: its labels, status first, each marked where it is missing. */
function entityLabels(idBase: string, entity: EntityRef, others: Place[], prefix: string): TreeNode[] {
  if (!entity.allLabels.length) {
    return [info('No labels', 'circle-slash')];
  }
  const sorted = [...entity.allLabels].sort((a, b) => {
    const sa = isStatusLabel(a, prefix) ? 0 : 1;
    const sb = isStatusLabel(b, prefix) ? 0 : 1;
    return sa - sb || a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  });
  return sorted.map((name) => {
    const isStatus = isStatusLabel(name, prefix);
    const missing = others.filter((p) => !p.labels.has(name.toLowerCase())).map((p) => p.name);
    const notes = [isStatus ? 'status' : '', missing.length ? `not on ${missing.join(', ')}` : ''].filter(Boolean);
    return new TreeNode({
      id: `${idBase}/label:${name.toLowerCase()}`,
      label: oneLine(name),
      description: notes.join(' · ') || undefined,
      tooltip: `${name}${missing.length ? `\nMissing on: ${missing.join(', ')}` : ''}`,
      icon: new vscode.ThemeIcon('tag', isStatus ? STATUS_COLOR : missing.length ? WARN_COLOR : undefined),
      contextValue: labelContext(name, prefix),
      value: name,
    });
  });
}

function entityNode(id: string, title: string, entity: EntityRef, children: TreeNode[]): TreeNode {
  const count = entity.allLabels.length;
  return new TreeNode({
    id,
    label: title,
    description: oneLine(entity.title, 120),
    tooltip: `${title}: ${oneLine(entity.title)}\n${count} label${count === 1 ? '' : 's'}`,
    icon: id === 'issue' ? 'issues' : 'git-pull-request',
    contextValue: 'openable',
    url: entity.webUrl,
    children,
  });
}

/** "All labels": every project label (plus any applied label the project list lacks), grouped. */
function allLabelsNode(s: LabelsSnapshot, places: Place[]): TreeNode {
  const descriptions = new Map((s.projectLabels ?? []).map((l) => [l.name.toLowerCase(), l.description]));
  const names = (s.projectLabels ?? []).map((l) => l.name);
  // Applied labels missing from the project list (deleted, foreign group…) are still shown.
  for (const entity of [s.issue, ...s.mergeRequests]) {
    names.push(...(entity?.allLabels ?? []));
  }

  const groups = groupLabels(names, s.masks);
  const total = groups.reduce((n, g) => n + g.labels.length, 0);
  const appliedTotal = new Set(places.flatMap((p) => [...p.labels])).size;

  const groupNodes = groups.map((group) => {
    let applied = 0;
    const children = group.labels.map((name) => {
      const key = name.toLowerCase();
      const where = places.filter((p) => p.labels.has(key)).map((p) => p.name);
      if (where.length) {
        applied++;
      }
      const description = descriptions.get(key);
      return new TreeNode({
        id: `group:${group.key}/${key}`,
        label: oneLine(name),
        description: where.join(' · ') || undefined,
        tooltip: [name, description ? oneLine(description, 500) : '', where.length ? `Applied to: ${where.join(', ')}` : 'Not applied']
          .filter(Boolean)
          .join('\n'),
        icon: where.length ? new vscode.ThemeIcon('check', APPLIED_COLOR) : 'tag',
        contextValue: labelContext(name, s.statusPrefix),
        value: name,
      });
    });
    return new TreeNode({
      id: `group:${group.key}`,
      label: oneLine(group.title),
      description: `${group.labels.length}${applied ? ` · ${applied} applied` : ''}`,
      tooltip: group.isOther ? 'Labels that match no group mask' : `Labels matching ${group.title}`,
      icon: group.isOther ? 'question' : 'folder',
      children,
      expanded: groups.length === 1,
    });
  });

  return new TreeNode({
    id: 'all',
    label: 'All labels',
    description: `${total}${appliedTotal ? ` · ${appliedTotal} applied` : ''}`,
    tooltip: s.masks.length ? `Grouped by gitPilot.labels.groups: ${s.masks.join(', ')}` : 'Grouped by the prefix before ":" / "::"',
    icon: 'library',
    children: groupNodes.length ? groupNodes : [info('No labels in this project', 'circle-slash')],
    expanded: false,
  });
}

export function buildLabelsTree(s: LabelsSnapshot): TreeNode[] {
  const roots: TreeNode[] = [];
  const term = mrTerm(s.platform);
  const issuePlace: Place | null = s.issue ? { name: 'Issue', labels: lowerSet(s.issue.allLabels) } : null;
  const mrPlaces: Place[] = s.mergeRequests.map((mr) => ({ name: `${term} ${mrRef(s.platform, mr.id)}`, labels: lowerSet(mr.allLabels) }));
  const places = [...(issuePlace ? [issuePlace] : []), ...mrPlaces];

  if (s.issueError) {
    const { message, authError } = s.issueError;
    roots.push(
      authError
        ? info('Token rejected — update the API token…', 'key', message, 'gitPilot.setToken')
        : info(`Could not load issue #${s.issueNumber ?? '?'}`, 'error', message, LABEL_COMMANDS.refresh),
    );
  } else if (s.issue && issuePlace) {
    roots.push(entityNode('issue', `Issue #${s.issue.id}`, s.issue, entityLabels('issue', s.issue, mrPlaces, s.statusPrefix)));
  } else if (s.issueNumber !== null) {
    roots.push(info(`Issue #${s.issueNumber} not found`, 'circle-slash', `Issue #${s.issueNumber} does not exist in ${s.projectPath} (or the token cannot see it).`));
  } else {
    const why = s.branch ? `Branch "${s.branch}" contains no issue number (gitPilot.branchIssueRegex).` : 'Detached HEAD — no branch to derive an issue from.';
    roots.push(info('No issue linked to this branch', 'info', why));
  }

  s.mergeRequests.forEach((mr, i) => {
    const others = [...(issuePlace ? [issuePlace] : []), ...mrPlaces.filter((_, j) => j !== i)];
    const id = `mr:${mr.projectRef ?? ''}!${mr.id}`;
    roots.push(entityNode(id, `${term} ${mrRef(s.platform, mr.id)}`, mr, entityLabels(id, mr, others, s.statusPrefix)));
  });
  if (s.issue && !s.mergeRequests.length) {
    roots.push(info(`No open ${term} linked to this issue or branch`, 'git-pull-request'));
  }

  if (s.labelsError) {
    roots.push(info('Could not load project labels', 'warning', s.labelsError, LABEL_COMMANDS.refresh));
  }
  if (s.projectLabels || places.length) {
    roots.push(allLabelsNode(s, places));
  }
  return roots;
}
