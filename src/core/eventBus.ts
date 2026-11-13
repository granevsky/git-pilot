import * as vscode from 'vscode';
import type { RepoContext } from './types';

export interface BranchChangeEvent {
  repo: RepoContext | null;
  previousBranch: string | null;
  branch: string | null;
}

export interface AuthChangeEvent {
  /** Host whose token was added, replaced or removed (e.g. `gitlab.company.com`). */
  host: string;
}

/** Map of every event on the bus to its payload type. */
export interface PilotEvents {
  repoChanged: RepoContext | null;
  branchChanged: BranchChangeEvent;
  configChanged: vscode.ConfigurationChangeEvent;
  authChanged: AuthChangeEvent;
}

type EmitterMap = { [K in keyof PilotEvents]: vscode.EventEmitter<PilotEvents[K]> };

/**
 * Typed pub/sub hub shared by core services and feature modules. Modules never
 * talk to each other directly; they subscribe to these events instead.
 */
export class EventBus implements vscode.Disposable {
  private readonly emitters: EmitterMap = {
    repoChanged: new vscode.EventEmitter(),
    branchChanged: new vscode.EventEmitter(),
    configChanged: new vscode.EventEmitter(),
    authChanged: new vscode.EventEmitter(),
  };

  readonly onDidChangeRepo = this.emitters.repoChanged.event;
  readonly onDidChangeBranch = this.emitters.branchChanged.event;
  readonly onDidChangeConfig = this.emitters.configChanged.event;
  readonly onDidChangeAuth = this.emitters.authChanged.event;

  on<K extends keyof PilotEvents>(event: K, listener: (payload: PilotEvents[K]) => unknown): vscode.Disposable {
    return (this.emitters[event] as vscode.EventEmitter<PilotEvents[K]>).event(listener);
  }

  emit<K extends keyof PilotEvents>(event: K, payload: PilotEvents[K]): void {
    (this.emitters[event] as vscode.EventEmitter<PilotEvents[K]>).fire(payload);
  }

  dispose(): void {
    for (const emitter of Object.values(this.emitters)) {
      emitter.dispose();
    }
  }
}
