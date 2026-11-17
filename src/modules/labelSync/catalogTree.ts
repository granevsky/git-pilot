import * as vscode from 'vscode';
import { mrRef, mrTerm, oneLine } from '../../core/format';
import { groupLabels } from '../../core/labels';
import { isStatusLabel } from '../../core/providers/baseProvider';
import type { ProjectLabel, SyncState } from '../../core/types';
import { TreeNode } from '../../core/ui/sectionView';
import { COMMANDS } from './statusBarUi';

/** Stable id of the "All labels" node; the module watches its expansion to load the catalog lazily. */
export const ALL_LABELS_ID = 'allLabels';

/** The project's label catalog as last loaded. */
export interface CatalogData {
  projectPath: string;
  /** `null` when the provider cannot list project labels. */
  labels: ProjectLabel[] | null;
  error: string | null;
}

export interface AllLabelsInput {
  /** `null` while the catalog has not been loaded yet. */
  catalog: CatalogData | null;
  /** Current Issue/MR state (for "applied" marks), if it belongs to the catalog's project. */
  state: SyncState | null;
  statusPrefix: string;
  masks: string[];
}

const APPLIED_COLOR = new vscode.ThemeColor('charts.green');

function info(label: string, icon: string, tooltip?: string, command?: string): TreeNode {
  return new TreeNode({ label, icon, tooltip: tooltip ?? label, command });
}

/**
 * The "All labels" node: the project's label catalog grouped by prefix (`status:*`, `app:*`, …) or
 * configured masks, "Other" last. Labels applied to the current Issue / MRs get a ✓ and show where
 * they are applied. Collapsed by default; its children are built from the lazily loaded catalog.
 */
export function buildAllLabelsNode(s: AllLabelsInput): TreeNode {
  const base = { id: ALL_LABELS_ID, label: 'All labels', icon: 'list-unordered', expanded: false };
  if (!s.catalog) {
    return new TreeNode({ ...base, tooltip: 'All labels of the project', children: [info('Loading…', 'loading~spin')] });
  }

  const { catalog } = s;
  const state = s.state?.projectPath === catalog.projectPath ? s.state : null;
  const children: TreeNode[] = [];
  if (catalog.error) {
    children.push(info('Could not load project labels', 'warning', catalog.error, COMMANDS.refresh));
  }

  const places: Array<{ name: string; labels: Set<string> }> = [];
  if (state) {
    const term = mrTerm(state.platform);
    places.push({ name: 'Issue', labels: new Set(state.issue.allLabels.map((l) => l.toLowerCase())) });
    for (const mr of state.mergeRequests) {
      places.push({ name: `${term} ${mrRef(state.platform, mr.id)}`, labels: new Set(mr.allLabels.map((l) => l.toLowerCase())) });
    }
  }

  const descriptions = new Map((catalog.labels ?? []).map((l) => [l.name.toLowerCase(), l.description]));
  const names = (catalog.labels ?? []).map((l) => l.name);
  // Applied labels missing from the project list (deleted, foreign group…) are still shown.
  for (const entity of state ? [state.issue, ...state.mergeRequests] : []) {
    names.push(...entity.allLabels);
  }

  const groups = groupLabels(names, s.masks);
  let total = 0;
  for (const group of groups) {
    let applied = 0;
    const groupId = `${ALL_LABELS_ID}/group:${group.key}`;
    const labelNodes = group.labels.map((name) => {
      const key = name.toLowerCase();
      const where = places.filter((p) => p.labels.has(key)).map((p) => p.name);
      if (where.length) {
        applied++;
      }
      const description = descriptions.get(key);
      const isStatus = isStatusLabel(name, s.statusPrefix);
      return new TreeNode({
        id: `${groupId}/${key}`,
        label: oneLine(name),
        description: where.join(' · ') || undefined,
        tooltip: [name, description ? oneLine(description, 500) : '', where.length ? `Applied to: ${where.join(', ')}` : 'Not applied']
          .filter(Boolean)
          .join('\n'),
        icon: where.length ? new vscode.ThemeIcon('check', APPLIED_COLOR) : 'tag',
        // `+` while some Issue/MR lacks the label, `✕` while it is applied somewhere. Status labels are
        // changed only via "Apply Status". Flags must not be substrings of each other (menus use `=~ /flag/`).
        contextValue: isStatus
          ? 'statusLabel'
          : ['catalogLabel', !places.length || where.length < places.length ? 'canAdd' : '', where.length ? 'canRemove' : '']
              .filter(Boolean)
              .join(' '),
        value: name,
      });
    });
    total += group.labels.length;
    children.push(
      new TreeNode({
        id: groupId,
        label: oneLine(group.title),
        description: `${group.labels.length}${applied ? ` · ${applied} applied` : ''}`,
        tooltip: group.isOther ? 'Labels without a group — several can be applied at once' : `Labels matching ${group.title} — one per issue / MR`,
        icon: group.isOther ? 'question' : 'folder',
        children: labelNodes,
        expanded: groups.length === 1,
      }),
    );
  }
  if (!groups.length && !catalog.error) {
    children.push(info(catalog.labels ? 'No labels in this project' : 'This platform cannot list project labels', 'circle-slash'));
  }

  return new TreeNode({
    ...base,
    description: total ? `${total}` : undefined,
    tooltip: `All labels of ${catalog.projectPath}. Use + / ✕ to attach or detach a label, ✓ to apply a status.`,
    children,
  });
}
