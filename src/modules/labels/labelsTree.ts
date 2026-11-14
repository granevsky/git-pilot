import * as vscode from 'vscode';
import { mrRef, mrTerm, oneLine } from '../../core/format';
import { groupLabels } from '../../core/labels';
import { isStatusLabel } from '../../core/providers/baseProvider';
import type { ProjectLabel, SyncState } from '../../core/types';
import { TreeNode } from '../../core/ui/sectionView';

/** Everything the Labels catalog renders. */
export interface CatalogSnapshot {
  /** `null` when the provider cannot list project labels. */
  projectLabels: ProjectLabel[] | null;
  labelsError: string | null;
  /** Current Issue/MR state from Status Sync (for "applied" marks), if it belongs to this project. */
  state: SyncState | null;
  statusPrefix: string;
  masks: string[];
}

export const LABEL_COMMANDS = {
  refresh: 'gitPilot.labels.refresh',
  copyName: 'gitPilot.labels.copyName',
} as const;

const APPLIED_COLOR = new vscode.ThemeColor('charts.green');

export function info(label: string, icon: string, tooltip?: string, command?: string): TreeNode {
  return new TreeNode({ label, icon, tooltip: tooltip ?? label, command });
}

/**
 * Project label catalog grouped by prefix (`status:*`, `app:*`, …) or configured masks, "Other"
 * last. Labels applied to the current Issue / MRs get a ✓ and show where they are applied.
 */
export function buildCatalogTree(s: CatalogSnapshot): TreeNode[] {
  const roots: TreeNode[] = [];
  if (s.labelsError) {
    roots.push(info('Could not load project labels', 'warning', s.labelsError, LABEL_COMMANDS.refresh));
  }

  const places: Array<{ name: string; labels: Set<string> }> = [];
  if (s.state) {
    const term = mrTerm(s.state.platform);
    places.push({ name: 'Issue', labels: new Set(s.state.issue.allLabels.map((l) => l.toLowerCase())) });
    for (const mr of s.state.mergeRequests) {
      places.push({ name: `${term} ${mrRef(s.state.platform, mr.id)}`, labels: new Set(mr.allLabels.map((l) => l.toLowerCase())) });
    }
  }

  const descriptions = new Map((s.projectLabels ?? []).map((l) => [l.name.toLowerCase(), l.description]));
  const names = (s.projectLabels ?? []).map((l) => l.name);
  // Applied labels missing from the project list (deleted, foreign group…) are still shown.
  for (const entity of s.state ? [s.state.issue, ...s.state.mergeRequests] : []) {
    names.push(...entity.allLabels);
  }

  const groups = groupLabels(names, s.masks);
  for (const group of groups) {
    let applied = 0;
    const children = group.labels.map((name) => {
      const key = name.toLowerCase();
      const where = places.filter((p) => p.labels.has(key)).map((p) => p.name);
      if (where.length) {
        applied++;
      }
      const description = descriptions.get(key);
      const isStatus = isStatusLabel(name, s.statusPrefix);
      return new TreeNode({
        id: `group:${group.key}/${key}`,
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
    roots.push(
      new TreeNode({
        id: `group:${group.key}`,
        label: oneLine(group.title),
        description: `${group.labels.length}${applied ? ` · ${applied} applied` : ''}`,
        tooltip: group.isOther ? 'Labels without a group — several can be applied at once' : `Labels matching ${group.title} — one per issue / MR`,
        icon: group.isOther ? 'question' : 'folder',
        children,
        expanded: groups.length === 1,
      }),
    );
  }
  if (!groups.length && !s.labelsError) {
    roots.push(info(s.projectLabels ? 'No labels in this project' : 'This platform cannot list project labels', 'circle-slash'));
  }
  return roots;
}
