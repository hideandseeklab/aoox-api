import * as http from 'http';
import {
  DockerEngineClient,
  DockerEngineError,
  StreamDemuxer,
  demultiplex,
} from './docker-engine.client';

/** Frames a payload the way the Engine multiplexes stdout (type 1) / stderr (type 2). */
function frame(type: number, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = type;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe('demultiplex', () => {
  it('strips frame headers and keeps stdout/stderr order', () => {
    const buf = Buffer.concat([
      frame(1, 'out '),
      frame(2, 'err '),
      frame(1, 'done'),
    ]);
    expect(demultiplex(buf)).toBe('out err done');
  });
});

describe('StreamDemuxer', () => {
  it('reassembles frames split across chunks', () => {
    const whole = Buffer.concat([frame(1, 'hello '), frame(2, 'world')]);
    const d = new StreamDemuxer();
    let out = '';
    for (let i = 0; i < whole.length; i += 5)
      out += d.push(whole.subarray(i, i + 5));
    expect(out).toBe('hello world');
  });
});

describe('DockerEngineClient', () => {
  // A tiny fake engine on a unix socket / named pipe, since the client only
  // speaks HTTP over `socketPath`.
  let server: http.Server;
  let socketPath: string;
  const seen: { method?: string; url?: string; body: string }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, body });
        if (req.url?.endsWith('/_ping')) return res.end('OK');
        if (req.url?.includes('/images/missing/json')) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ message: 'No such image: missing' }));
        }
        if (req.url?.includes('/images/create')) {
          return res.end(
            '{"status":"Pulling"}\n{"error":"manifest unknown"}\n',
          );
        }
        if (req.url?.includes('/containers/create')) {
          return res.end(JSON.stringify({ Id: 'abc' }));
        }
        if (req.url?.includes('/wait')) {
          return res.end(JSON.stringify({ StatusCode: 3 }));
        }
        if (req.url?.includes('/exec/') && req.url.endsWith('/start')) {
          res.setHeader(
            'Content-Type',
            'application/vnd.docker.multiplexed-stream',
          );
          return res.end(frame(1, 'hello from exec'));
        }
        if (req.url?.endsWith('/exec')) {
          return res.end(JSON.stringify({ Id: 'exec1' }));
        }
        res.end('{}');
      });
    });
    socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\aoox-test-${process.pid}`
        : `/tmp/aoox-test-${process.pid}.sock`;
    await new Promise<void>((r) => server.listen(socketPath, r));
    expect(server.address()).not.toBeNull();
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const client = () => new DockerEngineClient(socketPath, 'v1.44');

  it('prefixes the api version and pings', async () => {
    await expect(client().ping()).resolves.toBe('OK');
    expect(seen.at(-1)?.url).toBe('/v1.44/_ping');
  });

  it('maps 404 on image inspect to null and other errors to DockerEngineError', async () => {
    await expect(client().inspectImage('missing')).resolves.toBeNull();
    await expect(client().pullImage('registry:3')).rejects.toBeInstanceOf(
      DockerEngineError,
    );
    await expect(client().pullImage('registry:3')).rejects.toMatchObject({
      message: 'manifest unknown',
    });
    expect(seen.at(-1)?.url).toBe(
      '/v1.44/images/create?fromImage=registry&tag=3',
    );
  });

  it('creates containers with a name and JSON body, and reads wait status', async () => {
    const id = await client().createContainer({ Image: 'x' }, 'my-name');
    expect(id).toBe('abc');
    const create = seen.at(-1);
    expect(create?.url).toBe('/v1.44/containers/create?name=my-name');
    expect(JSON.parse(create?.body ?? '')).toEqual({ Image: 'x' });
    await expect(client().waitContainer('abc')).resolves.toBe(3);
  });

  it('runs exec and demultiplexes the output stream', async () => {
    await expect(client().exec('abc', { Cmd: ['echo'] })).resolves.toBe(
      'hello from exec',
    );
  });
});
