import { spawnSync } from 'child_process';
import {
  describeHealthFailure,
  healthcheckFor,
  healthcheckScript,
  isMissingShell,
  NO_SHELL_MESSAGE,
} from './healthcheck';

const ctx = { port: 3000, path: '/health' };

describe('healthcheckScript', () => {
  const script = healthcheckScript('http://127.0.0.1:3000/health');

  it('runs each tool only when present, in order, and ends with 127', () => {
    const order = ['wget', 'curl', 'node', 'python3'].map((t) =>
      script.indexOf(`command -v ${t} >/dev/null 2>&1 && r `),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(script.trimEnd().endsWith('exit 127')).toBe(true);
    // 127 appears nowhere else: it only means "no probe tool".
    expect(script.match(/127/g)).toHaveLength(2); // the port and the final exit
  });

  it('is a CMD-SHELL test with the url quoted', () => {
    const hc = healthcheckFor(3000, 'health');
    expect(hc.Test[0]).toBe('CMD-SHELL');
    expect(hc.Test[1]).toContain('U="http://127.0.0.1:3000/health"');
  });

  const sh = (cmd: string) =>
    spawnSync('sh', ['-c', cmd], { encoding: 'utf8' });

  (spawnSync('sh', ['-c', 'true']).error ? it.skip : it)(
    'exits 127 when no probe tool is on PATH (skipped only when no sh exists)',
    () => {
      const none = sh(`PATH=/nonexistent; ${script}`);
      expect(none.status).toBe(127);
    },
  );
});

describe('describeHealthFailure', () => {
  it('says no probe tool exists for exit 127', () => {
    expect(describeHealthFailure(127, '', ctx)).toMatch(/no probe tool/);
  });

  it.each([
    ['wget: server returned error: HTTP/1.1 500 Internal Server Error', '500'],
    ['curl: (22) The requested URL returned error: 503', '503'],
    ['HTTP Error 404: Not Found', '404'],
    ['HTTP 502', '502'],
  ])('maps an error status (%s)', (out, code) => {
    expect(describeHealthFailure(1, out, ctx)).toBe(
      `the endpoint /health returned HTTP ${code}`,
    );
  });

  it('maps a refused connection', () => {
    expect(
      describeHealthFailure(
        1,
        "wget: can't connect to remote host: Connection refused",
        ctx,
      ),
    ).toBe('connection refused: nothing is listening on port 3000');
    expect(describeHealthFailure(1, 'ECONNREFUSED', ctx)).toMatch(/refused/);
  });

  it('maps a timeout', () => {
    expect(
      describeHealthFailure(1, 'curl: (28) Operation timed out', ctx),
    ).toMatch(/no answer/);
  });

  it('falls back to the exit code and a short output', () => {
    expect(describeHealthFailure(2, 'weird', ctx)).toBe(
      'the probe failed (exit 2: weird)',
    );
    expect(describeHealthFailure(2, '', ctx)).toBe('the probe failed (exit 2)');
  });

  describe('image without /bin/sh', () => {
    // Real State.Health.Log entries recorded by Docker for a FROM scratch image.
    const real =
      'OCI runtime exec failed: exec failed: unable to start container process: exec: "/bin/sh": stat /bin/sh: no such file or directory';
    const pathVariant =
      'OCI runtime exec failed: exec failed: unable to start container process: exec: "/bin/sh": executable file not found in $PATH';

    it.each([real, pathVariant])('says the image has no shell (%#)', (out) => {
      expect(isMissingShell(-1, out)).toBe(true);
      const msg = describeHealthFailure(-1, out, ctx);
      expect(msg).toBe(NO_SHELL_MESSAGE);
      expect(msg).toContain('no /bin/sh');
      expect(msg).toContain('clear the health check path');
    });

    it('does not mistake other failures for a missing shell', () => {
      expect(isMissingShell(0, real)).toBe(false);
      expect(isMissingShell(127, '')).toBe(false);
      expect(
        isMissingShell(1, 'wget: server returned error: HTTP/1.1 500'),
      ).toBe(false);
      // Some other binary missing is not the shell.
      expect(
        isMissingShell(
          -1,
          'OCI runtime exec failed: exec: "/usr/bin/foo": stat /usr/bin/foo: no such file or directory',
        ),
      ).toBe(false);
      expect(describeHealthFailure(-1, 'something odd', ctx)).toBe(
        'the probe failed (exit -1: something odd)',
      );
    });
  });
});
