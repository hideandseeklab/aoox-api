import { detectLogErrors, normalizeFingerprint } from './log-error-detector';

const dockerLine = (iso: string, msg: string) => `${iso} ${msg}`;

describe('detectLogErrors', () => {
  it('detects a Python traceback, gluing indented frames, and the unindented exception summary as its own event', () => {
    const text = [
      dockerLine(
        '2026-09-28T10:00:00.000000000Z',
        'Traceback (most recent call last):',
      ),
      dockerLine(
        '2026-09-28T10:00:00.000000001Z',
        '  File "app.py", line 10, in <module>',
      ),
      dockerLine(
        '2026-09-28T10:00:00.000000002Z',
        '    raise ValueError("bad input")',
      ),
      dockerLine('2026-09-28T10:00:00.000000003Z', 'ValueError: bad input'),
    ].join('\n');
    const events = detectLogErrors(text);
    // The final summary line ("ValueError: bad input") isn't indented, so it's
    // matched as its own error-start rather than folded into the first event —
    // a known, accepted simplification (still gets counted/notified either way).
    expect(events).toHaveLength(2);
    expect(events[0].firstLine).toBe('Traceback (most recent call last):');
    expect(events[0].lines).toEqual([
      'Traceback (most recent call last):',
      '  File "app.py", line 10, in <module>',
      '    raise ValueError("bad input")',
    ]);
    expect(events[1].firstLine).toBe('ValueError: bad input');
  });

  it('detects a Go panic', () => {
    const events = detectLogErrors(
      dockerLine(
        '2026-09-28T10:00:00Z',
        'panic: runtime error: index out of range',
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0].firstLine).toContain('panic:');
  });

  it('detects an unhandled promise rejection', () => {
    const events = detectLogErrors(
      'UnhandledPromiseRejection: something broke',
    );
    expect(events).toHaveLength(1);
  });

  it('detects a generic "FooError:" / "BarException:" line', () => {
    expect(
      detectLogErrors('TypeError: Cannot read property of undefined'),
    ).toHaveLength(1);
    expect(detectLogErrors('com.example.MyCustomException: boom')).toHaveLength(
      1,
    );
  });

  it('detects logrus-style level=error / level="fatal"', () => {
    expect(
      detectLogErrors('time="2026-09-28" level=error msg="db down"'),
    ).toHaveLength(1);
    expect(detectLogErrors('level="fatal" msg="cannot start"')).toHaveLength(1);
  });

  it('detects a bare FATAL marker', () => {
    expect(
      detectLogErrors('FATAL: could not connect to database'),
    ).toHaveLength(1);
  });

  it('detects a bracketed [ERROR] level tag', () => {
    expect(detectLogErrors('[ERROR] request failed with 500')).toHaveLength(1);
  });

  it('detects a pino-style JSON line with level "error"/"fatal"', () => {
    expect(detectLogErrors('{"level":"error","msg":"boom"}')).toHaveLength(1);
    expect(detectLogErrors('{"level":"fatal","msg":"boom"}')).toHaveLength(1);
  });

  it('detects a pino numeric level (50=error, 60=fatal)', () => {
    expect(detectLogErrors('{"level":50,"msg":"boom"}')).toHaveLength(1);
    expect(detectLogErrors('{"level":60,"msg":"boom"}')).toHaveLength(1);
  });

  it('ignores JSON lines with a non-error level', () => {
    expect(detectLogErrors('{"level":"info","msg":"all good"}')).toHaveLength(
      0,
    );
    expect(detectLogErrors('{"level":30,"msg":"all good"}')).toHaveLength(0);
  });

  it('ignores malformed JSON that merely starts with "{"', () => {
    expect(detectLogErrors('{not valid json error')).toHaveLength(0);
  });

  describe('false positives', () => {
    const cases = [
      '0 errors',
      '0 Errors found',
      'errors: 0',
      'Errors: 0',
      'no error',
      'No errors here',
      'error_count=0',
      'error-count: 0',
    ];
    it.each(cases)('does not flag %j', (line) => {
      expect(detectLogErrors(line)).toHaveLength(0);
    });
  });

  it('ignores ordinary log lines', () => {
    const text = [
      'Server listening on port 3000',
      'GET /health 200 3ms',
      'Connected to database',
    ].join('\n');
    expect(detectLogErrors(text)).toHaveLength(0);
  });

  it('strips the Docker timestamp prefix and ANSI color codes', () => {
    const events = detectLogErrors(
      dockerLine(
        '2026-09-28T10:00:00.123456789Z',
        '\u001b[31mFATAL\u001b[0m: crashed',
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0].firstLine).not.toContain('\u001b');
    expect(events[0].firstLine).not.toMatch(/^\d{4}-/);
  });

  it('caps the event at 20 lines total (first line + continuations)', () => {
    const trace = ['Traceback (most recent call last):']
      .concat(Array.from({ length: 30 }, (_, i) => `  frame ${i}`))
      .join('\n');
    const events = detectLogErrors(trace);
    expect(events).toHaveLength(1);
    expect(events[0].lines.length).toBe(20);
  });

  it('captures multiple separate events in one chunk', () => {
    const text = [
      'FATAL: first crash',
      'normal line resets the capture',
      '[ERROR] second crash',
    ].join('\n');
    const events = detectLogErrors(text);
    expect(events).toHaveLength(2);
  });

  it('a plain non-continuation line ends the current event capture', () => {
    const text = [
      'Traceback (most recent call last):',
      '  File "a.py", line 1',
      'this is not indented, not "at", not "File"',
      '  this indented line should NOT be re-attached',
    ].join('\n');
    const events = detectLogErrors(text);
    expect(events).toHaveLength(1);
    expect(events[0].lines).toEqual([
      'Traceback (most recent call last):',
      '  File "a.py", line 1',
    ]);
  });
});

describe('normalizeFingerprint', () => {
  it('gives the same fingerprint to the same error shape with different ids/timestamps', () => {
    const a = normalizeFingerprint(
      'Error: failed for request a1b2c3d4-e5f6-7890-abcd-ef1234567890 at 2026-09-28T10:00:00Z after 123ms',
    );
    const b = normalizeFingerprint(
      'Error: failed for request 00000000-1111-2222-3333-444444444444 at 2026-09-28T11:22:33Z after 987ms',
    );
    expect(a).toBe(b);
  });

  it('normalizes bare numbers and hex addresses', () => {
    expect(normalizeFingerprint('segfault at 0xDEADBEEF, pid 12345')).toBe(
      'segfault at <hex>, pid <n>',
    );
  });

  it('truncates very long lines', () => {
    const long = 'Error: ' + 'x'.repeat(500);
    expect(normalizeFingerprint(long).length).toBeLessThanOrEqual(200);
  });
});
