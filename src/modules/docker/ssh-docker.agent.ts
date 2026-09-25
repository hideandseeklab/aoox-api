import * as http from 'http';
import { Duplex } from 'stream';
import { Client, ClientChannel } from 'ssh2';
import { SshTarget } from '../ssh/ssh.session';

/** Socket methods Node's HTTP client calls that an ssh2 channel lacks. */
const SOCKET_NOOPS = [
  'setNoDelay',
  'setKeepAlive',
  'setTimeout',
  'ref',
  'unref',
];

/**
 * `http.Agent` that reaches a remote Docker daemon the way `docker -H ssh://`
 * does: one SSH connection per server, and per HTTP request an `exec` of
 * `docker system dial-stdio` on the server, whose stdio is the daemon
 * socket. Needs only the docker CLI on the server (no port forwarding, so
 * hardened sshd with `AllowTcpForwarding no` still works). The SSH session
 * is opened lazily and reopened after a drop.
 */
export class SshDockerAgent extends http.Agent {
  private conn: Client | null = null;
  private ready: Promise<Client> | null = null;

  constructor(private readonly target: SshTarget) {
    // keepAlive would try to reuse a finished exec channel.
    super({ keepAlive: false, maxSockets: Infinity });
  }

  createConnection(
    _options: http.ClientRequestArgs,
    callback?: (err: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    if (!callback) throw new Error('SshDockerAgent needs the async callback');
    this.connect()
      .then((conn) =>
        conn.exec('docker system dial-stdio', (err, channel) => {
          if (err) return callback(err, undefined as unknown as Duplex);
          callback(null, asSocket(channel));
        }),
      )
      .catch((err: unknown) =>
        callback(
          err instanceof Error ? err : new Error(String(err)),
          undefined as unknown as Duplex,
        ),
      );
    return undefined;
  }

  /** Closes the SSH session; the next request reconnects. */
  close(): void {
    this.conn?.end();
    this.conn = null;
    this.ready = null;
  }

  destroy(): void {
    this.close();
    super.destroy();
  }

  private connect(): Promise<Client> {
    if (this.ready) return this.ready;
    const conn = new Client();
    this.conn = conn;
    this.ready = new Promise<Client>((resolve, reject) => {
      conn
        .on('ready', () => resolve(conn))
        .on('error', (err) => {
          if (this.conn === conn) this.close();
          reject(err);
        })
        .on('close', () => {
          if (this.conn === conn) this.close();
        })
        .connect({
          host: this.target.host,
          port: this.target.port,
          username: this.target.username,
          privateKey: this.target.privateKey,
          passphrase: this.target.passphrase,
          password: this.target.password,
          readyTimeout: 15_000,
          keepaliveInterval: 15_000,
        });
    });
    return this.ready;
  }
}

function asSocket(channel: ClientChannel): Duplex {
  const s = channel as unknown as Record<string, unknown>;
  for (const m of SOCKET_NOOPS) {
    if (typeof s[m] !== 'function') s[m] = () => channel;
  }
  return channel;
}
