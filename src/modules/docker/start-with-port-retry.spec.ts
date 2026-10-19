import { DockerEngineError } from './docker-engine.client';
import { startWithPortRetry } from './start-with-port-retry';

const noSleep = () => Promise.resolve();

describe('startWithPortRetry', () => {
  it('starts once when nothing fails', async () => {
    const start = jest.fn().mockResolvedValue(undefined);
    await startWithPortRetry(start, 8080, noSleep);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('retries a 500 while a host port is published, then succeeds', async () => {
    const start = jest
      .fn()
      .mockRejectedValueOnce(new DockerEngineError(500, 'x'))
      .mockRejectedValueOnce(new DockerEngineError(500, 'x'))
      .mockResolvedValue(undefined);
    const sleep = jest.fn(noSleep);
    await startWithPortRetry(start, 8080, sleep);
    expect(start).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last delay and throws the daemon error', async () => {
    const start = jest.fn().mockRejectedValue(new DockerEngineError(500, 'x'));
    await expect(
      startWithPortRetry(start, 8080, noSleep),
    ).rejects.toBeInstanceOf(DockerEngineError);
    expect(start).toHaveBeenCalledTimes(4);
  });

  it('never retries without a published port or for other errors', async () => {
    const a = jest.fn().mockRejectedValue(new DockerEngineError(500, 'x'));
    await expect(startWithPortRetry(a, null, noSleep)).rejects.toThrow();
    expect(a).toHaveBeenCalledTimes(1);
    const b = jest.fn().mockRejectedValue(new DockerEngineError(404, 'x'));
    await expect(startWithPortRetry(b, 8080, noSleep)).rejects.toThrow();
    expect(b).toHaveBeenCalledTimes(1);
    const c = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(startWithPortRetry(c, 8080, noSleep)).rejects.toThrow('boom');
    expect(c).toHaveBeenCalledTimes(1);
  });
});
