import * as vscode from 'vscode';
import { commentSnippet, mrRef, mrTerm, oneLine, relativeTime, repoHint, withRepoContext } from '../../core/format';
import type { EntityComment, EntityKind, EntityRef, RepoSummary, SyncState } from '../../core/types';
import { SectionView, TreeNode } from '../../core/ui/sectionView';

export const COMMENTS_VIEW_ID = 'gitPilot.comments';

export const COMMANDS = {
  setToken: 'gitPilot.setToken',
  selectRepository: 'gitPilot.selectRepository',
  refresh: 'gitPilot.comments.refresh',
  add: 'gitPilot.comments.add',
  send: 'gitPilot.comments.send',
  open: 'gitPilot.comments.open',
  loadMore: 'gitPilot.comments.loadMore',
} as const;

const ERROR_COLOR = new vscode.ThemeColor('problemsErrorIcon.foreground');
const PRIVATE_COLOR = new vscode.ThemeColor('problemsWarningIcon.foreground');

/** An Issue or MR/PR whose comments the section can show and post to. */
export interface CommentTarget {
  /** `issue:<id>` / `mr:<id>` — stable for as long as the entity exists. */
  key: string;
  kind: EntityKind;
  entity: EntityRef;
  /** `Issue #3`, `MR !5`, `PR #5`. */
  name: string;
}

export function buildTargets(state: SyncState): CommentTarget[] {
  return [
    { key: `issue:${state.issue.id}`, kind: 'issue', entity: state.issue, name: `Issue #${state.issue.id}` },
    ...state.mergeRequests.map((mr) => ({
      key: `mr:${mr.id}`,
      kind: 'mr' as const,
      entity: mr,
      name: `${mrTerm(state.platform)} ${mrRef(state.platform, mr.id)}`,
    })),
  ];
}

export function targetNodeId(key: string): string {
  return `target/${key}`;
}

/** Everything the tree needs to know about one thread's loading state. */
export interface ThreadView {
  comments: readonly EntityComment[];
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
  error: { message: string; auth: boolean } | null;
}

export type CommentsView =
  | { kind: 'message'; text: string }
  | { kind: 'ready'; state: SyncState; repo: RepoSummary | null; threads: ReadonlyMap<string, ThreadView>; pageSize: number };

function info(label: string, icon: string | vscode.ThemeIcon, tooltip?: string, command?: string): TreeNode {
  return new TreeNode({ label, icon, tooltip: tooltip ?? label, command });
}

/**
 * Sidebar section "Comments": one node per Issue / MR/PR, each starting with "Add comment…" followed by
 * its user comments, newest first (system notes are filtered out by the providers) and "Show more…".
 * Media in a comment is only flagged — it is viewed in the browser through the comment's permalink.
 */
export class CommentsTree implements vscode.Disposable {
  private readonly section = new SectionView(COMMENTS_VIEW_ID, { showCollapseAll: true });

  constructor(
    /** The active repository, shown in the section header and empty-state messages. */
    private readonly getRepo: () => RepoSummary | null,
  ) {}

  get view(): vscode.TreeView<TreeNode> {
    return this.section.view;
  }

  withProgress<T>(task: () => Promise<T>): Promise<T> {
    return this.section.withProgress(task);
  }

  render(view: CommentsView): void {
    const s = this.section;
    const repo = this.getRepo();
    if (view.kind === 'message') {
      s.description = withRepoContext(undefined, repo);
      // With several repositories open, an empty section may just be looking at the wrong one.
      const switchRepo =
        repo && repo.repoCount > 1 ? [info('Select repository…', 'repo', 'Pin a repository, or follow the active editor', COMMANDS.selectRepository)] : [];
      s.render(switchRepo, `${view.text}${repoHint(repo)}`);
      return;
    }
    // The header names the repository this state was loaded for, not the one that just became active.
    s.description = withRepoContext(`#${view.state.issue.id}`, view.repo);
    s.render(buildTargets(view.state).map((target) => this.targetNode(target, view)));
  }

