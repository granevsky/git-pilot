// Pure label grouping rules shared by the sidebar sections (no VS Code dependencies; safe to unit test).
//
// A "group" is either a configured mask (`gitPilot.labels.groups`, e.g. `app:*`) or, when no masks
// are configured, the prefix before `:` / `::` (`app:web` → `app`). Labels of one group are mutually
// exclusive on an Issue/MR (like scoped labels); labels without a group ("Other") can be combined.

export interface LabelGroup {
  /** Stable, case-insensitive key (used for tree item ids); `OTHER_GROUP_KEY` for "Other". */
  key: string;
  /** Display title, e.g. `status:*`. */
  title: string;
  labels: string[];
  /** The catch-all group for labels that match no mask / have no prefix. */
  isOther: boolean;
}

export const OTHER_GROUP_KEY = '\u0000other';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles a grouping mask into an anchored, case-insensitive RegExp.
 * `*` = any characters, `?` = one character. A `:` / `::` in the mask matches either form
 * (with optional surrounding spaces), so `status:*` also covers `status::done` and `status: done`.
 */
export function maskToRegExp(mask: string): RegExp {
  const glob = (part: string) =>
    [...part.replace(/\*+/g, '*')].map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : escapeRegExp(ch))).join('');
  const source = mask.trim().split(/\s*:+\s*/).map(glob).join('\\s*::?\\s*');
  return new RegExp(`^\\s*${source}\\s*$`, 'is');
}

const compiledMasks = new Map<string, RegExp>();
function maskRegExp(mask: string): RegExp {
  let regex = compiledMasks.get(mask);
  if (!regex) {
    regex = maskToRegExp(mask);
    if (compiledMasks.size > 200) {
      compiledMasks.clear();
    }
    compiledMasks.set(mask, regex);
  }
  return regex;
}

/** `"status::done"` / `"Status: done"` → `"status"`; `null` when the label has no `prefix:` part. */
export function labelPrefix(label: string): string | null {
  const match = /^\s*([^:]*[^:\s])\s*::?\s*\S/.exec(label);
  return match ? match[1] : null;
}

/** The label's group (`key` + display `title`), or `null` when it belongs to "Other". */
export function labelGroup(label: string, masks: readonly string[]): { key: string; title: string } | null {
  if (masks.length) {
    const mask = masks.find((m) => maskRegExp(m).test(label));
    return mask ? { key: `mask:${mask.toLowerCase()}`, title: mask } : null;
  }
  const prefix = labelPrefix(label);
  return prefix ? { key: `prefix:${prefix.toLowerCase()}`, title: `${prefix}:*` } : null;
}

/**
 * Labels in `current` that must be removed when `add` is applied: every label sharing a group
 * with an added label (one label per group). Labels without a group never conflict.
 */
export function exclusiveRemovals(current: readonly string[], add: readonly string[], masks: readonly string[]): string[] {
  const adding = new Set(add.map((l) => l.toLowerCase()));
  const groups = new Set(add.map((l) => labelGroup(l, masks)?.key).filter((k): k is string => !!k));
  if (!groups.size) {
    return [];
  }
  return current.filter((l) => {
    const key = labelGroup(l, masks)?.key;
    return !!key && groups.has(key) && !adding.has(l.toLowerCase());
  });
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Groups labels (de-duplicated case-insensitively). Mask groups keep the mask order, prefix groups
 * are sorted by name; the "Other" group comes last. Empty groups are omitted.
 */
export function groupLabels(labels: readonly string[], masks: readonly string[], otherTitle = 'Other'): LabelGroup[] {
  const unique = new Map<string, string>();
  for (const label of labels) {
    const key = label.toLowerCase();
    if (label.trim() && !unique.has(key)) {
      unique.set(key, label);
    }
  }

  const groups = new Map<string, LabelGroup>();
  const other: LabelGroup = { key: OTHER_GROUP_KEY, title: otherTitle, labels: [], isOther: true };
  for (const label of unique.values()) {
    const g = labelGroup(label, masks);
    if (!g) {
      other.labels.push(label);
      continue;
    }
    let group = groups.get(g.key);
    if (!group) {
      group = { key: g.key, title: g.title, labels: [], isOther: false };
      groups.set(g.key, group);
    }
    group.labels.push(label);
  }

  const ordered = [...groups.values()];
  if (masks.length) {
    const order = new Map(masks.map((m, i) => [`mask:${m.toLowerCase()}`, i]));
    ordered.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  } else {
    ordered.sort((a, b) => byName(a.title, b.title));
  }
  if (other.labels.length) {
    ordered.push(other);
  }
  // Inside a prefix group sort by the value, so `status::done` < `status: todo` regardless of `:`/`::`.
  const value = (label: string) => label.replace(/^[^:]*::?\s*/, '');
  for (const group of ordered) {
    group.labels.sort(group.isOther ? byName : (a, b) => byName(value(a), value(b)) || byName(a, b));
  }
  return ordered;
}
