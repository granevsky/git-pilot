import * as vscode from 'vscode';
import { registerCoreCommands } from './core/commands';
import { SecretsManager } from './core/config/secrets';
import { SettingsManager } from './core/config/settings';
import { EventBus } from './core/eventBus';
import { GitService } from './core/git/gitService';
import { Logger, errorMessage } from './core/logger';
import { ModuleRegistry } from './core/moduleRegistry';
import { ProviderManager } from './core/providers/providerManager';
import type { PilotContext } from './core/types';
import { MODULES } from './modules';

/** Kept so `deactivate` can log; VS Code calls `deactivate` before disposing subscriptions. */
let activeLogger: Logger | undefined;
let activatedAt = 0;

function modeName(mode: vscode.ExtensionMode): string {
  switch (mode) {
    case vscode.ExtensionMode.Development:
      return 'development';
    case vscode.ExtensionMode.Test:
      return 'test';
    default:
      return 'production';
  }
}

/** Startup banner: versions, environment and effective (non-secret) settings. */
function logStartup(logger: Logger, context: vscode.ExtensionContext, settings: SettingsManager): void {
  const version = String(context.extension.packageJSON.version ?? 'unknown');
  const sync = settings.statusSync;
  logger.info(`===== Git Pilot v${version} starting =====`);
  logger.info(
    `Environment: VS Code ${vscode.version} (${vscode.env.appName}, ${vscode.env.uiKind === vscode.UIKind.Web ? 'web' : 'desktop'}), ` +
      `Node ${process.versions.node}, ${process.platform}/${process.arch}, mode: ${modeName(context.extensionMode)}`,
  );
  logger.info(
    `Workspace: ${vscode.workspace.workspaceFolders?.map((f) => f.name).join(', ') || '(no folder open)'}, ` +
      `trusted: ${vscode.workspace.isTrusted}${vscode.env.remoteName ? `, remote: ${vscode.env.remoteName}` : ''}`,
  );
  logger.info(
    `Settings: provider=${settings.provider}, instanceUrl=${settings.instanceUrl ?? '(from remote)'}, ` +
      `allowInsecureHttp=${settings.allowInsecureHttp}, branchIssueRegex=${settings.branchIssueRegexSource}`,
  );
  logger.info(
    `Status Sync: enabled=${sync.enabled}, labelPrefix="${sync.labelPrefix}", sourceOfTruth=${sync.sourceOfTruth}, ` +
      `autoSyncInterval=${sync.autoSyncInterval ? `${sync.autoSyncInterval}s` : 'off'}`,
  );
}

/**
 * Entry point. Builds the core services into a PilotContext, registers core
 * commands, then hands the context to every feature module in `src/modules`.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const started = Date.now();
  const logger = new Logger();
  activeLogger = logger;
  context.subscriptions.push(logger);

  try {
    const eventBus = new EventBus();
    const settings = new SettingsManager(eventBus, logger);
    const secrets = new SecretsManager(context.secrets, eventBus);
    const gitService = new GitService(eventBus, logger);
    const providerManager = new ProviderManager(settings, secrets, gitService, eventBus, logger);

    const ctx: PilotContext = {
      extensionContext: context,
      eventBus,
      logger,
      settings,
      secrets,
      gitService,
      providerManager,
    };

    const registry = new ModuleRegistry(ctx, logger);
    context.subscriptions.push(eventBus, settings, secrets, gitService, providerManager, registerCoreCommands(ctx), registry);

    logStartup(logger, context, settings);

    try {
      await gitService.initialize();
    } catch (err) {
      logger.error(`Git integration failed: ${errorMessage(err)}`);
    }

    await registry.activateAll(MODULES);

    activatedAt = Date.now();
    logger.info(
      `Git Pilot activated in ${activatedAt - started} ms. Modules: ${registry.activeModuleIds.join(', ') || '(none)'} ` +
        `(${registry.activeModuleIds.length}/${MODULES.length})`,
    );
  } catch (err) {
    logger.error(`Git Pilot failed to activate: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    void vscode.window.showErrorMessage('Git Pilot failed to start. See Output → Git Pilot for details.', 'Show Log').then((a) => {
      if (a === 'Show Log') {
        logger.show();
      }
    });
    throw err;
  }
}

export function deactivate(): void {
  // Resources are released via ExtensionContext.subscriptions (after this call).
  if (activeLogger) {
    const uptime = activatedAt ? ` after ${Math.round((Date.now() - activatedAt) / 1000)} s` : '';
    activeLogger.info(`Git Pilot deactivating${uptime}.`);
    activeLogger = undefined;
  }
}
