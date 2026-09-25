import * as os from 'os';
import * as pty from 'node-pty';
import { TerminalSize } from './terminal.protocol';
import { TerminalSession } from './terminal.session';

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: 'powershell.exe', args: ['-NoLogo'] };
  }
  return { file: process.env.SHELL || 'bash', args: ['-l'] };
}

/** Shell on the same machine as the API process (dev, or bare-metal installs). */
export class LocalPtySession implements TerminalSession {
  readonly target: string;
  private readonly proc: pty.IPty;

  constructor(size: TerminalSize) {
    const shell = defaultShell();
    this.target = `local:${shell.file}`;
    this.proc = pty.spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd: os.homedir(),
      env: process.env,
    });
  }

  write(data: string) {
    this.proc.write(data);
  }

  resize({ cols, rows }: TerminalSize) {
    if (cols !== this.proc.cols || rows !== this.proc.rows) {
      this.proc.resize(cols, rows);
    }
  }

  onData(cb: (data: string) => void) {
    this.proc.onData(cb);
  }

  onExit(cb: (code: number) => void) {
    this.proc.onExit(({ exitCode }) => cb(exitCode));
  }

  kill() {
    this.proc.kill();
  }
}
