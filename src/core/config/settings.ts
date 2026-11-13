import * as vscode from 'vscode';
import type { EventBus } from '../eventBus';
import type { Logger } from '../logger';

export const CONFIG_SECTION = 'gitPilot';

export type ProviderSetting = 'auto' | 'gitlab' | 'github';
export type SourceOfTruth = 'mr' | 'issue' | 'prompt';

export const DEFAULT_BRANCH_ISSUE_REGEX = '(?:^|/|-)(\\d+)(?:-|_|$)';
export const DEFAULT_LABEL_PREFIX = 'status:';
const MAX_REGEX_LENGTH = 300;

export interface StatusSyncSettings {
  enabled: boolean;
  labelPrefix: string;
  sourceOfTruth: SourceOfTruth;
  /** Seconds; 0 disables polling. */
  autoSyncInterval: number;
}

/**
 * Typed, validated view over `vscode.workspace.getConfiguration('gitPilot')`.
 * Values are read lazily so they always reflect the current configuration.
 */
export class SettingsManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private cachedRegex: { source: string; regex: RegExp } | undefined;
  private warnedInvalidRegex: string | undefined;

  constructor(
    bus: EventBus,
    private readonly logger: Logger,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_SECTION)) {
          this.cachedRegex = undefined;
          bus.emit('configChanged', e);
        }
      }),
    );
  }

  private get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIG_SECTION);
  }

  get provider(): ProviderSetting {
    const value = this.config.get<string>('provider', 'auto');
    return value === 'gitlab' || value === 'github' ? value : 'auto';
  }

  /** Normalized instance URL override without trailing slash, or `null` if unset. */
  get instanceUrl(): string | null {
    const raw = this.config.get<string>('instanceUrl', '').trim();
    if (!raw) {
      return null;
    }
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(withScheme);
      return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, '');
    } catch {
      this.logger.warn(`Ignoring invalid gitPilot.instanceUrl: "${raw}"`);
      return null;
    }
  }

  /**
   * Whether tokens may be sent over plain HTTP. Declared with `machine` scope in package.json,
   * so only the user (not a cloned repository's `.vscode/settings.json`) can turn it on.
   */
  get allowInsecureHttp(): boolean {
    return this.config.inspect<boolean>('allowInsecureHttp')?.globalValue === true;
  }

  get branchIssueRegexSource(): string {
    const value = this.config.get<string>('branchIssueRegex', DEFAULT_BRANCH_ISSUE_REGEX) || DEFAULT_BRANCH_ISSUE_REGEX;
    // Bound pattern size to limit catastrophic-backtracking (ReDoS) potential.
    return value.length <= MAX_REGEX_LENGTH ? value : DEFAULT_BRANCH_ISSUE_REGEX;
  }

  /** Compiled branch regex; falls back to the default pattern if the configured one is invalid. */
  get branchIssueRegex(): RegExp {
    const source = this.branchIssueRegexSource;
    if (this.cachedRegex?.source === source) {
      return this.cachedRegex.regex;
    }
    let regex: RegExp;
    try {
      regex = new RegExp(source);
    } catch (err) {
      if (this.warnedInvalidRegex !== source) {
        this.warnedInvalidRegex = source;
        void vscode.window.showWarningMessage(
          `Git Pilot: invalid "gitPilot.branchIssueRegex" (${String(err)}). Falling back to the default pattern.`,
        );
      }
      regex = new RegExp(DEFAULT_BRANCH_ISSUE_REGEX);
    }
    this.cachedRegex = { source, regex };
    return regex;
  }

  get statusSync(): StatusSyncSettings {
    const cfg = this.config;
    const sot = cfg.get<string>('statusSync.sourceOfTruth', 'mr');
    const interval = Number(cfg.get<number>('statusSync.autoSyncInterval', 120));
    return {
      enabled: cfg.get<boolean>('statusSync.enabled', true),
      labelPrefix: cfg.get<string>('statusSync.labelPrefix', DEFAULT_LABEL_PREFIX).trim() || DEFAULT_LABEL_PREFIX,
      sourceOfTruth: sot === 'issue' || sot === 'prompt' ? sot : 'mr',
      autoSyncInterval: Number.isFinite(interval) && interval > 0 ? Math.max(10, Math.floor(interval)) : 0,
    };
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
