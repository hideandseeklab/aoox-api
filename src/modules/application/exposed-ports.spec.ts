import {
  exposedPortsNote,
  parseExposedPorts,
  portMismatch,
  readExposedPorts,
} from './exposed-ports';

const inspectOf = (ports: Record<string, object> | null) => ({
  Config: { ExposedPorts: ports },
});

describe('parseExposedPorts', () => {
  it('reads TCP ports, sorted and deduplicated', () => {
    expect(
      parseExposedPorts(inspectOf({ '8080/tcp': {}, '80/tcp': {}, '443': {} })),
    ).toEqual([80, 443, 8080]);
  });
  it('ignores udp, sctp and malformed keys', () => {
    expect(
      parseExposedPorts(
        inspectOf({ '53/udp': {}, '1/sctp': {}, 'x/tcp': {}, '70000/tcp': {} }),
      ),
    ).toEqual([]);
  });
  it('returns [] for null, missing or odd input', () => {
    expect(parseExposedPorts(inspectOf(null))).toEqual([]);
    expect(parseExposedPorts({})).toEqual([]);
    expect(parseExposedPorts(null)).toEqual([]);
    expect(parseExposedPorts({ Config: { ExposedPorts: 'x' } })).toEqual([]);
  });
});

describe('portMismatch / exposedPortsNote', () => {
  it('warns when exposed ports exclude the container port', () => {
    expect(portMismatch([80], 3000)).toBe(true);
    expect(exposedPortsNote([80], 3000)).toBe(
      'Note: the image exposes 80/tcp but the container port is 3000. If the app does not listen on 3000, set Container port to 80 (Settings), otherwise requests through a domain fail with "Bad Gateway".',
    );
  });
  it('lists several ports without naming one', () => {
    expect(exposedPortsNote([80, 443], 3000)).toContain('80/tcp, 443/tcp');
    expect(exposedPortsNote([80, 443], 3000)).toContain(
      'the port it listens on',
    );
  });
  it('stays silent when the port matches or nothing is exposed', () => {
    expect(portMismatch([80, 443], 443)).toBe(false);
    expect(exposedPortsNote([80], 80)).toBeNull();
    expect(exposedPortsNote([], 3000)).toBeNull();
  });
});

describe('readExposedPorts', () => {
  it('returns null when the image is missing, throws, or hangs', async () => {
    expect(
      await readExposedPorts(
        { inspectImage: () => Promise.resolve(null) },
        'x',
      ),
    ).toBeNull();
    expect(
      await readExposedPorts(
        { inspectImage: () => Promise.reject(new Error('down')) },
        'x',
      ),
    ).toBeNull();
    expect(
      await readExposedPorts(
        { inspectImage: () => new Promise(() => undefined) },
        'x',
        20,
      ),
    ).toBeNull();
  });
  it('returns the ports of a present image', async () => {
    expect(
      await readExposedPorts(
        { inspectImage: () => Promise.resolve(inspectOf({ '80/tcp': {} })) },
        'x',
      ),
    ).toEqual([80]);
  });
});
