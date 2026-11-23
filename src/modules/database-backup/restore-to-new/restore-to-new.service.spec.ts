import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseBackupService } from '../database-backup.service';
import { RestoreToNewService } from './restore-to-new.service';

jest.mock('../../managed-database/managed-database.service', () => ({
  ManagedDatabaseService: { slugify: (n: string) => `${n.toLowerCase()}-x1` },
  containerNameForDb: (d: { slug: string }) => `aoox-db-${d.slug}`,
  volumeNameForDb: (d: { slug: string }) => `aoox_db_${d.slug}`,
}));

const source = {
  id: 'src',
  projectId: 'p1',
  name: 'Main',
  slug: 'main-abc',
  engine: 'postgres',
  variant: 'pgvector',
  imageTag: 'pg16',
  username: 'app',
  databaseName: 'main_abc',
  backupCron: '0 * * * *',
  backupDestinationId: 'dest',
};
const backup = {
  id: 'b1',
  filename: 'main-abc/1.sql.gz',
  status: 'success',
  scope: 'database',
  destinationId: null,
  remoteKey: null,
  database: source,
};

function make(
  over: {
    backup?: object;
    findBackup?: jest.Mock;
    findProject?: jest.Mock;
    local?: string[];
  } = {},
) {
  const saved: Array<Record<string, unknown>> = [];
  const repo: Record<string, jest.Mock> = {
    create: jest.fn((v: Record<string, unknown>) => ({ ...v })),
    save: jest.fn((v: Record<string, unknown>) => {
      const row = { id: 'new1', ...v };
      saved.push(row);
      return Promise.resolve(row);
    }),
  };
  const provisionInBackground = jest.fn();
  const update = jest.fn().mockResolvedValue(undefined);
  repo.update = update;
  const databases = {
    repo,
    encrypt: jest.fn((v: string) => `enc:${v}`),
    provisionInBackground,
  };
  const backups = {
    findOwnedForDownloadOrFail:
      over.findBackup ?? jest.fn().mockResolvedValue(over.backup ?? backup),
    restoreToNew: jest.fn().mockResolvedValue(undefined),
  };
  const projects = {
    findOwnedOrFail:
      over.findProject ?? jest.fn().mockResolvedValue({ id: 'p2' }),
  };
  const files = {
    localFiles: jest
      .fn()
      .mockResolvedValue(new Set(over.local ?? [backup.filename])),
    ensureLocal: jest.fn().mockResolvedValue({ fetched: false }),
  };
  const svc = new RestoreToNewService(
    backups as unknown as DatabaseBackupService,
    databases as never,
    projects as never,
    files as never,
  );
  return {
    svc,
    repo,
    update,
    provisionInBackground,
    backups,
    projects,
    files,
    saved,
  };
}

