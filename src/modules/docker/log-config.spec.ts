import { logConfig } from './log-config';

describe('logConfig', () => {
  it('defaults to 10m × 3 files', () => {
    expect(logConfig({})).toEqual({
      Type: 'json-file',
      Config: { 'max-size': '10m', 'max-file': '3' },
    });
  });

  it('reads the env and ignores nonsense', () => {
    expect(
      logConfig({ CONTAINER_LOG_MAX_SIZE: '50M', CONTAINER_LOG_MAX_FILE: '5' })
        ?.Config,
    ).toEqual({ 'max-size': '50m', 'max-file': '5' });
    expect(
      logConfig({ CONTAINER_LOG_MAX_SIZE: 'lots', CONTAINER_LOG_MAX_FILE: '0' })
        ?.Config,
    ).toEqual({ 'max-size': '10m', 'max-file': '3' });
  });

  it('can be switched off', () => {
    expect(logConfig({ CONTAINER_LOG_MAX_SIZE: 'off' })).toBeUndefined();
  });
});
