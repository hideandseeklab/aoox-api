import { BackupDestinationService } from '../backup-destination/backup-destination.service';
import { DockerService } from '../docker/docker.service';
import { BackupFilesService } from './backup-files.service';

describe('BackupFilesService', () => {
  const runOnceWithOutput = jest.fn().mockResolvedValue({
    code: 0,
    output:
      '2026-01-01T00:00:00Z /backups/db1/a.sql.gz\n/backups/app/data/b.tar.gz\n',
  });
  const download = jest.fn().mockResolvedValue(undefined);
  const svc = new BackupFilesService(
    {
      ensureImage: jest.fn(),
      engine: { createVolume: jest.fn() },
      runOnceWithOutput,
    } as unknown as DockerService,
    { download } as unknown as BackupDestinationService,
  );

  it('annotates rows with local presence from one find run', async () => {
    const rows = await svc.annotate([
      { filename: 'db1/a.sql.gz' },
      { filename: 'db1/gone.sql.gz' },
    ]);
    expect(rows.map((r) => r.local)).toEqual([true, false]);
    expect(runOnceWithOutput).toHaveBeenCalledTimes(1);
  });

  it('ensureLocal pulls from the destination only when missing, and fails without a copy', async () => {
    expect(
      await svc.ensureLocal({
        filename: 'db1/a.sql.gz',
        destinationId: 'd',
        remoteKey: 'k',
      }),
    ).toEqual({ fetched: false });
    expect(download).not.toHaveBeenCalled();
    expect(
      await svc.ensureLocal({
        filename: 'db1/gone.sql.gz',
        destinationId: 'd',
        remoteKey: 'k',
      }),
    ).toEqual({ fetched: true });
    expect(download).toHaveBeenCalledWith(
      'd',
      'k',
      'db1/gone.sql.gz',
      expect.anything(),
    );
    await expect(
      svc.ensureLocal({
        filename: 'db1/gone.sql.gz',
        destinationId: null,
        remoteKey: null,
      }),
    ).rejects.toThrow(/no S3 copy/);
  });
});
