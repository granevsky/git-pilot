// Pure Issue <-> MR/PR label sync rules (no VS Code dependencies; safe to unit test).
//
// The source of truth is always the MR/PR side: the most recently updated open MR/PR that carries a
// status label (or, when none has one, the most recently updated open MR/PR). Nothing is written
// automatically — a SyncPlan only describes what a user-confirmed sync would change.

import { mrRef, mrTerm, oneLine } from '../../core/format';
import { computeUpdatedLabels, labelDiff, sameStatus } from '../../core/providers/baseProvider';
import type { EntityKind, EntityRef, Platform, SyncState } from '../../core/types';

/** Stable key of an Issue/MR inside a SyncState (`issue`, `mr:<projectRef>!<id>`). */
export function entityKey(kind: EntityKind, entity: EntityRef): string {
  return kind === 'issue' ? 'issue' : `mr:${entity.projectRef ?? ''}!${entity.id}`;
}

export function findEntity(state: SyncState, key: string): { kind: EntityKind; entity: EntityRef } | null {
  if (key === 'issue') {
    return { kind: 'issue', entity: state.issue };
  }
  const mr = state.mergeRequests.find((m) => entityKey('mr', m) === key);
  return mr ? { kind: 'mr', entity: mr } : null;
}

/** All Issue/MR keys of a state, Issue first. */
export function entityKeys(state: SyncState): string[] {
  return ['issue', ...state.mergeRequests.map((m) => entityKey('mr', m))];
}

/** `Issue #5`, `MR !3`, `PR #3`. */
export function entityName(platform: Platform, kind: EntityKind, entity: EntityRef): string {
  return kind === 'issue' ? `Issue #${entity.id}` : `${mrTerm(platform)} ${mrRef(platform, entity.id)}`;
}

/** The MR/PR whose labels are the source of truth, or `null` when the issue has no open MR/PR. */
export function sourceMergeRequest(state: SyncState): EntityRef | null {
  return state.mergeRequests.find((m) => m.statusLabel) ?? state.mergeRequests[0] ?? null;
}

export interface Conflict {
  issueStatus: string;
  mrStatus: string;
  mr: EntityRef;
}

/** Issue-vs-MR status conflict: both sides carry a status and they differ. */
export function findConflict(state: SyncState): Conflict | null {
  const issueStatus = state.issue.statusLabel;
  const mr = state.mergeRequests.find((m) => m.statusLabel);
  const mrStatus = mr?.statusLabel ?? null;
  if (!mr || !issueStatus || !mrStatus || sameStatus(issueStatus, mrStatus)) {
    return null;
  }
  return { issueStatus, mrStatus, mr };
}

/** One minimal label diff on one Issue/MR. */
export interface EntityChange {
  key: string;
  kind: EntityKind;
  entity: EntityRef;
  add: string[];
  remove: string[];
}

export interface SyncPlan {
  source: EntityRef | null;
  /** "Sync statuses": the source's status label on the Issue and every open MR/PR. */
  status: EntityChange[];
  /** "Sync all labels": the Issue and the other MRs/PRs get exactly the source's labels. */
  labels: EntityChange[];
}

export function buildSyncPlan(state: SyncState, prefix: string): SyncPlan {
  const source = sourceMergeRequest(state);
  const plan: SyncPlan = { source, status: [], labels: [] };
  if (!source) {
    return plan;
  }
  const entities: Array<{ kind: EntityKind; entity: EntityRef }> = [
    { kind: 'issue', entity: state.issue },
    ...state.mergeRequests.map((entity) => ({ kind: 'mr' as const, entity })),
  ];
  for (const { kind, entity } of entities) {
    const key = entityKey(kind, entity);
    if (source.statusLabel) {
      const { add, remove } = labelDiff(entity.allLabels, computeUpdatedLabels(entity.allLabels, source.statusLabel, prefix));
      if (add.length || remove.length) {
        plan.status.push({ key, kind, entity, add, remove });
      }
    }
    if (entity !== source) {
      const { add, remove } = labelDiff(entity.allLabels, source.allLabels);
      if (add.length || remove.length) {
        plan.labels.push({ key, kind, entity, add, remove });
      }
    }
  }
  return plan;
}

/** `true` when a confirmed sync would change something. */
export function hasChanges(plan: SyncPlan): boolean {
  return plan.status.length > 0 || plan.labels.length > 0;
}

/** Plain-text lines such as `Issue #5: +status: review, −status: todo`. */
export function describeChanges(platform: Platform, changes: readonly EntityChange[]): string[] {
  const label = (l: string) => oneLine(l, 60);
  return changes.map(
    (c) => `${entityName(platform, c.kind, c.entity)}: ${[...c.add.map((l) => `+${label(l)}`), ...c.remove.map((l) => `−${label(l)}`)].join(', ')}`,
  );
}
