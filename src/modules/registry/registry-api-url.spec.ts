import { selfHostedApiBaseUrl } from './registry-api-url';

describe('selfHostedApiBaseUrl', () => {
  it('uses the network name in Docker when unset', () => {
    expect(selfHostedApiBaseUrl('', 'localhost:5000', true)).toBe(
      'http://aoox-registry:5000',
    );
  });
  it('replaces the legacy host.docker.internal value in Docker', () => {
    expect(
      selfHostedApiBaseUrl(
        'http://host.docker.internal:5000',
        'localhost:5000',
        true,
      ),
    ).toBe('http://aoox-registry:5000');
  });
  it('keeps any other explicit value', () => {
    expect(
      selfHostedApiBaseUrl('http://10.0.0.9:5000', 'localhost:5000', true),
    ).toBe('http://10.0.0.9:5000');
  });
  it('keeps the legacy value outside Docker (dev on the host)', () => {
    expect(
      selfHostedApiBaseUrl(
        'http://host.docker.internal:5000',
        'localhost:5000',
        false,
      ),
    ).toBe('http://host.docker.internal:5000');
  });
  it('falls back to the stored address outside Docker', () => {
    expect(selfHostedApiBaseUrl(undefined, 'localhost:5000', false)).toBe(
      'http://localhost:5000',
    );
  });
});
