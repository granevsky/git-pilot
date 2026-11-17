import * as vscode from 'vscode';
import { oneLine } from '../../core/format';
import { groupLabels, labelGroup } from '../../core/labels';
import { isStatusLabel } from '../../core/providers/baseProvider';
import type { ProjectLabel } from '../../core/types';

export interface LabelPickOptions {
  title: string;
  placeholder?: string;
  projectLabels: readonly ProjectLabel[];
  /** Labels already present on every target (lower-case) — not offered. */
  exclude: ReadonlySet<string>;
  /** Labels currently on the target(s); used for "replaces …" hints. */
  current: readonly string[];
  masks: readonly string[];
  statusPrefix: string;
  /** Single choice restricted to one group (replace flow). */
  onlyGroup?: string;
}

type Item = vscode.QuickPickItem & { name?: string; groupKey?: string | null };

/**
 * Picks existing (non-status) project labels. Several labels can be chosen, but at most one per
 * group (`app:*`): selecting another label of the same group deselects the previous one, because
 * group labels are mutually exclusive on an Issue/MR. Labels without a group can be combined freely.
 */
export function pickLabels(opts: LabelPickOptions): Promise<string[] | undefined> {
  const single = opts.onlyGroup !== undefined;
  const candidates = opts.projectLabels
    .map((l) => l.name)
    .filter((name) => !isStatusLabel(name, opts.statusPrefix) && !opts.exclude.has(name.toLowerCase()))
    .filter((name) => !single || labelGroup(name, opts.masks)?.key === opts.onlyGroup);
  const descriptions = new Map(opts.projectLabels.map((l) => [l.name.toLowerCase(), l.description]));

  const currentByGroup = new Map<string, string[]>();
  for (const label of opts.current) {
    const key = labelGroup(label, opts.masks)?.key;
    if (key && !isStatusLabel(label, opts.statusPrefix)) {
      currentByGroup.set(key, [...(currentByGroup.get(key) ?? []), label]);
    }
  }

  const items: Item[] = [];
  for (const group of groupLabels(candidates, opts.masks)) {
    if (!single) {
      items.push({ label: group.isOther ? 'Other (any number)' : `${group.title} (one per issue / MR)`, kind: vscode.QuickPickItemKind.Separator });
    }
    for (const name of group.labels) {
      const groupKey = group.isOther ? null : group.key;
      const replaces = groupKey ? currentByGroup.get(groupKey) : undefined;
      const description = descriptions.get(name.toLowerCase());
      items.push({
        label: `$(tag) ${oneLine(name)}`,
        description: replaces?.length ? `replaces ${replaces.join(', ')}` : undefined,
        detail: description ? oneLine(description, 200) : undefined,
        name,
        groupKey,
      });
    }
  }

  if (!items.some((i) => i.name)) {
    void vscode.window.showInformationMessage(
      single ? 'Git Pilot: no other labels in this group.' : 'Git Pilot: all project labels are already applied.',
    );
    return Promise.resolve(undefined);
  }

  const qp = vscode.window.createQuickPick<Item>();
  qp.title = opts.title;
  qp.placeholder = opts.placeholder ?? (single ? 'Select the replacement label' : 'Select labels to add (one per group)');
  qp.canSelectMany = !single;
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  qp.items = items;

  let previous = new Set<Item>();
  qp.onDidChangeSelection((selection) => {
    if (single) {
      return;
    }
    const added = selection.filter((i) => !previous.has(i));
    let next = [...selection];
    for (const item of added) {
      if (item.groupKey) {
        next = next.filter((i) => i === item || i.groupKey !== item.groupKey);
      }
    }
    previous = new Set(next);
    if (next.length !== selection.length) {
      qp.selectedItems = next;
    }
  });

  return new Promise<string[] | undefined>((resolve) => {
    let done = false;
    qp.onDidAccept(() => {
      const chosen = (single ? qp.activeItems : qp.selectedItems).map((i) => i.name).filter((n): n is string => !!n);
      if (!chosen.length) {
        return;
      }
      done = true;
      resolve(chosen);
      qp.hide();
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

/** Asks where to apply a label change: the Issue, one MR/PR, or everywhere. Returns entity keys. */
export async function pickTargets(
  title: string,
  targets: ReadonlyArray<{ key: string; label: string; description: string }>,
  placeHolder = 'Where should the labels be added?',
  allLabel = '$(layers) Issue and all open MRs/PRs',
): Promise<string[] | undefined> {
  if (targets.length <= 1) {
    return targets.map((t) => t.key);
  }
  type TargetItem = vscode.QuickPickItem & { keys: string[] };
  const items: TargetItem[] = [
    ...targets.map((t) => ({ label: t.label, description: oneLine(t.description, 120), keys: [t.key] })),
    { label: '', kind: vscode.QuickPickItemKind.Separator, keys: [] },
    { label: allLabel, keys: targets.map((t) => t.key) },
  ];
  const pick = await vscode.window.showQuickPick(items, { title, placeHolder });
  return pick?.keys;
}
