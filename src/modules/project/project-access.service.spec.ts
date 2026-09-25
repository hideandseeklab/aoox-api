import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApplicationService } from '../application/application.service';
import { ComposeService } from '../compose/compose.service';
import { DatabaseBackupService } from '../database-backup/database-backup.service';
import { JobService } from '../job/job.service';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { VolumeBackupService } from '../volume-backup/volume-backup.service';
import { runWithRequestContext } from '../auth/request-context';
import { ProjectAccessService } from './project-access.service';
import type { Project } from './project.entity';
import { ProjectService } from './project.service';

const project = { id: 'p1', ownerId: 'creator' } as Project;
const otherProject = { id: 'p2', ownerId: 'creator' } as Project;

function access(
  users: Record<string, 'owner' | 'admin' | 'member'>,
  memberships: Array<{ projectId: string; userId: string; role: string }>,
) {
  const members = {
    manager: {
      findOne: (_: unknown, opts: { where: { id: string } }) =>
        Promise.resolve(
          users[opts.where.id]
            ? { id: opts.where.id, role: users[opts.where.id] }
            : null,
        ),
    },
    find: (opts: { where: { userId: string } }) =>
      Promise.resolve(
        memberships.filter((m) => m.userId === opts.where.userId),
      ),
    findOne: (opts: { where: { projectId: string; userId: string } }) =>
      Promise.resolve(
        memberships.find(
          (m) =>
            m.projectId === opts.where.projectId &&
            m.userId === opts.where.userId,
        ) ?? null,
      ),
  };
  const projects = {
    find: (opts: { where: { ownerId: string } }) =>
      Promise.resolve(
        [project, otherProject].filter((p) => p.ownerId === opts.where.ownerId),
      ),
  };
  return new ProjectAccessService(members as never, projects as never);
}

const users = {
  root: 'owner',
  ops: 'admin',
  creator: 'member',
  dev: 'member',
  outsider: 'member',
} as const;
const memberships = [{ projectId: 'p1', userId: 'dev', role: 'developer' }];

describe('ProjectAccessService', () => {
  const svc = access(users, memberships);

  it('gives platform owners/admins and the creator admin access, members their role, others nothing', async () => {
    expect(await svc.roleFor('root', project)).toBe('admin');
    expect(await svc.roleFor('ops', project)).toBe('admin');
    expect(await svc.roleFor('creator', project)).toBe('admin');
    expect(await svc.roleFor('dev', project)).toBe('developer');
    expect(await svc.roleFor('dev', otherProject)).toBeNull();
    expect(await svc.roleFor('outsider', project)).toBeNull();
  });

  it('answers 404 for outsiders and 403 for non-admin members', async () => {
    await expect(svc.assertAccess('outsider', project)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.assertAdmin('dev', project)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.assertAdmin('creator', project)).resolves.toBeUndefined();
  });

  it('lists accessible ids: all for platform admins, created + member rows otherwise', async () => {
    expect(await svc.accessibleProjectIds('ops')).toBe('all');
    expect(await svc.accessibleProjectIds('creator')).toEqual(['p1', 'p2']);
    expect(await svc.accessibleProjectIds('dev')).toEqual(['p1']);
    expect(await svc.accessibleProjectIds('outsider')).toEqual([]);
    expect(await svc.whereAccessible('ops')).toEqual({});
  });
});

/**
 * Every resource helper must reject an outsider with 404 — the test that
 * fails when an eighth resource type forgets to consult ProjectAccessService.
 */
describe('findOwnedOrFail across resource types', () => {
  const acc = access(users, memberships);
  const repoWith = (row: unknown) => ({ findOne: () => Promise.resolve(row) });
  const cases: Array<[string, (id: string, user: string) => Promise<unknown>]> =
    [
      [
        'project',
        (id, u) =>
          new ProjectService(repoWith(project) as never, acc).findOwnedOrFail(
            id,
            u,
          ),
      ],
      [
        'application',
        (id, u) =>
          new ApplicationService(
            repoWith({ id, project }) as never,
            {} as never,
            {} as never,
            {} as never,
            acc,
          ).findOwnedOrFail(id, u),
      ],
      [
        'compose',
        (id, u) =>
          new ComposeService(
            repoWith({ id, project }) as never,
            {} as never,
            {} as never,
            {} as never,
            acc,
          ).findOwnedOrFail(id, u),
      ],
      [
        'database',
        (id, u) =>
          new ManagedDatabaseService(
            repoWith({ id, project }) as never,
            {} as never,
            {} as never,
            { getOrThrow: () => 'k' } as never,
            {} as never,
            acc,
          ).findOwnedOrFail(id, u),
      ],
      [
        'database backup',
        (id, u) =>
          new DatabaseBackupService(
            repoWith({ id, database: { project } }) as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            acc,
          ).findOwnedOrFail(id, u),
      ],
      [
        'volume backup',
        (id, u) =>
          new VolumeBackupService(
            repoWith({ id, application: { project } }) as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            acc,
          ).findOwnedOrFail(id, u),
      ],
      [
        'job',
        (id, u) =>
          new JobService(
            repoWith({ id, database: { project } }) as never,
            {} as never,
            acc,
          ).findOwnedOrFail(id, u),
      ],
    ];

  it.each(cases)(
    '%s: member sees it, outsider gets 404',
    async (_name, find) => {
      await expect(find('x', 'dev')).resolves.toBeTruthy();
      await expect(find('x', 'outsider')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );
});

/**
 * A token scope must only ever narrow: it is read from the request context,
 * so these run the service inside a store the guard would have written.
 */
describe('API token project scope', () => {
  const svc = access(users, memberships);
  const withScope = <T>(projectIds: string[] | null, fn: () => Promise<T>) =>
    runWithRequestContext(
      {
        method: 'GET',
        path: '/x',
        tokenScope: { readOnly: false, projectIds },
      },
      fn,
    );

  it('hides projects outside the scope, even from a platform admin', async () => {
    expect(
      await withScope(['p2'], () => svc.roleFor('ops', project)),
    ).toBeNull();
    expect(await withScope(['p1'], () => svc.roleFor('ops', project))).toBe(
      'admin',
    );
  });

  it('intersects the accessible list instead of replacing it', async () => {
    expect(
      await withScope(['p1', 'p2'], () => svc.accessibleProjectIds('ops')),
    ).toEqual(['p1', 'p2']);
    // `dev` is only a member of p1: a scope naming p2 cannot add it.
    expect(
      await withScope(['p1', 'p2'], () => svc.accessibleProjectIds('dev')),
    ).toEqual(['p1']);
    expect(await withScope(null, () => svc.accessibleProjectIds('ops'))).toBe(
      'all',
    );
  });
});