  private targetNode(target: CommentTarget, view: Extract<CommentsView, { kind: 'ready' }>): TreeNode {
    const thread = view.threads.get(target.key);
    const id = targetNodeId(target.key);
    const children: TreeNode[] = [
      new TreeNode({
        id: `${id}/add`,
        label: 'Add comment…',
        icon: 'comment',
        tooltip: `Write a new comment on ${target.name}`,
        command: COMMANDS.add,
        entity: target.key,
      }),
    ];

    for (const comment of thread?.comments ?? []) {
      children.push(this.commentNode(id, target, comment));
    }
    if (!thread || (!thread.loaded && !thread.error)) {
      children.push(info('Loading…', 'loading~spin'));
    } else if (thread.loading) {
      children.push(info('Loading…', 'loading~spin'));
    } else if (thread.error) {
      children.push(this.errorNode(id, target, thread.error));
    } else if (thread.hasMore) {
      children.push(
        new TreeNode({
          id: `${id}/more`,
          label: 'Show more…',
          description: `${view.pageSize} older`,
          icon: 'chevron-down',
          tooltip: 'Load older comments',
          command: COMMANDS.loadMore,
          entity: target.key,
        }),
      );
    } else if (!thread.comments.length) {
      children.push(info('No comments yet', 'circle-slash'));
    }

    return new TreeNode({
      id,
      label: target.name,
      description: oneLine(target.entity.title, 120),
      tooltip: `${target.name}: ${oneLine(target.entity.title)}`,
      icon: target.kind === 'issue' ? 'issues' : 'git-pull-request',
      // Flags must not be substrings of each other: menus match them with plain `=~ /flag/`.
      contextValue: 'openable commentTarget',
      url: target.entity.webUrl,
      entity: target.key,
      children,
      expanded: target.kind === 'issue',
    });
  }

  private errorNode(id: string, target: CommentTarget, error: { message: string; auth: boolean }): TreeNode {
    if (error.auth) {
      return info('Token rejected — update the API token…', new vscode.ThemeIcon('key', ERROR_COLOR), error.message, COMMANDS.setToken);
    }
    return new TreeNode({
      id: `${id}/error`,
      label: oneLine(error.message, 120),
      icon: new vscode.ThemeIcon('warning', ERROR_COLOR),
      tooltip: `${error.message}\n\nClick to retry.`,
      command: COMMANDS.loadMore,
      entity: target.key,
    });
  }

  private commentNode(targetId: string, target: CommentTarget, comment: EntityComment): TreeNode {
    const edited = comment.updatedAt && comment.updatedAt !== comment.createdAt && Date.parse(comment.updatedAt) - Date.parse(comment.createdAt) > 60_000;
    const when = relativeTime(comment.createdAt);
    const snippet = commentSnippet(comment.body) || '(empty)';
    const created = Number.isFinite(Date.parse(comment.createdAt)) ? new Date(comment.createdAt).toLocaleString() : '';
    return new TreeNode({
      id: `${targetId}/c:${comment.id}`,
      label: `@${oneLine(comment.author, 40)}`,
      description: [when, edited ? 'edited' : '', snippet].filter(Boolean).join(' · '),
      tooltip: [
        `@${oneLine(comment.author, 80)}${created ? ` · ${created}` : ''}${comment.isPrivate ? ' · internal note' : ''}`,
        oneLine(comment.body, 600),
        comment.hasMedia ? 'Contains images, videos or attachments — open the comment in the browser to view them.' : '',
        'Click to read the whole comment.',
      ]
        .filter(Boolean)
        .join('\n'),
      icon: comment.isPrivate
        ? new vscode.ThemeIcon('lock', PRIVATE_COLOR)
        : comment.hasMedia
          ? new vscode.ThemeIcon('file-media')
          : new vscode.ThemeIcon('comment'),
      // `openable` (inline "Open in Browser") only when there is a link; gitPilot.openItem would otherwise
      // fall back to the generic picker.
      contextValue: comment.webUrl ? 'openable commentItem' : 'commentItem',
      url: comment.webUrl ?? undefined,
      value: comment.id,
      entity: target.key,
      command: COMMANDS.open,
    });
  }

  dispose(): void {
    this.section.dispose();
  }
}
