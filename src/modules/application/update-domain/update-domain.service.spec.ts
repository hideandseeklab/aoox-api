import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddDomainDto } from '../add-domain/add-domain.dto';
import { UpdateDomainDto } from './update-domain.dto';
import { UpdateDomainService } from './update-domain.service';

const CERT = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'wildcard',
  domains: ['*.example.com'],
};

function make(
  domain: Record<string, unknown> | null,
  opts: { proxyRunning?: boolean; serverId?: string | null } = {},
) {
  const app = { id: 'app1', serverId: opts.serverId ?? null };
  const domainsRepo = {
    findOne: jest.fn().mockResolvedValue(domain),
    save: jest.fn((d: unknown) => Promise.resolve(d)),
  };
  const events: string[] = [];
  const runner = {
    applyRuntimeConfig: jest.fn(() => {
      events.push('apply');
      return Promise.resolve();
    }),
  };
  const handle = { label: 'handle' };
  const proxy = {
    localSettings: {
      httpPort: 80,
      httpsPort: 443,
      acmeEmail: null,
      acmeStaging: false,
    },
    statusOn: jest
      .fn()
      .mockResolvedValue({ running: opts.proxyRunning ?? true }),
    provisionOn: jest.fn().mockResolvedValue(undefined),
  };
  const certs = {
    findOrFail: jest.fn().mockResolvedValue(CERT),
    assertCovers: jest.fn(),
  };
  const certSync = {
    sync: jest.fn(() => {
      events.push('sync');
      return Promise.resolve({ certificates: 1, proxyRecreated: false });
    }),
  };
  const svc = new UpdateDomainService(
    {
      findOwnedOrFail: jest.fn().mockResolvedValue(app),
      domains: domainsRepo,
    } as never,
    runner as never,
    proxy as never,
    { forServer: jest.fn().mockResolvedValue(handle) } as never,
    {
      findOrFail: jest.fn().mockResolvedValue({
        proxyHttpPort: 8080,
        proxyHttpsPort: 8443,
        acmeEmail: null,
        acmeStaging: false,
      }),
    } as never,
    certs as never,
    certSync as never,
  );
  return { svc, domainsRepo, runner, proxy, certs, certSync, events, handle };
}

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'd1',
  applicationId: 'app1',
  host: 'app.example.com',
  https: true,
  certificateId: null,
  certificate: null,
  createdAt: new Date(),
  ...extra,
});

