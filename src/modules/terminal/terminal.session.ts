import { TerminalSize } from './terminal.protocol';

/** A running interactive shell, regardless of where it executes. */
export interface TerminalSession {
  /** Human-readable target, for logs (e.g. `local:powershell.exe`, `ssh:user@host`). */
  readonly target: string;
  write(data: string): void;
  resize(size: TerminalSize): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (code: number) => void): void;
  kill(): void;
}
