// Pure label grouping (no VS Code dependencies; safe to unit test).

export interface LabelGroup {
  /** Stable, case-insensitive key (used for tree item ids). */
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

/** `"status::done"` / `"Status: done"` → `"status"`; `null` when the label has no `prefix:` part. */
export function labelPrefix(label: string): string | null {
  const match = /^\s*([^:]*[^:\s])\s*::?\s*\S/.exec(label);
  return match ? match[1] : null;
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Groups labels by `masks` (first matching mask wins; groups keep the mask order) or, when no
 * masks are configured, automatically by the prefix before `:` / `::` (groups sorted by name).
 * Labels that fit nowhere go to the trailing "Other" group. Empty groups are omitted.
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
  const add = (key: string, title: string, label: string) => {
    let group = groups.get(key);
    if (!group) {
      group = { key, title, labels: [], isOther: false };
      groups.set(key, group);
    }
    group.labels.push(label);
  };

  const compiled = masks.map((mask) => ({ mask, regex: maskToRegExp(mask) }));
  for (const label of unique.values()) {
    if (compiled.length) {
      const hit = compiled.find((m) => m.regex.test(label));
      if (hit) {
        add(`mask:${hit.mask.toLowerCase()}`, hit.mask, label);
        continue;
      }
    } else {
      const prefix = labelPrefix(label);
      if (prefix) {
        add(`prefix:${prefix.toLowerCase()}`, `${prefix}:*`, label);
        continue;
      }
    }
    other.labels.push(label);
  }

  const ordered = [...groups.values()];
  if (compiled.length) {
    const order = new Map(compiled.map((m, i) => [`mask:${m.mask.toLowerCase()}`, i]));
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
