import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ContainerCreateBody } from '../docker/docker-engine.client';
import { DockerService } from '../docker/docker.service';
import { encryptSecret } from '../docker/secret.util';
import { BackupDestination } from './backup-destination.entity';
import {
  BackupDestinationService,
  RCLONE_IMAGE,
  rcloneEnv,
  remoteKey,
} from './backup-destination.service';

describe('rcloneEnv', () => {
  it('uses provider Other with a custom endpoint and AWS without one', () => {
    const base = {
      region: 'us-east-1',
      bucket: 'b',
      prefix: '',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      forcePathStyle: true,
    };
    expect(rcloneEnv({ ...base, endpoint: 'http://minio:9000' })).toEqual(
      expect.arrayContaining([
        'RCLONE_CONFIG_S3_TYPE=s3',
        'RCLONE_CONFIG_S3_PROVIDER=Other',
        'RCLONE_CONFIG_S3_ENDPOINT=http://minio:9000',
        'RCLONE_CONFIG_S3_FORCE_PATH_STYLE=true',
        'RCLONE_CONFIG_S3_NO_CHECK_BUCKET=true',
      ]),
    );
    expect(rcloneEnv({ ...base, endpoint: null })).toContain(
      'RCLONE_CONFIG_S3_PROVIDER=AWS',
    );
  });
});

describe('remoteKey', () => {
  it('joins prefix and filename without stray slashes', () => {
    expect(remoteKey({ prefix: '' }, 'db/a.sql.gz')).toBe('db/a.sql.gz');
    expect(remoteKey({ prefix: '/ik/prod/' }, 'db/a.sql.gz')).toBe(
      'ik/prod/db/a.sql.gz',
    );
  });
});

describe('BackupDestinationService', () => {
  const KEY = 'test-key';
  const row = {
    id: 'd1',
    endpoint: 'http://minio:9000',
    region: '',
    bucket: 'backups',
    prefix: 'ik',
    accessKeyId: 'AK',
    secretAccessKeyEncrypted: encryptSecret('SK', KEY),
    forcePathStyle: true,
  } as BackupDestination;
  const repo = {
    createQueryBuilder: () => ({
      addSelect: () => ({
        where: () => ({ getOne: () => Promise.resolve(row) }),
      }),
    }),
  } as unknown as Repository<BackupDestination>;
  const docker = {
    ensureImage: jest.fn().mockResolvedValue(undefined),
    ensureNetwork: jest.fn().mockResolvedValue(undefined),
    runOnceWithOutput: jest.fn<
      Promise<{ code: number; output: string }>,
      [ContainerCreateBody]
    >(),
  };
  const svc = new BackupDestinationService(
    repo,
    docker as unknown as DockerService,
    { getOrThrow: () => KEY } as unknown as ConfigService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('uploads with the volume mounted read-only and returns the object key', async () => {
    docker.runOnceWithOutput.mockResolvedValue({ code: 0, output: '' });
    await expect(svc.upload('d1', 'db/a.sql.gz')).resolves.toBe(
      'ik/db/a.sql.gz',
    );
    const body = docker.runOnceWithOutput.mock.calls[0][0];
    expect(body.Image).toBe(RCLONE_IMAGE);
    expect(body.Cmd?.slice(0, 3)).toEqual([
      'copyto',
      '/backups/db/a.sql.gz',
      's3:backups/ik/db/a.sql.gz',
    ]);
    expect(body.Env).toContain('RCLONE_CONFIG_S3_SECRET_ACCESS_KEY=SK');
    expect(body.HostConfig?.Binds).toEqual(['aoox_backups:/backups:ro']);
  });

  it('surfaces rclone errors from the last log line', async () => {
    docker.runOnceWithOutput.mockResolvedValue({
      code: 1,
      output:
        '2026-01-01T00:00:00Z NOTICE: x\n2026-01-01T00:00:00Z ERROR : AccessDenied\n',
    });
    await expect(svc.upload('d1', 'db/a.sql.gz')).rejects.toThrow(
      'AccessDenied',
    );
  });

  it("strips rclone's own log prefix and redacts the secret key", async () => {
    docker.runOnceWithOutput.mockResolvedValue({
      code: 1,
      output:
        '2026-09-21T08:46:09Z 2026/09/21 08:46:09 NOTICE: Failed to copyto: signing with SK failed\n',
    });
    await expect(svc.upload('d1', 'db/a.sql.gz')).rejects.toThrow(
      'Failed to copyto: signing with *** failed',
    );
  });

  it('remove never throws, even when the destination cannot be resolved', async () => {
    const broken = new BackupDestinationService(
      {
        createQueryBuilder: () => ({
          addSelect: () => ({
            where: () => ({ getOne: () => Promise.reject(new Error('db')) }),
          }),
        }),
      } as unknown as Repository<BackupDestination>,
      docker as unknown as DockerService,
      { getOrThrow: () => KEY } as unknown as ConfigService,
    );
    await expect(broken.remove('d1', 'k')).resolves.toBeUndefined();
  });

  it('remove never throws (prune must not get stuck)', async () => {
    docker.runOnceWithOutput.mockResolvedValue({ code: 1, output: 'boom' });
    await expect(svc.remove('d1', 'ik/db/a.sql.gz')).resolves.toBeUndefined();
  });
});
