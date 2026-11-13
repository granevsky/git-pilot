import * as vscode from 'vscode';
import { SecretsManager } from './config/secrets';
import { extractIssueNumber } from './git/gitService';
import { errorMessage } from './logger';
import { detectPlatform, type ProviderTarget } from './providers/providerManager';
import type { PilotContext, Platform } from './types';

/**
 * Opens only http(s) URLs in the browser. `openExternal` also accepts `vscode:`/`command:`-style
 * URIs that other extensions handle, so server-supplied links must never reach it unchecked.
 */
export async function openExternalSafe(url: string): Promise<boolean> {
  let parsed: vscode.Uri;
  try {
    parsed = vscode.Uri.parse(url, true);
  } catch {
    return false;
  }
  if (parsed.scheme !== 'https' && parsed.scheme !== 'http') {
    void vscode.window.showWarningMessage(`Git Pilot: refused to open a non-web link (${parsed.scheme}:).`);
    return false;
  }
  return vscode.env.openExternal(parsed);
}

/** Commands owned by the core platform (shared by all modules). */
export function registerCoreCommands(ctx: PilotContext): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('gitPilot.setToken', () => setToken(ctx)),
    vscode.commands.registerCommand('gitPilot.openInBrowser', () => openInBrowser(ctx)),
  );
}

async function pickPlatform(host: string): Promise<Platform | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: '$(server) GitLab', description: 'GitLab.com or self-managed GitLab CE/EE', platform: 'gitlab' as const },
      { label: '$(github) GitHub', description: 'GitHub.com or GitHub Enterprise Server', platform: 'github' as const },
    ],
    { title: `Git Pilot: Which platform is ${host}?`, ignoreFocusOut: true },
  );
  return pick?.platform;
}

/** Determines the host for the token: the active repository's, or one the user types in. */
async function resolveTokenTarget(ctx: PilotContext): Promise<ProviderTarget | undefined> {
  const current = ctx.providerManager.currentTarget();
  if (current) {
    return current;
  }
  const value = await vscode.window.showInputBox({
    title: 'Git Pilot: Instance URL',
    prompt: 'No repository with a recognizable remote is open. Which instance is the token for?',
    value: ctx.settings.instanceUrl ?? 'https://gitlab.com',
    ignoreFocusOut: true,
    validateInput: (v) => {
      try {
        new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
        return null;
      } catch {
        return 'Enter a valid URL, e.g. https://gitlab.company.com';
      }
    },
  });
  if (!value) {
    return undefined;
  }
  const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  const setting = ctx.settings.provider;
  return {
    platform: setting === 'auto' ? detectPlatform(url.hostname) : setting,
    host: SecretsManager.normalizeHost(url.host),
    webBaseUrl: `${url.protocol}//${url.host}`,
    projectPath: '',
  };
}

async function setToken(ctx: PilotContext): Promise<void> {
  const target = await resolveTokenTarget(ctx);
  if (!target) {
    return;
  }

  let platform = target.platform;
  if (!platform) {
    const picked = await pickPlatform(target.host);
    if (!picked) {
      return;
    }
    platform = picked;
    // Persist the choice so auto-detection is not needed next time.
    const scope = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration('gitPilot').update('provider', platform, scope);
  }

  const result = await ctx.secrets.promptForToken(target.host, platform, target.webBaseUrl);
  if (result === 'cancelled') {
    return;
  }
  if (result === 'deleted') {
    void vscode.window.showInformationMessage(`Git Pilot: token for ${target.host} removed.`);
    return;
  }

  // Verify the freshly stored token against the API.
  const res = await ctx.providerManager.resolve();
  if (res.status !== 'ready' || res.target.host !== target.host) {
    void vscode.window.showInformationMessage(`Git Pilot: token for ${target.host} saved.`);
    return;
  }
  try {
    const user = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Git Pilot: verifying token for ${target.host}…` },
      () => res.provider.getCurrentUser(),
    );
    void vscode.window.showInformationMessage(`Git Pilot: authenticated as @${user.username} on ${target.host}.`);
  } catch (err) {
    const choice = await vscode.window.showWarningMessage(`Git Pilot: token saved, but verification failed: ${errorMessage(err)}`, 'Re-enter Token');
    if (choice === 'Re-enter Token') {
      await setToken(ctx);
    }
  }
}

async function openInBrowser(ctx: PilotContext): Promise<void> {
  const res = await ctx.providerManager.resolve();
  if (res.status === 'missingToken' || res.status === 'unknownPlatform') {
    const choice = await vscode.window.showWarningMessage('Git Pilot: set an API token first.', 'Set Token');
    if (choice === 'Set Token') {
      await vscode.commands.executeCommand('gitPilot.setToken');
    }
    return;
  }
  if (res.status !== 'ready') {
    void vscode.window.showInformationMessage('Git Pilot: no repository with a GitLab/GitHub remote is open.');
    return;
  }

  const { provider, repo } = res;
  const projectUrl = `${provider.webBaseUrl}/${provider.projectPath}`;
  const items: Array<vscode.QuickPickItem & { url: string }> = [];
  const issueNumber = extractIssueNumber(repo.branch, ctx.settings.branchIssueRegex);

  if (issueNumber && repo.branch) {
    try {
      const state = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Git Pilot: loading links…' },
        () => provider.getSyncState(issueNumber, repo.branch ?? ''),
      );
      if (state) {
        const isGitLab = provider.platform === 'gitlab';
        items.push({ label: `$(issues) Issue #${state.issue.id}`, description: state.issue.title, url: state.issue.webUrl });
        for (const mr of state.mergeRequests) {
          items.push({
            label: `$(git-pull-request) ${isGitLab ? `MR !${mr.id}` : `PR #${mr.id}`}`,
            description: mr.title,
            url: mr.webUrl,
          });
        }
      }
    } catch (err) {
      ctx.logger.warn(`openInBrowser: ${errorMessage(err)}`);
    }
  }
  items.push({ label: '$(repo) Project', description: provider.projectPath, url: projectUrl });

  const pick = items.length === 1 ? items[0] : await vscode.window.showQuickPick(items, { title: 'Git Pilot: Open in Browser', matchOnDescription: true });
  if (pick) {
    await openExternalSafe(pick.url);
  }
}
