import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import { TerminalSize } from '../terminal/terminal.protocol';
import { TerminalSession } from '../terminal/terminal.session';

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  passphrase?: string;
  password?: string;
}

/**
 * Shell on the Docker host (or any machine) over SSH — a container cannot
 * reach the host shell directly, so it SSHes.
 */
export class SshSession implements TerminalSession {
  readonly target: string;
  private readonly conn = new Client();
  private stream: ClientChannel | null = null;
  private readonly dataListeners: Array<(data: string) => void> = [];
  private readonly exitListeners: Array<(code: number) => void> = [];
  private exited = false;

  private constructor(
    private readonly ssh: SshTarget,
    private readonly size: TerminalSize,
  ) {
    this.target = `ssh:${ssh.username}@${ssh.host}:${ssh.port}`;
  }

  /** Connects and opens an interactive shell; rejects on auth/network errors. */
  static open(ssh: SshTarget, size: TerminalSize): Promise<SshSession> {
    const session = new SshSession(ssh, size);
    return session.connect().then(() => session);
  }

  private connect(): Promise<void> {
    const config: ConnectConfig = {
      host: this.ssh.host,
      port: this.ssh.port,
      username: this.ssh.username,
      privateKey: this.ssh.privateKey,
      passphrase: this.ssh.passphrase,
      password: this.ssh.password,
      readyTimeout: 15_000,
      keepaliveInterval: 15_000,
    };

    return new Promise((resolve, reject) => {
      this.conn
        .on('ready', () => {
          const window = {
            term: 'xterm-256color',
            cols: this.size.cols,
            rows: this.size.rows,
          };
          this.conn.shell(window, (err, stream) => {
            if (err) {
              this.conn.end();
              return reject(err);
            }
            this.stream = stream;
            stream.on('data', (d: Buffer) => this.emitData(d.toString('utf8')));
            stream.stderr.on('data', (d: Buffer) =>
              this.emitData(d.toString('utf8')),
            );
            stream.on('close', (code: number | null) => {
              this.emitExit(code ?? 0);
              this.conn.end();
            });
            resolve();
          });
        })
        .on('error', (err) => {
          if (this.stream) this.emitExit(1);
          else reject(err);
        })
        .on('close', () => this.emitExit(0))
        .connect(config);
    });
  }

  write(data: string) {
    this.stream?.write(data);
  }

  resize({ cols, rows }: TerminalSize) {
    this.stream?.setWindow(rows, cols, 0, 0);
  }

  onData(cb: (data: string) => void) {
    this.dataListeners.push(cb);
  }

  onExit(cb: (code: number) => void) {
    this.exitListeners.push(cb);
  }

  kill() {
    this.stream?.end();
    this.conn.end();
  }

  private emitData(data: string) {
    for (const cb of this.dataListeners) cb(data);
  }

  private emitExit(code: number) {
    if (this.exited) return;
    this.exited = true;
    for (const cb of this.exitListeners) cb(code);
  }
}