describe('UpdateDomainService', () => {
  it('assigns a certificate: validates coverage, syncs, then recreates the container', async () => {
    const t = make(row());
    const dto = await t.svc.execute('owner', 'app1', 'd1', {
      certificateId: CERT.id,
    });
    expect(t.certs.assertCovers).toHaveBeenCalledWith(
      ['app.example.com'],
      CERT.domains,
    );
    expect(t.domainsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ certificateId: CERT.id }),
    );
    expect(t.events).toEqual(['sync', 'apply']);
    expect(t.certSync.sync).toHaveBeenCalledWith(
      t.handle,
      expect.any(Object),
      null,
    );
    expect(dto).toMatchObject({
      certificateId: CERT.id,
      certificateName: 'wildcard',
      host: 'app.example.com',
    });
  });

  it('answers with the assigned id even when save() nulls it on the entity (TypeORM, relation set to null)', async () => {
    const t = make(row());
    t.domainsRepo.save.mockImplementation((d: Record<string, unknown>) => {
      const written = { ...d };
      d.certificateId = null; // what TypeORM did to the entity in a live run
      return Promise.resolve(written);
    });
    const dto = await t.svc.execute('owner', 'app1', 'd1', {
      certificateId: CERT.id,
    });
    expect(dto).toMatchObject({
      certificateId: CERT.id,
      certificateName: 'wildcard',
    });
  });

  it('puts the previous assignment back and answers 502 when the certificate cannot be written', async () => {
    const t = make(row({ certificateId: 'old-cert' }));
    t.certSync.sync.mockRejectedValue(new Error('ssh down'));
    await expect(
      t.svc.execute('owner', 'app1', 'd1', { certificateId: CERT.id }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(t.domainsRepo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ certificateId: 'old-cert' }),
    );
    expect(t.runner.applyRuntimeConfig).not.toHaveBeenCalled();
  });

  it('provisions a proxy that is not running before the labels appear', async () => {
    const t = make(row(), { proxyRunning: false });
    await t.svc.execute('owner', 'app1', 'd1', { certificateId: CERT.id });
    expect(t.proxy.provisionOn).toHaveBeenCalledTimes(1);
  });

  it('on a remote app syncs that server, not the host', async () => {
    const t = make(row(), { serverId: 'srv1' });
    await t.svc.execute('owner', 'app1', 'd1', { certificateId: CERT.id });
    expect(t.certSync.sync).toHaveBeenCalledWith(
      t.handle,
      expect.objectContaining({ httpPort: 8080 }),
      'srv1',
    );
  });

  it('null goes back to ACME: clears the column, syncs (drops the files) and recreates', async () => {
    const t = make(row({ certificateId: CERT.id }));
    const dto = await t.svc.execute('owner', 'app1', 'd1', {
      certificateId: null,
    });
    expect(t.certs.findOrFail).not.toHaveBeenCalled();
    expect(t.domainsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ certificateId: null }),
    );
    expect(t.proxy.statusOn).not.toHaveBeenCalled();
    expect(t.events).toEqual(['sync', 'apply']);
    expect(dto).toMatchObject({ certificateId: null, certificateName: null });
  });

  it('unassigning from a domain that never had one does nothing to the proxy', async () => {
    const t = make(row());
    await t.svc.execute('owner', 'app1', 'd1', { certificateId: null });
    expect(t.certSync.sync).not.toHaveBeenCalled();
    expect(t.runner.applyRuntimeConfig).not.toHaveBeenCalled();
  });

  it('refuses a certificate on a plain-http domain, and one that does not cover the host', async () => {
    const plain = make(row({ https: false }));
    await expect(
      plain.svc.execute('owner', 'app1', 'd1', { certificateId: CERT.id }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(plain.domainsRepo.save).not.toHaveBeenCalled();

    const uncovered = make(row());
    uncovered.certs.assertCovers.mockImplementation(() => {
      throw new BadRequestException('does not cover');
    });
    await expect(
      uncovered.svc.execute('owner', 'app1', 'd1', { certificateId: CERT.id }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(uncovered.domainsRepo.save).not.toHaveBeenCalled();
    expect(uncovered.certSync.sync).not.toHaveBeenCalled();
  });

  it('404s a domain that is not on this application', async () => {
    const t = make(null);
    await expect(
      t.svc.execute('owner', 'app1', 'nope', { certificateId: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('domain DTOs', () => {
  const update = (body: object) =>
    validate(plainToInstance(UpdateDomainDto, body));
  const add = (body: object) => validate(plainToInstance(AddDomainDto, body));

  it('PATCH takes a uuid, null or an empty string, and requires the key', async () => {
    expect(await update({ certificateId: CERT.id })).toHaveLength(0);
    expect(await update({ certificateId: null })).toHaveLength(0);
    expect(await update({ certificateId: '' })).toHaveLength(0);
    expect((await update({ certificateId: 'nope' })).length).toBeGreaterThan(0);
    expect((await update({})).length).toBeGreaterThan(0);
  });

  it('POST accepts certificateId omitted, null, "" or a uuid, and rejects junk', async () => {
    const base = { host: 'app.example.com', https: true };
    expect(await add(base)).toHaveLength(0);
    expect(await add({ ...base, certificateId: null })).toHaveLength(0);
    expect(await add({ ...base, certificateId: '' })).toHaveLength(0);
    expect(await add({ ...base, certificateId: CERT.id })).toHaveLength(0);
    expect((await add({ ...base, certificateId: 'x' })).length).toBeGreaterThan(
      0,
    );
  });
});
