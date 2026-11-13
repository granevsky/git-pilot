import * as vscode from 'vscode';

/** Thin wrapper around a LogOutputChannel ("Git Pilot" in the Output panel). */
export class Logger implements vscode.Disposable {
  private readonly channel: vscode.LogOutputChannel;

  constructor(name = 'Git Pilot') {
    this.channel = vscode.window.createOutputChannel(name, { log: true });
  }

  trace(message: string, ...args: unknown[]): void {
    this.channel.trace(message, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.channel.debug(message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.channel.info(message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.channel.warn(message, ...args);
  }

  error(message: string | Error, ...args: unknown[]): void {
    this.channel.error(message, ...args);
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
