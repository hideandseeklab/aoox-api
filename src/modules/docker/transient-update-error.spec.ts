import {
  isTransientUpdateError,
  withTransientRetry,
} from './transient-update-error';

describe('isTransientUpdateError', () => {
  it.each([
    'OCI runtime exec failed: runc: openat2 /sys/fs/cgroup/x/cgroup.controllers: no such file or directory',
    'cannot update container: Container abc is restarting, wait until the container is running',
    'Container abc is not running',
    'Cannot update container 083a0ac5: cannot update a stopped container',
  ])('recognises %s', (m) => {
    expect(isTransientUpdateError(new Error(m))).toBe(true);
  });

  it('does not swallow other failures', () => {
    expect(isTransientUpdateError(new Error('invalid memory limit'))).toBe(
      false,
    );
    expect(isTransientUpdateError('no such file')).toBe(false);
  });
});

describe('withTransientRetry', () => {
  const transient = new Error('Container x is restarting');

  it('retries once after a transient error', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValue('ok');
    const sleep = jest.fn(() => Promise.resolve());
    await expect(withTransientRetry(fn, sleep, 10)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('throws the second transient failure as is', async () => {
    const fn = jest.fn().mockRejectedValue(transient);
    await expect(
      withTransientRetry(fn, () => Promise.resolve(), 1),
    ).rejects.toBe(transient);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors', async () => {
    const other = new Error('bad request');
    const fn = jest.fn().mockRejectedValue(other);
    const sleep = jest.fn(() => Promise.resolve());
    await expect(withTransientRetry(fn, sleep, 1)).rejects.toBe(other);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
