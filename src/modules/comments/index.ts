import * as vscode from 'vscode';
import { oneLine } from '../../core/format';
import { errorMessage } from '../../core/logger';
import { MAX_COMMENT_LENGTH, isProviderError } from '../../core/providers/baseProvider';
import type { EntityComment, PilotContext, PilotModule, RepoSummary, SyncState } from '../../core/types';
import { TreeNode } from '../../core/ui/sectionView';
import { CommentDocs } from './commentDocs';
import { COMMANDS, type CommentTarget, CommentsTree, type CommentsView, type ThreadView, buildTargets, targetNodeId } from './commentsTree';

/** Settings that change which project is resolved, so loaded comments (and errors) are stale. */
const RESET_SETTINGS = ['gitPilot.provider', 'gitPilot.instanceUrl', 'gitPilot.allowInsecureHttp'];
/** Context key: the active editor is a comment draft (drives the Send button and keybinding). */
const COMPOSER_CONTEXT = 'gitPilot.comments.composer';

/** Comments of one Issue / MR/PR as loaded so far. */
interface Thread {
  comments: EntityComment[];
  seen: Set<string>;
  /** Cursor of the next (older) page; `null` = nothing more to load. */
  cursor: string | null;
  loaded: boolean;
  loading: boolean;
  /** A reload was requested while loading. */
  rerun: boolean;
  error: { message: string; auth: boolean } | null;
}

/** A draft being written for one Issue / MR/PR. Re-validated against the live state before posting. */
interface Composer {
  key: string;
  name: string;
  host: string;
  projectPath: string;
}

function newThread(): Thread {
  return { comments: [], seen: new Set(), cursor: null, loaded: false, loading: false, rerun: false, error: null };
}

/**
 * Feature Module #2 — the "Comments" sidebar section.
 *
 * Under the Issue of the current branch and each of its open MRs/PRs: "Add comment…" first, then the
 * user comments newest-first (automatic system notes are excluded), loaded lazily — when a node is
 * expanded — and page by page ("Show more…"). Images and videos are not rendered; comments that embed
 * them are flagged, and every comment has an "Open in Browser" link to its permalink.
 *
 * The Issue / MRs come from the `syncStateChanged` event of the Label Sync module. A comment is only
 * ever posted when the user presses Send in a draft they opened themselves.
 */
export class CommentsModule implements PilotModule {
  readonly id = 'comments';

  private ctx: PilotContext | undefined;
  private tree: CommentsTree | undefined;
  private docs: CommentDocs | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  private state: SyncState | null = null;
  /** The repository `state` belongs to. After a repository switch the old state stays until Label Sync delivers the new one. */
  private stateRepo: RepoSummary | null = null;
  /** `false` until the first `syncStateChanged`: the section says "Loading…" instead of "no issue". */
  private stateReceived = false;
  /** Identity of the current Issue (platform / host / project / issue): a change drops all loaded comments. */
  private scope = '';
  /** What the tree currently shows besides comments (targets and their titles): re-render only on change. */
  private shown = '\u0002'; // sentinel: the first state always renders
  /** Bumped whenever loaded data becomes stale; in-flight loads of an older epoch are discarded. */
  private epoch = 0;
  private readonly threads = new Map<string, Thread>();
  /** Targets whose node is expanded — only their comments are loaded and refreshed. */
  private readonly wanted = new Set<string>();

  private readonly composers = new Map<string, Composer>();
  private readonly sending = new Set<string>();

