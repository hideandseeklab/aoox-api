import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { isWriteRequest } from '../../auth/request-context';
import { SecretSourceError } from '../../secret-source/infisical.client';
import { CreateSecretConnectionDto } from '../../secret-source/create-secret-connection/create-secret-connection.dto';
import { SecretSourceService } from '../../secret-source/secret-source.service';
import { SecretSourceAppService } from './secret-source-app.service';
import { secretSourceView } from './secret-source-view';
import { UpdateSecretSourceDto } from './update-secret-source.dto';

async function errorsFor(payload: Record<string, unknown>) {
  return validate(plainToInstance(UpdateSecretSourceDto, payload));
}

describe('UpdateSecretSourceDto', () => {
  const ok = {
    connectionId: '0b9f4a52-9a42-4b52-9f0e-6f3e5b2f6a11',
    projectId: 'proj_1',
    environment: 'prod',
    path: '/api',
    sync: true,
  };

  it('accepts a complete source and an empty path (= /)', async () => {
    expect(await errorsFor(ok)).toHaveLength(0);
    expect(await errorsFor({ ...ok, path: '' })).toHaveLength(0);
    expect(await errorsFor({ ...ok, path: undefined })).toHaveLength(0);
  });

  it('null or "" connection detaches: the rest is ignored (web sends "")', async () => {
    expect(await errorsFor({ connectionId: null })).toHaveLength(0);
    expect(
      await errorsFor({
        connectionId: '',
        projectId: '',
        environment: '',
        path: '',
        sync: false,
      }),
    ).toHaveLength(0);
  });

  it('detaching accepts whatever the form still sends alongside a null connection', async () => {
    expect(
      await errorsFor({
        connectionId: null,
        projectId: 'a/b',
        environment: 'bad env',
        path: 'nope',
        sync: true,
      }),
    ).toHaveLength(0);
  });

  it.each([
    ['not a uuid', { connectionId: 'abc' }],
    ['project with a slash', { projectId: 'a/b' }],
    ['empty project', { projectId: '' }],
    ['environment with spaces', { environment: 'pro d' }],
    ['empty environment', { environment: '' }],
    ['path without leading /', { path: 'api' }],
    ['path with ..', { path: '/a/../b' }],
    ['path with trailing /', { path: '/api/' }],
    ['path with a space', { path: '/a b' }],
    ['sync not boolean', { sync: 'yes' }],
  ])('rejects %s', async (_label, patch) => {
    expect((await errorsFor({ ...ok, ...patch })).length).toBeGreaterThan(0);
  });
});

describe('CreateSecretConnectionDto', () => {
  const errors = (p: Record<string, unknown>) =>
    validate(plainToInstance(CreateSecretConnectionDto, p));
  const ok = { name: 'prod', clientId: 'id', clientSecret: 'secret' };

  it('url is optional and "" or null mean Infisical Cloud', async () => {
    expect(await errors(ok)).toHaveLength(0);
    expect(await errors({ ...ok, url: '' })).toHaveLength(0);
    expect(await errors({ ...ok, url: null })).toHaveLength(0);
    expect(
      await errors({ ...ok, url: 'https://secrets.example.com' }),
    ).toHaveLength(0);
    expect(await errors({ ...ok, url: 'http://10.0.0.5:8080' })).toHaveLength(
      0,
    );
  });

  it.each([
    'ftp://x.example.com',
    'secrets.example.com',
    'https://user:pw@secrets.example.com',
    'https://x.example.com/?a=1',
  ])('rejects url %s', async (url) => {
    expect((await errors({ ...ok, url })).length).toBeGreaterThan(0);
  });
});

describe('connection DTO', () => {
  it('never carries the client secret', () => {
    const svc = new SecretSourceService(
      {} as never,
      { getOrThrow: () => 'k' } as never,
    );
    const dto = svc.toDto({
      id: 'c1',
      name: 'n',
      provider: 'infisical',
      url: null,
      clientId: 'cid',
      clientSecretEncrypted: 'ENCRYPTED',
      createdAt: new Date(),
    });
    expect(Object.keys(dto).sort()).toEqual(
      ['clientId', 'createdAt', 'id', 'name', 'provider', 'url'].sort(),
    );
    expect(JSON.stringify(dto)).not.toContain('ENCRYPTED');
  });
});

