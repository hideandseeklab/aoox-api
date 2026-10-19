import { DockerHandle } from './docker.service';

function handle(waitCode: number) {
  const engine = {
    createContainer: jest.fn().mockResolvedValue('helper'),
    startContainer: jest.fn().mockResolvedValue(undefined),
    waitContainer: jest.fn().mockResolvedValue(waitCode),
    containerLogs: jest.fn().mockResolvedValue('out'),
    removeContainer: jest.fn().mockResolvedValue(undefined),
  };
  return { engine, handle: new DockerHandle(engine as never, '/sock') };
}

describe('DockerHandle one-shot helpers', () => {
  it('runOnce removes the container together with its anonymous volumes', async () => {
    const { engine, handle: h } = handle(0);
    await expect(h.runOnce({ Image: 'postgres:16' })).resolves.toBe(0);
    expect(engine.removeContainer).toHaveBeenCalledWith('helper', true, true);
  });

  it('runOnceWithOutput does too, and also when the run throws', async () => {
    const { engine, handle: h } = handle(1);
    await expect(h.runOnceWithOutput({ Image: 'redis:7' })).resolves.toEqual({
      code: 1,
      output: 'out',
    });
    expect(engine.removeContainer).toHaveBeenCalledWith('helper', true, true);

    const failing = handle(0);
    failing.engine.startContainer.mockRejectedValue(new Error('boom'));
    await expect(failing.handle.runOnce({ Image: 'x' })).rejects.toThrow(
      'boom',
    );
    expect(failing.engine.removeContainer).toHaveBeenCalledWith(
      'helper',
      true,
      true,
    );
  });
});
