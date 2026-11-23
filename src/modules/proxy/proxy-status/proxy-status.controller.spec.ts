import { ProxyStatusController } from './proxy-status.controller';
import type { ProxyService } from '../proxy.service';

const socketError = Object.assign(new Error('connect ENOENT /x.sock'), {
  code: 'ENOENT',
  syscall: 'connect',
  address: '/x.sock',
});

function controller(status: jest.Mock) {
  const proxy = {
    status,
    localSettings: { httpPort: 80, httpsPort: 443, acmeEmail: 'a@b.test' },
    readTimeoutSeconds: null,
  } as unknown as ProxyService;
  return new ProxyStatusController(proxy);
}

describe('ProxyStatusController', () => {
  it('passes the status through with unreachable null', async () => {
    const c = controller(
      jest.fn().mockResolvedValue({ installed: true, running: true }),
    );
    await expect(c.status()).resolves.toMatchObject({
      installed: true,
      unreachable: null,
    });
  });

  it('degrades to 200 with the reason when the daemon is down', async () => {
    const c = controller(jest.fn().mockRejectedValue(socketError));
    await expect(c.status()).resolves.toMatchObject({
      installed: false,
      running: false,
      httpPort: 80,
      httpsPort: 443,
      acmeEmail: 'a@b.test',
      unreachable: 'connect ENOENT /x.sock',
    });
  });

  it('does not hide other errors', async () => {
    const c = controller(jest.fn().mockRejectedValue(new Error('boom')));
    await expect(c.status()).rejects.toThrow('boom');
  });
});
