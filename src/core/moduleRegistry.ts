import type * as vscode from 'vscode';
import { errorMessage, type Logger } from './logger';
import type { PilotContext, PilotModule, PilotModuleFactory } from './types';

/** Activates feature modules in isolation: one failing module never breaks the others. */
export class ModuleRegistry implements vscode.Disposable {
  private readonly modules: PilotModule[] = [];

  constructor(
    private readonly ctx: PilotContext,
    private readonly logger: Logger,
  ) {}

  async activateAll(factories: readonly PilotModuleFactory[]): Promise<void> {
    for (const factory of factories) {
      let mod: PilotModule | undefined;
      try {
        mod = factory();
        await mod.activate(this.ctx);
        this.modules.push(mod);
        this.logger.info(`Module "${mod.id}" activated.`);
      } catch (err) {
        this.logger.error(`Module "${mod?.id ?? '(unknown)'}" failed to activate: ${errorMessage(err)}`);
        try {
          mod?.dispose();
        } catch {
          // ignore
        }
      }
    }
  }

  get activeModuleIds(): string[] {
    return this.modules.map((m) => m.id);
  }

  dispose(): void {
    for (const mod of this.modules.splice(0).reverse()) {
      try {
        mod.dispose();
      } catch (err) {
        this.logger.error(`Module "${mod.id}" failed to dispose: ${errorMessage(err)}`);
      }
    }
  }
}
