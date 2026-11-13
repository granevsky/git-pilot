import * as vscode from 'vscode';
import type { EventBus } from '../eventBus';
import type { Logger } from '../logger';
import type { RemoteInfo, RepoContext } from '../types';
import type { GitAPI, GitExtension, Remote, Repository } from './gitApi';

// ---------------------------------------------------------------------------
// Pure helpers (no VS Code dependencies; safe to unit test)
// ---------------------------------------------------------------------------

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
    hostname = parsed.hostname.toLowerCase();
    path = decodeURIComponent(parsed.pathname);
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    // For HTTP(S) remotes the port is part of the web URL; SSH ports are not. The API is always
    // assumed to be HTTPS: a plain-http remote (possibly planted in a cloned repo) must not
    // downgrade where the token is sent. Plain HTTP requires an explicit instanceUrl + opt-in.
    webBaseUrl = isHttp ? `https://${parsed.host.toLowerCase()}` : `https://${hostname}`;
  } else {
    // scp-like syntax: [user@]host:path
    const match = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(url);
    if (!match) {
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
  if (segments.length < 2) {
    return null;
  }

  return {
    name: remoteName,
    url,
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

/**
 * Bridges the built-in `vscode.git` extension. Tracks the "active" repository
 * (the one containing the focused editor, else the first one) and emits
 * `repoChanged` / `branchChanged` on the EventBus.
 */
export class GitService implements vscode.Disposable {
  private api: GitAPI | undefined;
  private activeRepo: Repository | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly repoListeners = new Map<string, vscode.Disposable>();
  private snapshot: Snapshot = { root: null, branch: null, remoteUrl: null };

  constructor(
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {}

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
    const editorUri = vscode.window.activeTextEditor?.document.uri;
    const fromEditor = editorUri && editorUri.scheme === 'file' ? api.getRepository(editorUri) : null;
    if (fromEditor) {
      this.activeRepo = fromEditor;
    } else if (!this.activeRepo || !api.repositories.includes(this.activeRepo)) {
      this.activeRepo = api.repositories[0];
    }
    this.evaluate();
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
