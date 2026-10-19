import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ComposeWebhookService } from '../../compose/compose-webhook/compose-webhook.service';
import { encryptSecret } from '../../docker/secret.util';
import { ProjectAccessService } from '../../project/project-access.service';
import type { Project } from '../../project/project.entity';
import { GetWebhookService } from './get-webhook.service';

const KEY = 'a'.repeat(64);
const project = { id: 'p1', ownerId: 'creator' } as Project;
const config = {
  get: () => 'https://api.example.test',
  getOrThrow: () => KEY,
};
const row = {
  webhookToken: 'tok123',
  webhookSecretEncrypted: encryptSecret('s3cret', KEY),
};
const qb = () => {
  const b: Record<string, unknown> = {};
  b.addSelect = () => b;
  b.where = () => b;
  b.getOneOrFail = () => Promise.resolve(row);
  return b;
};

type Role = 'admin' | 'developer' | 'viewer' | null;

function access(role: Role) {
  const members = {
    manager: { findOne: () => Promise.resolve({ role: 'member' }) },
    findOne: () => Promise.resolve(role ? { role } : null),
  };
  return new ProjectAccessService(members as never, {} as never);
}

function appService(a: ProjectAccessService) {
  return new GetWebhookService(
    {
      findOwnedOrFail: (_id: string, uid: string) =>
        a
          .assertAccess(uid, project)
          .then(() => ({ project, gitBranch: 'main' })),
      repo: { createQueryBuilder: qb },
    } as never,
    config as never,
    a,
  );
}

function composeService(a: ProjectAccessService) {
  return new ComposeWebhookService(
    {
      findOwnedOrFail: (_id: string, uid: string) =>
        a.assertAccess(uid, project).then(() => ({
          id: 'x',
          project,
          gitBranch: 'main',
          source: 'git',
        })),
      repo: { createQueryBuilder: qb },
    } as never,
    config as never,
    a,
  );
}

const cases: Array<[string, (role: Role) => Promise<unknown>]> = [
  ['application', (role) => appService(access(role)).execute('u', 'x')],
  ['compose', (role) => composeService(access(role)).info('u', 'x')],
];

describe.each(cases)('%s webhook info', (_name, run) => {
  it('gives developers and admins the URL, token and secret', async () => {
    for (const role of ['developer', 'admin'] as const) {
      await expect(run(role)).resolves.toMatchObject({
        token: 'tok123',
        secret: 's3cret',
      });
    }
  });

  it('refuses viewers with 403 and outsiders with 404', async () => {
    await expect(run('viewer')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run(null)).rejects.toBeInstanceOf(NotFoundException);
  });
});
