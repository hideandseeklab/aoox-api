import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { encryptSecret } from '../docker/secret.util';
import { Notification } from './notification.entity';
import { NotificationService } from './notification.service';

const sendNotification = jest.fn<Promise<void>, unknown[]>();
jest.mock('./notification-sender', () => ({
  sendNotification: (...args: unknown[]) => sendNotification(...args),
}));

function channel(name: string, toggles: Partial<Notification>): Notification {
  return {
    id: name,
    name,
    type: 'webhook',
    configEncrypted: encryptSecret(
      JSON.stringify({ type: 'webhook', url: `http://${name}` }),
      'k',
    ),
    onDeploymentSuccess: false,
    onDeploymentFailure: false,
    onBackupFailure: false,
    onJobFailure: false,
    onContainerDown: false,
    onDiskLow: false,
    onCertificateFailure: false,
    onDnsIssue: false,
    createdAt: new Date(),
    ...toggles,
  };
}

describe('NotificationService.broadcast', () => {
  const rows = [
    channel('deploys', {
      onDeploymentSuccess: true,
      onDeploymentFailure: true,
    }),
    channel('ops', { onBackupFailure: true, onContainerDown: true }),
    channel('email', { onContainerDown: true }),
  ];
  const qb = {
    addSelect: () => qb,
    orderBy: () => qb,
    getMany: () => Promise.resolve(rows),
  };
  const repo = {
    createQueryBuilder: () => qb,
  } as unknown as Repository<Notification>;
  const svc = new NotificationService(repo, {
    getOrThrow: () => 'k',
  } as unknown as ConfigService);
  const message = { title: 't', level: 'info' as const, fields: [], data: {} };

  beforeEach(() => {
    sendNotification.mockReset();
    sendNotification.mockResolvedValue(undefined);
  });

  it.each([
    ['deploymentSuccess', ['http://deploys']],
    ['backupFailure', ['http://ops']],
    ['containerDown', ['http://ops', 'http://email']],
  ] as const)('%s reaches only subscribed channels', async (event, urls) => {
    await svc.broadcast(event, message);
    expect(
      sendNotification.mock.calls.map((c) => (c[0] as { url: string }).url),
    ).toEqual(urls);
  });

  it('logs and continues when one channel fails', async () => {
    sendNotification.mockRejectedValueOnce(new Error('boom'));
    await expect(
      svc.broadcast('containerDown', message),
    ).resolves.toBeUndefined();
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it('masks email targets as the recipient list', () => {
    expect(
      NotificationService.hint({
        type: 'email',
        host: 'smtp',
        port: 587,
        secure: false,
        username: 'u',
        password: 'p',
        from: 'a@x',
        to: ['b@x', 'c@x'],
      }),
    ).toBe('b@x, c@x');
  });
});
