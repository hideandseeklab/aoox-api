import { deriveSelfHostedState } from './registry-state';

describe('deriveSelfHostedState', () => {
  it.each([
    [false, true, true, 'docker-unavailable'],
    [false, false, false, 'docker-unavailable'],
    [true, false, false, 'not-installed'],
    [true, true, true, 'installed'],
    [true, true, false, 'unmanaged-container'],
    [true, false, true, 'missing-container'],
  ] as const)(
    'docker=%s container=%s row=%s -> %s',
    (docker, container, row, expected) => {
      expect(deriveSelfHostedState(docker, { installed: container }, row)).toBe(
        expected,
      );
    },
  );
});
