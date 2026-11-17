import * as vscode from 'vscode';
import { SecretsManager } from '../config/secrets';
import type { SettingsManager } from '../config/settings';
import type { EventBus } from '../eventBus';
import { redactUrl } from '../format';
import type { GitService } from '../git/gitService';
import type { Logger } from '../logger';
import type { GitPlatformProvider, Platform, RepoContext } from '../types';
import { GitHubProvider } from './githubProvider';
import { GitLabProvider } from './gitlabProvider';

/** Where the current repository lives, independent of whether a token exists. */
export interface ProviderTarget {
  platform: Platform | null;
  /** Token key, `hostname[:port]`. */
  host: string;
  webBaseUrl: string;
  projectPath: string;
}

export type ProviderResolution =
  | { status: 'ready'; provider: GitPlatformProvider; repo: RepoContext; target: ProviderTarget & { platform: Platform } }
  | { status: 'noRepository' }
  | { status: 'noRemote'; repo: RepoContext }
  | { status: 'unknownPlatform'; repo: RepoContext; target: ProviderTarget }
  | { status: 'missingToken'; repo: RepoContext; target: ProviderTarget & { platform: Platform } };

/** Canonical cloud hosts whose platform cannot be overridden by workspace settings. */
export function fixedCloudPlatform(hostname: string): Platform | null {
  const host = hostname.toLowerCase();
  if (host === 'github.com' || host === 'www.github.com' || host === 'api.github.com') {
    return 'github';
  }
  if (host === 'gitlab.com') {
    return 'gitlab';
  }
  return null;
}

export function detectPlatform(hostname: string): Platform | null {
  const fixed = fixedCloudPlatform(hostname);
  if (fixed) {
    return fixed;
  }
  const host = hostname.toLowerCase();
  if (host.endsWith('.github.com') || /(^|[.-])github([.-]|$)/.test(host)) {
    return 'github';
  }
  if (/(^|[.-])gitlab([.-]|$)/.test(host)) {
    return 'gitlab';
  }
  return null;
}

/**
 * Resolves (and caches) the GitPlatformProvider for the active repository based on
 * the `origin` remote, `gitPilot.provider`, `gitPilot.instanceUrl` and stored tokens.
 */
export class ProviderManager implements vscode.Disposable {
  private cached: { key: string; provider: GitPlatformProvider } | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly settings: SettingsManager,
    private readonly secrets: SecretsManager,
    private readonly gitService: GitService,
    bus: EventBus,
    private readonly logger: Logger,
  ) {
    const invalidate = () => (this.cached = undefined);
    this.disposables.push(bus.onDidChangeRepo(invalidate), bus.onDidChangeAuth(invalidate), bus.onDidChangeConfig(invalidate));
  }

  /** Describes the platform/host for a repository without touching secrets. */
  describeTarget(repo: RepoContext): ProviderTarget | null {
    const remote = repo.remote;
    if (!remote) {
      return null;
    }
    const override = this.settings.instanceUrl;
    const webBaseUrl = override ?? remote.webBaseUrl;
    let projectPath = remote.projectPath;

    // Self-hosted instance under a relative URL (https://host/gitlab): strip that path from HTTP remotes.
    if (override) {
      const basePath = new URL(override).pathname.replace(/^\/+|\/+$/g, '');
      if (basePath && projectPath.toLowerCase().startsWith(`${basePath.toLowerCase()}/`)) {
        projectPath = projectPath.slice(basePath.length + 1);
      }
    }

    const url = new URL(webBaseUrl);
    const host = SecretsManager.normalizeHost(url.host);
    const setting = this.settings.provider;
    // Pin known cloud hosts so a workspace `gitPilot.provider` cannot route e.g. the github.com
    // token through GitLabProvider (to https://github.com/api/v4 instead of api.github.com).
    const platform =
      fixedCloudPlatform(url.hostname) ??
      (setting === 'auto' ? detectPlatform(url.hostname) ?? detectPlatform(remote.hostname) : setting);
    return { platform, host, webBaseUrl, projectPath };
  }

  /** Describes the active repository's target, if any. */
  currentTarget(): ProviderTarget | null {
    const repo = this.gitService.getRepoContext();
    return repo ? this.describeTarget(repo) : null;
  }

  async resolve(): Promise<ProviderResolution> {
    const repo = this.gitService.getRepoContext();
    if (!repo) {
      return { status: 'noRepository' };
    }
    let target: ProviderTarget | null;
    try {
      target = this.describeTarget(repo);
    } catch (err) {
      // Defensive: a remote/instanceUrl that yields no valid URL must not break every caller.
      this.logger.warn(`Cannot derive the platform URL for ${redactUrl(repo.remote?.url ?? '(no remote)')}: ${String(err)}`);
      target = null;
    }
    if (!target) {
      return { status: 'noRemote', repo };
    }
    const platform = target.platform;
    if (!platform) {
      return { status: 'unknownPlatform', repo, target };
    }
    const typedTarget = { ...target, platform };

    const token = await this.secrets.getToken(target.host);
    if (!token) {
      return { status: 'missingToken', repo, target: typedTarget };
    }

    // Do not include the plaintext token in the cache key (`authChanged` invalidates `cached`).
    const key = [platform, target.webBaseUrl, target.projectPath].join('|');
    if (this.cached?.key !== key) {
      const opts = {
        host: target.host,
        webBaseUrl: target.webBaseUrl,
        projectPath: target.projectPath,
        token,
        settings: this.settings,
        logger: this.logger,
      };
      const provider = platform === 'gitlab' ? new GitLabProvider(opts) : new GitHubProvider(opts);
      this.cached = { key, provider };
      this.logger.info(`Provider ready: ${platform} @ ${target.webBaseUrl} [${target.projectPath}]`);
    }
    return { status: 'ready', provider: this.cached.provider, repo, target: typedTarget };
  }

  dispose(): void {
    this.cached = undefined;
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