describe('secretSourceView', () => {
  it('null without a source, no credentials with one', () => {
    const none = {
      secretConnectionId: null,
      secretProjectId: null,
      secretEnvironment: null,
      secretPath: '/',
      secretSync: false,
    };
    expect(secretSourceView(none, null)).toBeNull();
    expect(
      secretSourceView(
        {
          secretConnectionId: 'c1',
          secretProjectId: 'p',
          secretEnvironment: 'prod',
          secretPath: '/x',
          secretSync: true,
        },
        'infisical',
      ),
    ).toEqual({
      connectionId: 'c1',
      connectionName: 'infisical',
      projectId: 'p',
      environment: 'prod',
      path: '/x',
      sync: true,
    });
  });
});

describe('write checks', () => {
  it('PUT and the preview POST count as writes, so viewers get 403 from the project access check', () => {
    expect(
      isWriteRequest({
        method: 'PUT',
        path: '/applications/a1/secret-source',
      }),
    ).toBe(true);
    expect(
      isWriteRequest({
        method: 'POST',
        path: '/applications/a1/secret-source/preview',
      }),
    ).toBe(true);
    expect(isWriteRequest({ method: 'GET', path: '/applications/a1' })).toBe(
      false,
    );
  });
});

describe('SecretSourceAppService', () => {
  const app = { id: 'a1', secretConnectionId: 'c1' };
  const update = jest.fn();
  const exists = jest.fn();
  const findOwnedOrFail = jest.fn();
  const fetch = jest.fn();
  const findOrFail = jest.fn();
  const svc = new SecretSourceAppService(
    {
      findOwnedOrFail,
      repo: { update },
      deployments: { exists },
    } as never,
    { findOrFail, fetch } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findOwnedOrFail.mockResolvedValue({
      ...app,
      secretProjectId: 'p',
      secretEnvironment: 'prod',
      secretPath: '/x',
    });
    exists.mockResolvedValue(false);
    findOrFail.mockResolvedValue({ id: 'c1', name: 'infisical' });
  });

  it('sets the source and answers with the view', async () => {
    const r = await svc.update('u1', 'a1', {
      connectionId: 'c1',
      projectId: ' p ',
      environment: 'prod',
      path: '',
      sync: true,
    });
    expect(update).toHaveBeenCalledWith('a1', {
      secretConnectionId: 'c1',
      secretProjectId: 'p',
      secretEnvironment: 'prod',
      secretPath: '/',
      secretSync: true,
    });
    expect(r.secretSource).toMatchObject({
      connectionName: 'infisical',
      path: '/',
      sync: true,
    });
  });

  it('stores nulls (not "") when detaching', async () => {
    const r = await svc.update('u1', 'a1', { connectionId: null });
    expect(update).toHaveBeenCalledWith('a1', {
      secretConnectionId: null,
      secretProjectId: null,
      secretEnvironment: null,
      secretPath: '/',
      secretSync: false,
    });
    expect(r.secretSource).toBeNull();
  });

  it('refuses while a deployment is running (the runner would overwrite it)', async () => {
    exists.mockResolvedValue(true);
    await expect(
      svc.update('u1', 'a1', { connectionId: null }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('preview returns key names only, sorted', async () => {
    fetch.mockResolvedValue(
      new Map([
        ['B', 'value-b-secret'],
        ['A', 'value-a-secret'],
      ]),
    );
    const r = await svc.preview('u1', 'a1');
    expect(r).toEqual({ keys: ['A', 'B'] });
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  it('preview needs a source and turns fetch failures into a short 400', async () => {
    findOwnedOrFail.mockResolvedValueOnce({
      id: 'a1',
      secretConnectionId: null,
    });
    await expect(svc.preview('u1', 'a1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    fetch.mockRejectedValue(
      new SecretSourceError('Secret source "x": login failed (HTTP 401)'),
    );
    await expect(svc.preview('u1', 'a1')).rejects.toThrow(
      'login failed (HTTP 401)',
    );
  });
});
