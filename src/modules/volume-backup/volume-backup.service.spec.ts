import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Application } from '../application/application.entity';
import { ApplicationService } from '../application/application.service';
import { Mount } from '../application/mount.entity';
import { BackupDestinationService } from '../backup-destination/backup-destination.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { NotificationService } from '../notification/notification.service';
import { VolumeBackup } from './volume-backup.entity';
import { VolumeBackupService } from './volume-backup.service';

describe('VolumeBackupService', () => {
  const rows: Partial<VolumeBackup>[] = [];
  const repo = {
    create: jest.fn((r: Partial<VolumeBackup>) => ({ id: 'b1', ...r })),
    save: jest.fn((r: Partial<VolumeBackup>) => {
      rows.push(r);
      return Promise.resolve(r);
    }),
  } as unknown as Repository<VolumeBackup>;
  const engine = {
    createVolume: jest.fn().mockResolvedValue(undefined),
    stopContainer: jest.fn().mockResolvedValue(undefined),
    startContainer: jest.fn().mockResolvedValue(undefined),
  };
  const docker = {
    engine,
    ensureImage: jest.fn().mockResolvedValue(undefined),
    runOnceWithOutput: jest.fn(),
    findContainerByName: jest
      .fn()
      .mockResolvedValue({ Id: 'c1', State: 'running' }),
  };
  const upload = jest.fn().mockResolvedValue('prefix/key.tar.gz');
  const broadcast = jest.fn().mockResolvedValue(undefined);
  const svc = new VolumeBackupService(
    repo,
    { mounts: { find: jest.fn() } } as unknown as ApplicationService,
    {
      forServer: jest.fn().mockResolvedValue(docker),
    } as unknown as RemoteDockerService,
    { upload, remove: jest.fn() } as unknown as BackupDestinationService,
    { broadcast } as unknown as NotificationService,
    { get: () => 'https://panel' } as unknown as ConfigService,
    {
      status: jest.fn(),
      taskContainers: jest.fn().mockResolvedValue([]),
      scale: jest.fn(),
    } as never,
    { assertAccess: jest.fn().mockResolvedValue('admin') } as never,
  );
  const app = {
    id: 'a1',
    name: 'Web',
    appName: 'web-1',
    serverId: null,
    backupDestinationId: null,
    backupKeep: 7,
  } as unknown as Application;
  const mount = { id: 'm1', type: 'volume', name: 'data' } as Mount;

  beforeEach(() => {
    jest.clearAllMocks();
    rows.length = 0;
  });

  it('tars the volume read-only into the backups volume and records the size', async () => {
    docker.runOnceWithOutput.mockResolvedValue({
      code: 0,
      output: '2026-01-01T00:00:00Z 1234\n',
    });
    const b = await svc.backup(app, mount, 'manual');
    expect(b.status).toBe('success');
    expect(b.sizeBytes).toBe('1234');
    expect(b.filename).toMatch(/^web-1\/data\/.*\.tar\.gz$/);
    const [body] = docker.runOnceWithOutput.mock.calls[0] as [
      { HostConfig: { Binds: string[] }; Entrypoint: string[] },
    ];
    expect(body.HostConfig.Binds).toEqual([
      'aoox_backups:/backups',
      'aoox_app_web_1_data:/data:ro',
    ]);
    expect(body.Entrypoint[2]).toContain('tar czf "$BACKUP_FILE" -C /data .');
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('marks the backup failed (and notifies) when the upload to the destination fails', async () => {
    docker.runOnceWithOutput.mockResolvedValue({ code: 0, output: '10\n' });
    upload.mockRejectedValueOnce(new Error('403'));
    const b = await svc.backup(
      { ...app, backupDestinationId: 'd1' },
      mount,
      'scheduled',
    );
    expect(b.status).toBe('failed');
    expect(b.errorMessage).toContain('Upload to destination failed');
    expect(broadcast).toHaveBeenCalledWith('backupFailure', expect.anything());
  });

  it('refuses non-volume mounts', async () => {
    await expect(
      svc.backup(app, { ...mount, type: 'file' }, 'manual'),
    ).rejects.toThrow(/Only volume mounts/);
  });

  it('restore stops the container, empties and untars the volume, then starts it again even on failure', async () => {
    docker.runOnceWithOutput.mockResolvedValue({
      code: 1,
      output: 'tar: broken\n',
    });
    const backup = {
      status: 'success',
      filename: 'web-1/data/x.tar.gz',
      application: app,
      mount,
    } as unknown as VolumeBackup;
    await expect(svc.restore(backup)).rejects.toThrow('tar: broken');
    expect(engine.stopContainer).toHaveBeenCalledWith('c1');
    expect(engine.startContainer).toHaveBeenCalledWith('c1');
    const [body] = docker.runOnceWithOutput.mock.calls[0] as [
      { HostConfig: { Binds: string[] }; Entrypoint: string[] },
    ];
    expect(body.HostConfig.Binds).toContain('aoox_app_web_1_data:/data');
    expect(body.Entrypoint[2]).toContain('rm -rf ./* ./.[!.]* ./..?*');
    expect(body.Entrypoint[2]).toContain('tar xzf "$BACKUP_FILE" -C /data');
  });
});
