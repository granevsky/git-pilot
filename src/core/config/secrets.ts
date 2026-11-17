import * as vscode from 'vscode';
import type { EventBus } from '../eventBus';
import type { Logger } from '../logger';
import type { Platform } from '../types';

const KEY_PREFIX = 'gitPilot.token:';

/** Shown when SecretStorage fails — almost always a missing/locked keyring on Linux. */
const KEYCHAIN_HELP =
  'Git Pilot cannot access the OS keychain, so the token cannot be read or saved. ' +
  'On Linux, VS Code needs a Secret Service keyring (e.g. GNOME Keyring or KWallet) that is installed and unlocked; ' +
  'alternatively start VS Code with a "--password-store" option. See "Troubleshooting keychain issues" in the VS Code docs.';

/**
 * Stores one Personal Access Token per host in VS Code's SecretStorage
 * (OS keychain backed). Hosts are normalized to lowercase `hostname[:port]`.
 */
export class SecretsManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private warnedKeychain = false;

  constructor(
    private readonly storage: vscode.SecretStorage,
    bus: EventBus,
    private readonly logger: Logger,
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

  /** The stored token, or `undefined` if there is none or the keychain is unavailable (reported once). */
  async getToken(host: string): Promise<string | undefined> {
    try {
      const token = await this.storage.get(KEY_PREFIX + SecretsManager.normalizeHost(host));
      return token?.trim() || undefined;
    } catch (err) {
      this.reportKeychainError('read', err);
      return undefined;
    }
  }

  async setToken(host: string, token: string): Promise<void> {
    await this.storage.store(KEY_PREFIX + SecretsManager.normalizeHost(host), token.trim());
  }

  async deleteToken(host: string): Promise<void> {
    await this.storage.delete(KEY_PREFIX + SecretsManager.normalizeHost(host));
  }

  private reportKeychainError(action: 'read' | 'save' | 'remove', err: unknown, interactive = false): void {
    // Never include the token: the error comes from the keychain, the message only names the action.
    this.logger.error(`SecretStorage ${action} failed: ${err instanceof Error ? err.message : String(err)}`);
    if (interactive || !this.warnedKeychain) {
      this.warnedKeychain = true;
      void vscode.window.showErrorMessage(KEYCHAIN_HELP, 'Show Log').then((a) => {
        if (a === 'Show Log') {
          this.logger.show();
        }
      });
    }
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
    input.prompt = `Required scope: ${scope} (or fine-grained Issue & PR/MR access). Stored in the OS keychain and sent only to ${webBaseUrl}.`;
    input.onDidChangeValue((v) => {
      const trimmed = v.trim();
      input.validationMessage =
        trimmed && !/^[\x21-\x7e]+$/.test(trimmed) ? 'A token cannot contain spaces, control or non-ASCII characters.' : undefined;
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
      try {
        await this.deleteToken(host);
      } catch (err) {
        this.reportKeychainError('remove', err, true);
        return 'cancelled';
      }
      return 'deleted';
    }
    try {
      await this.setToken(host, value);
    } catch (err) {
      this.reportKeychainError('save', err, true);
      return 'cancelled';
    }
    return 'stored';
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }
}

function tokenCreationUrl(platform: Platform | null, webBaseUrl: string): string | null {
  try {
    const parsed = new URL(webBaseUrl);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) {
      return null;
    }
  } catch {
    return null;
  }
  if (platform === 'github') {
    return `${webBaseUrl}/settings/tokens/new?scopes=repo&description=Git%20Pilot`;
  }
  if (platform === 'gitlab') {
    return `${webBaseUrl}/-/user_settings/personal_access_tokens?name=Git%20Pilot&scopes=api`;
  }
  return null;
}
