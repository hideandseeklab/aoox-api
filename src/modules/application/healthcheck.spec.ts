import { spawnSync } from 'child_process';
import {
  describeHealthFailure,
  healthcheckFor,
  healthcheckScript,
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
});
