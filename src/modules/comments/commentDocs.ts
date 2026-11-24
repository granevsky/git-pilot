import * as vscode from 'vscode';
import { oneLine } from '../../core/format';
import type { EntityComment } from '../../core/types';

export const COMMENT_SCHEME = 'gitpilot-comment';

/** How many opened comments stay available to VS Code (re-reads of open tabs, "Revert File"). */
const MAX_DOCS = 100;

/**
 * Read-only virtual documents with the full text of a comment. The body is shown as plain text in an
 * editor tab — never rendered as HTML or trusted Markdown — so server content cannot execute anything.
 */
export class CommentDocs implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly docs = new Map<string, string>();
  private seq = 0;
  private readonly registration = vscode.workspace.registerTextDocumentContentProvider(COMMENT_SCHEME, this);

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.docs.get(uri.query) ?? 'This comment is no longer available. Reload the Comments section and open it again.';
  }

  /** Stores the rendered text and returns the URI to open. `comment.id` is a validated digit string. */
  register(comment: EntityComment, targetName: string): vscode.Uri {
    const key = String(++this.seq);
    this.docs.set(key, renderComment(comment, targetName));
    while (this.docs.size > MAX_DOCS) {
      const oldest = this.docs.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.docs.delete(oldest);
    }
    return vscode.Uri.from({ scheme: COMMENT_SCHEME, path: `/Comment-${comment.id}.md`, query: key });
  }

  dispose(): void {
    this.registration.dispose();
    this.docs.clear();
  }
}

function renderComment(comment: EntityComment, targetName: string): string {
  const date = (iso: string) => (Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString() : iso);
  const lines = [
    `Comment by @${oneLine(comment.author, 80)} on ${targetName}${comment.isPrivate ? ' (internal note)' : ''}`,
    `Posted ${date(comment.createdAt)}${comment.updatedAt && comment.updatedAt !== comment.createdAt ? `, edited ${date(comment.updatedAt)}` : ''}`,
  ];
  if (comment.webUrl) {
    lines.push(`Link: ${comment.webUrl}`);
  }
  if (comment.hasMedia) {
    lines.push('This comment contains images, videos or attachments - open it in the browser to view them.');
  }
  return `${lines.join('\n')}\n\n${'-'.repeat(60)}\n\n${comment.body}\n`;
}
