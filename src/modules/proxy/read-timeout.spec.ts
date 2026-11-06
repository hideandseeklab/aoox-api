import {
  parseReadTimeoutSeconds,
  readTimeoutFlags,
  readTimeoutFromEnv,
  readTimeoutOf,
} from './read-timeout';

describe('read timeout parsing', () => {
  it.each([
    ['300', 300],
    [' 300 ', 300],
    ['300s', 300],
    ['5m', 300],
    ['1h', 3600],
    ['1m30s', 90],
    ['86400', 86400],
    ['1', 1],
  ])('accepts %s', (raw, seconds) => {
    expect(parseReadTimeoutSeconds(raw)).toBe(seconds);
  });

  it.each([
    '',
    '0',
    '0s',
    '86401',
    '25h',
    '-5',
    '1.5',
    '5x',
    'abc',
    '5 m',
    '1s2m',
    '300ms',
  ])('rejects %p', (raw) => {
    expect(parseReadTimeoutSeconds(raw)).toBeNull();
  });

  it('env: empty is the default, invalid is flagged', () => {
    expect(readTimeoutFromEnv(undefined)).toEqual({
      seconds: null,
      invalid: false,
    });
    expect(readTimeoutFromEnv('  ')).toEqual({ seconds: null, invalid: false });
    expect(readTimeoutFromEnv('5m')).toEqual({ seconds: 300, invalid: false });
    expect(readTimeoutFromEnv('nope')).toEqual({
      seconds: null,
      invalid: true,
    });
  });

  it('builds a flag per entrypoint and reads it back', () => {
    const flags = readTimeoutFlags(300);
    expect(flags).toEqual([
      '--entrypoints.web.transport.respondingtimeouts.readtimeout=300s',
      '--entrypoints.websecure.transport.respondingtimeouts.readtimeout=300s',
    ]);
    expect(readTimeoutOf({ Config: { Cmd: ['--x', ...flags] } })).toBe(300);
    expect(readTimeoutOf({ Config: { Cmd: ['--x'] } })).toBeNull();
    expect(readTimeoutOf({ Config: { Cmd: null } })).toBeNull();
  });
});
