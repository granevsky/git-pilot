import * as vscode from 'vscode';
import type { EventBus } from '../eventBus';
import type { Platform } from '../types';

const KEY_PREFIX = 'gitPilot.token:';

/**
 * Stores one Personal Access Token per host in VS Code's SecretStorage
 * (OS keychain backed). Hosts are normalized to lowercase `hostname[:port]`.
 */
export class SecretsManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly storage: vscode.SecretStorage,
    bus: EventBus,
  ) {
    this.disposables.push(
      storage.onDidChange((e) => {
        if (e.key.startsWith(KEY_PREFIX)) {
          bus.emit('authChanged', { host: e.key.slice(KEY_PREFIX.length) });
        }
      }),
    );
  }

  static normalizeHost(host: string): string {
    return host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }

  async getToken(host: string): Promise<string | undefined> {
    const token = await this.storage.get(KEY_PREFIX + SecretsManager.normalizeHost(host));
    return token?.trim() || undefined;
  }

  async setToken(host: string, token: string): Promise<void> {
    await this.storage.store(KEY_PREFIX + SecretsManager.normalizeHost(host), token.trim());
  }

  async deleteToken(host: string): Promise<void> {
    await this.storage.delete(KEY_PREFIX + SecretsManager.normalizeHost(host));
  }

  /**
   * Interactive prompt for a PAT. Includes a title-bar button that opens the
   * platform's token creation page with the right scopes pre-selected.
   *
   * @returns `'stored'`, `'deleted'` (empty input confirmed) or `'cancelled'`.
   */
  async promptForToken(host: string, platform: Platform | null, webBaseUrl: string): Promise<'stored' | 'deleted' | 'cancelled'> {
    const existing = await this.getToken(host);
    const createUrl = tokenCreationUrl(platform, webBaseUrl);
    const scope = platform === 'github' ? 'repo' : platform === 'gitlab' ? 'api' : 'api (GitLab) / repo (GitHub)';

    const input = vscode.window.createInputBox();
    input.title = `Git Pilot: Personal Access Token for ${host}`;
    input.password = true;
    input.ignoreFocusOut = true;
    input.placeholder = existing ? 'A token is already stored. Enter a new one, or submit empty to remove it.' : 'Paste your Personal Access Token';
    input.prompt = `Required scope: ${scope}. Stored in the OS keychain and sent only to ${webBaseUrl}.`;
    input.onDidChangeValue((v) => {
      input.validationMessage = /[\s\u0000-\u001f\u007f]/.test(v.trim()) ? 'A token cannot contain spaces or control characters.' : undefined;
    });
    const openButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('link-external'),
      tooltip: 'Create a new token in the browser',
    };
    if (createUrl) {
      input.buttons = [openButton];
    }

    const value = await new Promise<string | undefined>((resolve) => {
      let accepted = false;
      input.onDidTriggerButton((b) => {
        if (b === openButton && createUrl) {
          void vscode.env.openExternal(vscode.Uri.parse(createUrl));
        }
      });
      input.onDidAccept(() => {
        if (input.validationMessage) {
          return;
        }
        accepted = true;
        resolve(input.value);
        input.hide();
      });
      input.onDidHide(() => {
        if (!accepted) {
          resolve(undefined);
        }
        input.dispose();
      });
      input.show();
    });

    if (value === undefined) {
      return 'cancelled';
    }
    if (!value.trim()) {
      if (!existing) {
        return 'cancelled';
      }
      const confirm = await vscode.window.showWarningMessage(`Remove the stored token for ${host}?`, { modal: true }, 'Remove');
      if (confirm !== 'Remove') {
        return 'cancelled';
      }
      await this.deleteToken(host);
      return 'deleted';
    }
    await this.setToken(host, value);
    return 'stored';
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }
}

function tokenCreationUrl(platform: Platform | null, webBaseUrl: string): string | null {
  if (platform === 'github') {
    return `${webBaseUrl}/settings/tokens/new?scopes=repo&description=Git%20Pilot`;
  }
  if (platform === 'gitlab') {
    return `${webBaseUrl}/-/user_settings/personal_access_tokens?name=Git%20Pilot&scopes=api`;
  }
  return null;
}
