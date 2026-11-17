import type { PilotModuleFactory } from '../core/types';
import { StatusSyncModule } from './statusSync';

/**
 * Registry of feature modules. To add a module (e.g. `dailyIssues`, `reviewRadar`,
 * `pipelineWatcher`), implement `PilotModule` in `src/modules/<id>/index.ts`
 * and append its factory here — nothing else needs to change.
 */
export const MODULES: readonly PilotModuleFactory[] = [() => new StatusSyncModule()];
