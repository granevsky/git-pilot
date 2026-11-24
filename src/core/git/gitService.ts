import * as vscode from 'vscode';
import type { EventBus } from '../eventBus';
import { redactUrl } from '../format';
import type { Logger } from '../logger';
import type { RemoteInfo, RepoContext, RepoSummary, RepositoryInfo } from '../types';
import type { GitAPI, GitExtension, Remote, Repository } from './gitApi';

// ---------------------------------------------------------------------------
// Pure helpers (no VS Code dependencies; safe to unit test)
// ---------------------------------------------------------------------------

const NETWORK_SCHEMES = new Set(['https:', 'http:', 'ssh:', 'git:', 'git+ssh:', 'ssh+git:']);

/**
 * Parses SSH (`git@host:group/sub/repo.git`, `ssh://git@host:2222/group/repo.git`)
 * and HTTP(S) (`https://host/group/sub/repo.git`) remote URLs, preserving nested
 * GitLab subgroup paths.
 */
export function parseRemoteUrl(rawUrl: string, remoteName = 'origin'): RemoteInfo | null {
  const url = rawUrl.trim();
  if (!url) {
    return null;
  }

  let hostname: string;
  let path: string;
  let webBaseUrl: string;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    // Only network transports name a host; `file://` and other local remotes have none.
    if (!NETWORK_SCHEMES.has(parsed.protocol.toLowerCase()) || !parsed.hostname) {
      return null;
    }
    hostname = parsed.hostname.toLowerCase();
    try {
      path = decodeURIComponent(parsed.pathname);
    } catch {
      return null; // malformed %-escape (the remote URL comes from an untrusted repository)
    }
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    // For HTTP(S) remotes the port is part of the web URL; SSH ports are not. The API is always
    // assumed to be HTTPS: a plain-http remote (possibly planted in a cloned repo) must not
    // downgrade where the token is sent. Plain HTTP requires an explicit instanceUrl + opt-in.
    webBaseUrl = isHttp ? `https://${parsed.host.toLowerCase()}` : `https://${hostname}`;
  } else {
    // scp-like syntax: [user@]host:path
    const match = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(url);
    // A single letter before the colon is a Windows drive (`C:/repos/x.git`), i.e. a local path —
    // git itself never treats it as an scp-like host either.
    if (!match || /^[a-z]$/i.test(match[1])) {
      return null;
    }
    hostname = match[1].toLowerCase();
    path = match[2];
    webBaseUrl = `https://${hostname}`;
  }

  const projectPath = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const segments = projectPath.split('/').filter(Boolean);
  // Dot segments would be resolved by URL parsing once the path enters an API URL (e.g. owner ".."
  // escaping `/repos/`); control characters, `?` and `#` have no place in a project path either.
  if (segments.length < 2 || segments.some((s) => s === '.' || s === '..' || /[\u0000-\u001f\u007f\\?#]/.test(s))) {
    return null;
  }

  return {
    name: remoteName,
    url: redactUrl(url),
    hostname,
    projectPath: segments.join('/'),
    owner: segments.slice(0, -1).join('/'),
    repo: segments[segments.length - 1],
    webBaseUrl,
  };
}

/** Extracts the issue number from a branch name using the 1st capturing group of `regex`. */
export function extractIssueNumber(branch: string | null | undefined, regex: RegExp): number | null {
  // Git refs are short in practice; bounding input length also bounds regex backtracking cost.
  if (!branch || branch.length > 255) {
    return null;
  }
  const match = regex.exec(branch);
  // Prefer the 1st capturing group; fall back to the first digit run of the whole match.
  const raw = match?.[1] ?? /\d+/.exec(match?.[0] ?? '')?.[0];
  if (!raw) {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// GitService
// ---------------------------------------------------------------------------

interface Snapshot {
  root: string | null;
  branch: string | null;
  remoteUrl: string | null;
}

const PINNED_REPO_KEY = 'gitPilot.pinnedRepository';
const MAX_PINNED_KEY_LENGTH = 2048;

function repoName(repo: Repository): string {
  return repo.rootUri.path.split('/').filter(Boolean).pop() ?? repo.rootUri.fsPath;
}

/**
 * Bridges the built-in `vscode.git` extension. Tracks the "active" repository and emits
 * `repoChanged` / `branchChanged` on the EventBus.
 *
 * By default the active repository is the one containing the focused file editor (else the first
 * one). With several repositories open the user can pin one ("Select Repository…"): it then stays
 * active whatever file is focused. The pin is remembered per workspace; it is only ever compared with
 * the roots of repositories that are currently open.
 */
export class GitService implements vscode.Disposable {
  private api: GitAPI | undefined;
  private activeRepo: Repository | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly repoListeners = new Map<string, vscode.Disposable>();
  private snapshot: Snapshot = { root: null, branch: null, remoteUrl: null };
  /** Root URI string of the pinned repository, or `null` to follow the active editor. */
  private pinnedRoot: string | null;

  constructor(
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly store: vscode.Memento,
  ) {
    const saved = store.get<unknown>(PINNED_REPO_KEY);
    this.pinnedRoot = typeof saved === 'string' && saved.length > 0 && saved.length <= MAX_PINNED_KEY_LENGTH ? saved : null;
  }

  /** Resolves once the git API handle is obtained (does not wait for repository discovery). */
  async initialize(): Promise<void> {
    const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!ext) {
      this.logger.error('Built-in git extension (vscode.git) is not available.');
      return;
    }
    const gitExt = ext.isActive ? ext.exports : await ext.activate();
    if (!gitExt.enabled) {
      this.logger.warn('Git is disabled (git.enabled = false). Waiting for it to be enabled.');
      this.disposables.push(
        gitExt.onDidChangeEnablement((enabled) => {
          if (enabled && !this.api) {
            this.attach(gitExt.getAPI(1));
          }
        }),
      );
      return;
    }
    this.attach(gitExt.getAPI(1));
  }

  private attach(api: GitAPI): void {
    this.api = api;
    this.disposables.push(
      api.onDidOpenRepository((repo) => {
        this.watchRepository(repo);
        this.refreshActiveRepository();
      }),
      api.onDidCloseRepository((repo) => {
        const key = repo.rootUri.toString();
        this.repoListeners.get(key)?.dispose();
        this.repoListeners.delete(key);
        if (this.activeRepo === repo) {
          this.activeRepo = undefined;
        }
        this.refreshActiveRepository();
      }),
      api.onDidChangeState(() => this.refreshActiveRepository()),
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshActiveRepository()),
    );
    api.repositories.forEach((repo) => this.watchRepository(repo));
    this.refreshActiveRepository();
    this.logger.info(`Git API attached (state: ${api.state}, repositories: ${api.repositories.length}).`);
  }

  private watchRepository(repo: Repository): void {
    const key = repo.rootUri.toString();
    if (this.repoListeners.has(key)) {
      return;
    }
    this.repoListeners.set(
      key,
      repo.state.onDidChange(() => {
        if (repo === this.activeRepo) {
          this.evaluate();
        }
      }),
    );
  }

  private refreshActiveRepository(): void {
    const api = this.api;
    if (!api) {
      return;
    }
    // A pinned repository wins over the editor. While it is not open (not discovered yet, or closed)
    // the pin is kept but the normal rules apply, so it takes over again as soon as it appears.
    const pinned = this.pinnedRoot ? api.repositories.find((r) => r.rootUri.toString() === this.pinnedRoot) : undefined;
    if (pinned) {
      this.activeRepo = pinned;
      this.evaluate();
      return;
    }
    const editorUri = vscode.window.activeTextEditor?.document.uri;
    const fromEditor = editorUri && editorUri.scheme === 'file' ? api.getRepository(editorUri) : null;
    if (fromEditor) {
      this.activeRepo = fromEditor;
    } else if (!this.activeRepo || !api.repositories.includes(this.activeRepo)) {
      this.activeRepo = api.repositories[0];
    }
    this.evaluate();
  }

  /** All open repositories (for "Select Repository…"). */
  listRepositories(): RepositoryInfo[] {
    return (this.api?.repositories ?? []).map((repo) => ({
      key: repo.rootUri.toString(),
      name: repoName(repo),
      branch: repo.state.HEAD?.name ?? null,
      projectPath: this.resolveRemote(repo)?.projectPath ?? null,
      path: repo.rootUri.fsPath,
    }));
  }

  /** Root of the pinned repository (even if it is not open right now), or `null` when following the editor. */
  get pinnedKey(): string | null {
    return this.pinnedRoot;
  }

  /** Short description of the active repository for section headers; `null` without one. */
  getRepoSummary(): RepoSummary | null {
    const repo = this.activeRepo;
    if (!repo) {
      return null;
    }
    return {
      key: repo.rootUri.toString(),
      name: repoName(repo),
      branch: repo.state.HEAD?.name ?? null,
      pinned: repo.rootUri.toString() === this.pinnedRoot,
      repoCount: this.api?.repositories.length ?? 1,
    };
  }

  /**
   * Pins the open repository with this root URI, or (`null`) goes back to following the active editor.
   * Unknown keys are ignored.
   */
  async pinRepository(key: string | null): Promise<void> {
    const api = this.api;
    if (!api || (key !== null && !api.repositories.some((r) => r.rootUri.toString() === key))) {
      return;
    }
    this.pinnedRoot = key;
    await this.store.update(PINNED_REPO_KEY, key ?? undefined);
    this.logger.info(key ? `Repository pinned: ${key}` : 'Repository unpinned: following the active editor.');
    this.refreshActiveRepository();
    this.bus.emit('repoPinChanged', this.getRepoContext());
  }

  /** Compares the current state with the last snapshot and emits change events. */
  private evaluate(): void {
    const ctx = this.getRepoContext();
    const next: Snapshot = {
      root: ctx?.rootUri.toString() ?? null,
      branch: ctx?.branch ?? null,
      remoteUrl: ctx?.remote?.url ?? null,
    };
    const prev = this.snapshot;
    const repoChanged = prev.root !== next.root || prev.remoteUrl !== next.remoteUrl;
    const branchChanged = repoChanged || prev.branch !== next.branch;
    this.snapshot = next;

    if (repoChanged) {
      this.logger.info(`Active repository: ${next.root ?? '(none)'} [${ctx?.remote?.projectPath ?? 'no remote'}]`);
      this.bus.emit('repoChanged', ctx);
    }
    if (branchChanged) {
      this.logger.debug(`Branch changed: ${prev.branch ?? '(none)'} -> ${next.branch ?? '(none)'}`);
      this.bus.emit('branchChanged', { repo: ctx, previousBranch: prev.branch, branch: next.branch });
    }
  }

  get isReady(): boolean {
    return this.api?.state === 'initialized';
  }

  getRepoContext(): RepoContext | null {
    const repo = this.activeRepo;
    if (!repo) {
      return null;
    }
    return {
      rootUri: repo.rootUri,
      branch: repo.state.HEAD?.name ?? null,
      remote: this.resolveRemote(repo),
    };
  }

  /** Prefers `origin`, then the HEAD's upstream remote, then the first remote with a URL. */
  private resolveRemote(repo: Repository): RemoteInfo | null {
    const remotes = repo.state.remotes.filter((r) => !!(r.fetchUrl || r.pushUrl));
    const upstreamName = repo.state.HEAD?.upstream?.remote;
    const ordered = [
      remotes.find((r) => r.name === 'origin'),
      remotes.find((r) => r.name === upstreamName),
      ...remotes,
    ].filter((r): r is Remote => !!r);

    for (const remote of ordered) {
      const parsed = parseRemoteUrl(remote.fetchUrl ?? remote.pushUrl ?? '', remote.name);
      if (parsed) {
        return parsed;
      }
    }
    return null;
  }

  dispose(): void {
    this.repoListeners.forEach((d) => d.dispose());
    this.repoListeners.clear();
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