  activate(ctx: PilotContext): void {
    this.ctx = ctx;
    const tree = (this.tree = new CommentsTree(() => ctx.gitService.getRepoSummary()));
    const docs = (this.docs = new CommentDocs());

    this.disposables.push(
      tree,
      docs,
      tree.view.onDidExpandElement((e) => this.onToggled(e.element, true)),
      tree.view.onDidCollapseElement((e) => this.onToggled(e.element, false)),
      ctx.eventBus.onDidChangeSyncState((state) => {
        this.stateReceived = true;
        this.onState(state);
      }),
      ctx.eventBus.onDidChangeAuth(() => this.invalidate()),
      // The header / hints name the active repository, which can change without the Issue state changing
      // (e.g. between two repositories that both have no issue branch).
      ctx.eventBus.onDidChangeRepo(() => this.render()),
      ctx.eventBus.onDidChangeBranch(() => this.render()),
      ctx.eventBus.onDidChangeRepoPin(() => {
        // Same repository, only the pin changed: refresh the "(pinned)" mark. A different repository
        // keeps the old state (and header) until its own state arrives.
        const live = ctx.gitService.getRepoSummary();
        if (live && this.stateRepo?.key === live.key) {
          this.stateRepo = live;
        }
        this.render();
      }),
      ctx.eventBus.onDidChangeConfig((e) => {
        if (RESET_SETTINGS.some((s) => e.affectsConfiguration(s))) {
          this.invalidate();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateComposerContext()),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (this.composers.delete(doc.uri.toString())) {
          this.updateComposerContext();
        }
      }),
      // Registered unconditionally: every command declared in package.json must exist.
      vscode.commands.registerCommand(COMMANDS.refresh, () => this.refresh()),
      vscode.commands.registerCommand(COMMANDS.add, (node: unknown) => this.add(node)),
      vscode.commands.registerCommand(COMMANDS.send, () => this.send()),
      vscode.commands.registerCommand(COMMANDS.open, (node: unknown) => this.openComment(node)),
      vscode.commands.registerCommand(COMMANDS.loadMore, (node: unknown) => this.loadMore(node)),
    );

    const current = ctx.eventBus.currentSyncState;
    this.stateReceived = current !== null;
    this.onState(current);
    this.updateComposerContext();
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  private onState(state: SyncState | null): void {
    this.state = state;
    this.stateRepo = this.ctx?.gitService.getRepoSummary() ?? null;
    const targets = state ? buildTargets(state) : [];
    const scope = state ? [state.platform, state.host, state.projectPath, targets[0].key].join('|') : '';
    const shown = `${this.stateReceived}|` + targets.map((t) => `${t.key}\u0000${t.name}\u0000${t.entity.title}\u0000${t.entity.webUrl}`).join('\u0001');

    const scopeChanged = scope !== this.scope;
    if (scopeChanged) {
      // Another Issue / project: nothing loaded so far applies. The Issue node starts expanded.
      this.scope = scope;
      this.epoch++;
      this.threads.clear();
      this.wanted.clear();
      if (targets.length) {
        this.wanted.add(targets[0].key);
      }
    } else {
      // Same Issue, MRs may have come and gone.
      const keys = new Set(targets.map((t) => t.key));
      for (const key of [...this.threads.keys()]) {
        if (!keys.has(key)) {
          this.threads.delete(key);
        }
      }
      for (const key of [...this.wanted]) {
        if (!keys.has(key)) {
          this.wanted.delete(key);
        }
      }
    }

    if (scopeChanged || shown !== this.shown) {
      this.shown = shown;
      this.render();
    }
    this.loadWanted();
  }

  /** Drops everything loaded (token / provider settings changed) and reloads the expanded nodes. */
  private invalidate(): void {
    this.epoch++;
    this.threads.clear();
    this.render();
    this.loadWanted();
  }

  private render(): void {
    const ctx = this.ctx;
    const tree = this.tree;
    if (!ctx || !tree) {
      return;
    }
    const state = this.state;
    let view: CommentsView;
    if (!state) {
      view = {
        kind: 'message',
        text: this.stateReceived ? 'No issue is linked to the current branch. See the Labels section for details.' : 'Loading…',
      };
    } else {
      const threads = new Map<string, ThreadView>();
      for (const [key, t] of this.threads) {
        threads.set(key, { comments: t.comments, hasMore: t.cursor !== null, loading: t.loading, loaded: t.loaded, error: t.error });
      }
      view = { kind: 'ready', state, repo: this.stateRepo, threads, pageSize: ctx.settings.comments.pageSize };
    }
    tree.render(view);
  }

  private target(key: string | undefined): CommentTarget | undefined {
    return key && this.state ? buildTargets(this.state).find((t) => t.key === key) : undefined;
  }

  // -------------------------------------------------------------------------
  // Loading (lazy, page by page, newest first)
  // -------------------------------------------------------------------------

  private onToggled(node: TreeNode, expanded: boolean): void {
    const key = node.entity;
    // Only the Issue / MR nodes themselves (not their comment rows) carry an expansion state we track.
    if (!key || node.item.id !== targetNodeId(key) || !this.target(key)) {
      return;
    }
    if (expanded) {
      this.wanted.add(key);
      if (!this.threads.has(key)) {
        void this.load(key, 'next');
      }
    } else {
      this.wanted.delete(key);
    }
  }

  private loadWanted(): void {
    for (const key of this.wanted) {
      if (!this.threads.has(key)) {
        void this.load(key, 'next');
      }
    }
  }

  /** Reloads the expanded nodes; collapsed ones are dropped and load again when expanded. */
  private refresh(): void {
    if (!this.state) {
      void vscode.window.showInformationMessage('Git Pilot: no issue is linked to the current branch.');
      return;
    }
    for (const key of [...this.threads.keys()]) {
      if (this.wanted.has(key)) {
        void this.load(key, 'reload');
      } else {
        this.threads.delete(key);
      }
    }
    this.loadWanted();
    this.render();
  }

  private loadMore(node: unknown): void {
    const key = node instanceof TreeNode ? node.entity : undefined;
    if (this.target(key) && key) {
      void this.load(key, 'next');
    }
  }

  /**
   * `next` appends the following (older) page; `reload` replaces the thread with a fresh first page
   * (the old comments stay visible until it arrives). One request per thread at a time.
   */
  private async load(key: string, mode: 'next' | 'reload'): Promise<void> {
    const ctx = this.ctx;
    const tree = this.tree;
    const state = this.state;
    const target = this.target(key);
    if (!ctx || !tree || !state || !target) {
      return;
    }
    let thread = this.threads.get(key);
    if (!thread) {
      thread = newThread();
      this.threads.set(key, thread);
    }
    if (thread.loading) {
      thread.rerun ||= mode === 'reload';
      return;
    }
    if (mode === 'next' && thread.loaded && thread.cursor === null) {
      return; // everything is loaded
    }

    const cursor = mode === 'reload' ? null : thread.cursor;
    const epoch = this.epoch;
    thread.loading = true;
    thread.error = null;
    this.render();
    try {
      const res = await ctx.providerManager.resolve();
      if (res.status !== 'ready' || res.provider.host !== state.host || res.provider.projectPath !== state.projectPath) {
        throw new Error('The repository is not available yet (check the remote and the API token).');
      }
      const provider = res.provider;
      if (!provider.getComments) {
        throw new Error('This platform cannot list comments.');
      }
      const getComments = provider.getComments.bind(provider);
      const page = await tree.withProgress(() => getComments(target.entity, target.kind, ctx.settings.comments.pageSize, cursor));
      if (epoch !== this.epoch) {
        return; // the Issue / project / token changed meanwhile: this result is stale
      }
      if (mode === 'reload') {
        thread.comments = [];
        thread.seen.clear();
      }
      for (const comment of page.comments) {
        if (!thread.seen.has(comment.id)) {
          thread.seen.add(comment.id);
          thread.comments.push(comment);
        }
      }
      thread.cursor = page.nextCursor;
      thread.loaded = true;
    } catch (err) {
      if (epoch === this.epoch) {
        thread.error = { message: errorMessage(err), auth: isProviderError(err, 'auth') };
        ctx.logger.warn(`Loading comments of ${target.name} failed: ${thread.error.message}`);
      }
    } finally {
      if (epoch === this.epoch) {
        thread.loading = false;
        const again = thread.rerun;
        thread.rerun = false;
        this.render();
        if (again) {
          void this.load(key, 'reload');
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Reading a comment
  // -------------------------------------------------------------------------

  /** Opens the whole comment as read-only plain text in an editor tab. */
  private async openComment(node: unknown): Promise<void> {
    if (!(node instanceof TreeNode) || !node.entity || !node.value || !this.docs) {
      return;
    }
    const target = this.target(node.entity);
    const comment = this.threads.get(node.entity)?.comments.find((c) => c.id === node.value);
    if (!target || !comment) {
      return;
    }
    const doc = await vscode.workspace.openTextDocument(this.docs.register(comment, target.name));
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  // -------------------------------------------------------------------------
  // Writing a comment: a one-line input box, or a draft (untitled Markdown file) + Send
  // -------------------------------------------------------------------------

  /** `Add comment…` on an Issue / MR node → input for that entity; from the palette → asks which. */
  private async add(arg: unknown): Promise<void> {
    const state = this.state;
    if (!state) {
      void vscode.window.showInformationMessage('Git Pilot: no issue is linked to the current branch.');
      return;
    }
    const targets = buildTargets(state);
    let target = arg instanceof TreeNode ? targets.find((t) => t.key === arg.entity) : undefined;
    if (!target && targets.length === 1) {
      target = targets[0];
    }
    if (!target) {
      const pick = await vscode.window.showQuickPick(
        targets.map((t) => ({
          label: `${t.kind === 'issue' ? '$(issues)' : '$(git-pull-request)'} ${t.name}`,
          description: oneLine(t.entity.title, 80),
          target: t,
        })),
        { title: 'Git Pilot: Comment on…', matchOnDescription: true },
      );
      target = pick?.target;
    }
    if (!target) {
      return;
    }
    if (this.ctx?.settings.comments.compose === 'editor') {
      await this.openDraft(state, target);
    } else {
      this.quickComment(state, target);
    }
  }

  /**
   * One-line input box: Enter posts, the button moves the text to a Markdown draft for longer comments.
   * The box stays open when it loses focus, so half-typed text is not lost.
   */
  private quickComment(state: SyncState, target: CommentTarget): void {
    const composer: Composer = { key: target.key, name: target.name, host: state.host, projectPath: state.projectPath };
    const input = vscode.window.createInputBox();
    input.title = `Git Pilot: comment on ${target.name}`;
    input.prompt = oneLine(target.entity.title, 100);
    input.placeholder = 'Write a comment and press Enter to post it';
    input.ignoreFocusOut = true;
    input.buttons = [{ iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Write it in an editor instead (multi-line Markdown)' }];
    const tooLong = (text: string) => (text.length > MAX_COMMENT_LENGTH ? `Too long: ${text.length} of ${MAX_COMMENT_LENGTH} characters` : undefined);

    input.onDidChangeValue((value) => {
      input.validationMessage = tooLong(value.trim());
    });
    input.onDidAccept(() => {
      const text = input.value.trim();
      if (!text) {
        return;
      }
      const problem = tooLong(text);
      if (problem) {
        input.validationMessage = problem;
        return;
      }
      input.hide();
      void this.post(composer, text, 'quick');
    });
    input.onDidTriggerButton(() => {
      const text = input.value;
      input.hide();
      void this.openDraft(state, target, text);
    });
    input.onDidHide(() => input.dispose());
    input.show();
  }

  /** Opens (or focuses) the Markdown draft for `target`; `initialText` pre-fills an empty draft. */
  private async openDraft(state: SyncState, target: CommentTarget, initialText = ''): Promise<void> {
    if (!Number.isSafeInteger(target.entity.id)) {
      return;
    }
    const uri = vscode.Uri.from({ scheme: 'untitled', path: `Comment-${target.kind === 'issue' ? 'Issue' : 'MR'}-${target.entity.id}.md` });
    const key = uri.toString();
    const reopened = vscode.workspace.textDocuments.some((d) => d.uri.toString() === key);
    const doc = await vscode.workspace.openTextDocument(uri);
    if (doc.languageId !== 'markdown') {
      await vscode.languages.setTextDocumentLanguage(doc, 'markdown');
    }
    this.composers.set(key, { key: target.key, name: target.name, host: state.host, projectPath: state.projectPath });
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    if (initialText && !doc.getText().trim()) {
      await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), initialText));
      const end = doc.positionAt(doc.getText().length);
      editor.selection = new vscode.Selection(end, end);
    }
    this.updateComposerContext();
    if (!reopened) {
      vscode.window.setStatusBarMessage(`$(comment) Comment on ${target.name}: write it in Markdown, then press Ctrl+Enter or the Send button.`, 8000);
    }
  }

  /** Posts the active draft. On failure the text is kept in the draft. */
  private async send(): Promise<void> {
    const doc = vscode.window.activeTextEditor?.document;
    const key = doc?.uri.toString();
    const composer = key ? this.composers.get(key) : undefined;
    if (!doc || !key || !composer) {
      void vscode.window.showInformationMessage('Git Pilot: open a draft with "Add comment…" first.');
      return;
    }
    if (this.sending.has(key)) {
      return;
    }
    const text = doc.getText().trim();
    this.sending.add(key);
    let posted: boolean;
    try {
      posted = await this.post(composer, text, 'draft');
    } finally {
      this.sending.delete(key);
    }
    if (posted && doc.getText().trim() === text) {
      // Unchanged since sending: discard the draft without a "save changes?" prompt.
      this.composers.delete(key);
      if (vscode.window.activeTextEditor?.document === doc) {
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      }
      this.updateComposerContext();
    }
  }

  /**
   * Posts `text` to the entity named by `composer`, after re-validating host / project / entity against
   * the live state. `origin` only changes how a failure is reported: a draft keeps the text itself, a
   * quick comment offers to continue in a draft so nothing typed is lost. Returns `true` when posted.
   */
  private async post(composer: Composer, text: string, origin: 'draft' | 'quick'): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) {
      return false;
    }
    if (!text) {
      void vscode.window.showWarningMessage('Git Pilot: the comment is empty.');
      return false;
    }
    if (text.length > MAX_COMMENT_LENGTH) {
      void vscode.window.showWarningMessage(`Git Pilot: the comment is too long (${text.length} of ${MAX_COMMENT_LENGTH} characters).`);
      return false;
    }
    const state = this.state;
    const target = state && state.host === composer.host && state.projectPath === composer.projectPath ? this.target(composer.key) : undefined;
    if (!state || !target) {
      void vscode.window.showWarningMessage(
        `Git Pilot: ${composer.name} is no longer part of the current branch, so the comment was not posted.` +
          (origin === 'draft' ? ' The draft is kept.' : ' Your text is on the clipboard.'),
      );
      if (origin === 'quick') {
        await vscode.env.clipboard.writeText(text);
      }
      return false;
    }

    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Git Pilot: posting comment on ${target.name}…` }, async () => {
        const res = await ctx.providerManager.resolve();
        if (res.status !== 'ready' || res.provider.host !== composer.host || res.provider.projectPath !== composer.projectPath) {
          throw new Error('The repository changed while the comment was being prepared.');
        }
        if (!res.provider.addComment) {
          throw new Error('This platform cannot post comments.');
        }
        await res.provider.addComment(target.entity, target.kind, text);
      });
    } catch (err) {
      const message = errorMessage(err);
      ctx.logger.error(`Posting a comment on ${target.name} failed: ${message}`);
      // 403 usually means the token lacks write access (GitLab `api` scope / GitHub issues & pull requests: write).
      const actions = [
        ...(isProviderError(err, 'auth') || isProviderError(err, 'forbidden') ? ['Update Token'] : []),
        ...(origin === 'quick' ? ['Continue in Draft'] : []),
      ];
      const suffix = origin === 'draft' ? ' (your text is kept in the draft)' : '';
      void vscode.window.showErrorMessage(`Git Pilot: ${message}${suffix}`, ...actions).then((a) => {
        if (a === 'Update Token') {
          void vscode.commands.executeCommand(COMMANDS.setToken);
        } else if (a === 'Continue in Draft') {
          void this.openDraft(state, target, text);
        }
      });
      return false;
    }

    vscode.window.setStatusBarMessage(`$(check) Git Pilot: comment posted on ${target.name}`, 5000);
    // Show the new comment (it is the newest, so it appears right under "Add comment…").
    this.wanted.add(target.key);
    void this.load(target.key, 'reload');
    return true;
  }

  private updateComposerContext(): void {
    const active = vscode.window.activeTextEditor?.document.uri.toString();
    void vscode.commands.executeCommand('setContext', COMPOSER_CONTEXT, !!active && this.composers.has(active));
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables.splice(0)).dispose();
    this.threads.clear();
    this.composers.clear();
    this.epoch++;
    this.ctx = undefined;
    this.tree = undefined;
    this.docs = undefined;
  }
}