describe('RestoreToNewService', () => {
  it('creates a creating row from the source engine/variant/tag, without schedule or mounts, and hides the password', async () => {
    const t = make();
    const res = await t.svc.execute('u1', 'b1', {
      name: 'Copy',
      projectId: 'p2',
    });
    expect(t.projects.findOwnedOrFail).toHaveBeenCalledWith('p2', 'u1');
    expect(res).toMatchObject({
      projectId: 'p2',
      name: 'Copy',
      engine: 'postgres',
      variant: 'pgvector',
      imageTag: 'pg16',
      username: 'app',
      databaseName: 'copy_x1',
      status: 'creating',
      hostPort: null,
    });
    expect(res).not.toHaveProperty('passwordEncrypted');
    expect(res).not.toHaveProperty('backupCron');
    expect(res).not.toHaveProperty('backupDestinationId');
    expect(t.provisionInBackground).toHaveBeenCalledTimes(1);
  });

  it('defaults the target project to the source project', async () => {
    const t = make();
    await t.svc.execute('u1', 'b1', { name: 'Copy' });
    expect(t.projects.findOwnedOrFail).toHaveBeenCalledWith('p1', 'u1');
  });

  it('restores after provisioning, pulling the file back first', async () => {
    const t = make();
    await t.svc.execute('u1', 'b1', { name: 'Copy' });
    const opts = (t.provisionInBackground.mock.calls[0] as unknown[])[2] as {
      afterProvision: () => Promise<void>;
      failureMessage?: unknown;
    };
    // The row is marked until the restore finished; provisioning errors are not reworded.
    expect(t.saved[0]).toMatchObject({ restorePending: true });
    expect(opts.failureMessage).toBeUndefined();
    expect(t.backups.restoreToNew).not.toHaveBeenCalled();
    await opts.afterProvision();
    expect(t.files.ensureLocal).toHaveBeenCalledWith(backup);
    expect(t.backups.restoreToNew).toHaveBeenCalledWith(
      backup,
      source,
      expect.objectContaining({ id: 'new1', engine: 'postgres' }),
    );
    expect(t.update).toHaveBeenCalledWith('new1', { restorePending: false });
  });

  it('words a failure of the restore step (S3 pull or restore helper) as a failed restore, and keeps the marker', async () => {
    for (const failing of ['ensureLocal', 'restoreToNew'] as const) {
      const t = make();
      if (failing === 'ensureLocal') {
        t.files.ensureLocal.mockRejectedValue(new Error('S3 down'));
      } else {
        t.backups.restoreToNew.mockRejectedValue(new Error('exit 3'));
      }
      await t.svc.execute('u1', 'b1', { name: 'Copy' });
      const opts = (t.provisionInBackground.mock.calls[0] as unknown[])[2] as {
        afterProvision: () => Promise<void>;
      };
      await expect(opts.afterProvision()).rejects.toThrow(
        `Restore of backup main-abc/1.sql.gz failed: ${failing === 'ensureLocal' ? 'S3 down' : 'exit 3'}`,
      );
      expect(t.update).not.toHaveBeenCalled();
    }
  });

  describe('access', () => {
    it('outsider on the source backup: 404, nothing created', async () => {
      const t = make({
        findBackup: jest.fn().mockRejectedValue(new NotFoundException()),
      });
      await expect(
        t.svc.execute('u1', 'b1', { name: 'Copy' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(t.repo.save).not.toHaveBeenCalled();
    });

    it('viewer on the source backup: 403, nothing created', async () => {
      const t = make({
        findBackup: jest.fn().mockRejectedValue(new ForbiddenException()),
      });
      await expect(
        t.svc.execute('u1', 'b1', { name: 'Copy' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(t.repo.save).not.toHaveBeenCalled();
    });

    it('viewer on the target project: 403, outsider: 404, nothing created', async () => {
      for (const err of [new ForbiddenException(), new NotFoundException()]) {
        const t = make({ findProject: jest.fn().mockRejectedValue(err) });
        await expect(
          t.svc.execute('u1', 'b1', { name: 'Copy', projectId: 'p9' }),
        ).rejects.toBe(err);
        expect(t.repo.save).not.toHaveBeenCalled();
        expect(t.provisionInBackground).not.toHaveBeenCalled();
      }
    });
  });

  describe('refusals before anything is created', () => {
    it('a failed backup', async () => {
      const t = make({ backup: { ...backup, status: 'failed' } });
      await expect(
        t.svc.execute('u1', 'b1', { name: 'Copy' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(t.repo.save).not.toHaveBeenCalled();
    });

    it('a whole-server sql backup', async () => {
      const t = make({ backup: { ...backup, scope: 'all' } });
      await expect(t.svc.execute('u1', 'b1', { name: 'Copy' })).rejects.toThrow(
        /single-database backup/,
      );
      expect(t.repo.save).not.toHaveBeenCalled();
    });

    it('a file that is gone and has no S3 copy', async () => {
      const t = make({ local: [] });
      await expect(t.svc.execute('u1', 'b1', { name: 'Copy' })).rejects.toThrow(
        /no longer on this server/,
      );
      expect(t.repo.save).not.toHaveBeenCalled();
    });

    it('a missing local file is fine when an S3 copy exists', async () => {
      const t = make({
        local: [],
        backup: { ...backup, destinationId: 'd', remoteKey: 'k' },
      });
      await t.svc.execute('u1', 'b1', { name: 'Copy' });
      expect(t.files.localFiles).not.toHaveBeenCalled();
      expect(t.repo.save).toHaveBeenCalled();
    });
  });
});
