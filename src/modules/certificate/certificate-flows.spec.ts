import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryFailedError } from 'typeorm';
import { redactBody } from '../audit-log/redact';
import { ROLES_KEY } from '../auth/roles.decorator';
import { CertificateService } from './certificate.service';
import {
  CA_CERT,
  EC_CERT,
  EC_KEY,
  LEAF_CERT,
  LEAF_KEY,
  OTHER_KEY,
} from './certificate.fixtures';
import { CreateCertificateController } from './create-certificate/create-certificate.controller';
import { CreateCertificateDto } from './create-certificate/create-certificate.dto';
import { CreateCertificateService } from './create-certificate/create-certificate.service';
import { DeleteCertificateController } from './delete-certificate/delete-certificate.controller';
import { ListCertificatesController } from './list-certificates/list-certificates.controller';
import { UpdateCertificateController } from './update-certificate/update-certificate.controller';
import { UpdateCertificateService } from './update-certificate/update-certificate.service';

const ID = '11111111-1111-4111-8111-111111111111';
const aDate = expect.any(Date) as unknown as Date;
const aFingerprint = expect.stringMatching(
  /^[0-9A-F:]{95}$/,
) as unknown as string;

/** In-memory stand-in for the two repositories. */
function makeCerts(domainsUsing: string[] = []) {
  const rows = new Map<string, Record<string, unknown>>();
  let seq = 0;
  const repo = {
    create: jest.fn((v: Record<string, unknown>) => ({ ...v })),
    save: jest.fn((v: Record<string, unknown>) => {
      const row = {
        id: ID,
        createdAt: new Date('2026-10-05T00:00:00Z'),
        ...v,
      } as Record<string, unknown>;
      rows.set(row.id as string, row);
      seq++;
      return Promise.resolve(row);
    }),
    findOne: jest.fn(({ where }: { where: { id?: string; name?: string } }) =>
      Promise.resolve(
        [...rows.values()].find(
          (r) =>
            (where.id && r.id === where.id) ||
            (where.name && r.name === where.name),
        ) ?? null,
      ),
    ),
    find: jest.fn(() => Promise.resolve([...rows.values()])),
    remove: jest.fn((r: Record<string, unknown>) => {
      rows.delete(r.id as string);
      return Promise.resolve(r);
    }),
  };
  const domains = {
    count: jest.fn().mockResolvedValue(domainsUsing.length),
    find: jest.fn().mockResolvedValue(domainsUsing.map((host) => ({ host }))),
  };
  const certs = new CertificateService(
    repo as never,
    domains as never,
    { getOrThrow: () => 'test-encryption-key' } as never,
  );
  return { certs, repo, domains, rows, saves: () => seq };
}

describe('create certificate', () => {
  it('stores the key encrypted, never the plaintext, and returns a DTO without PEM or key', async () => {
    const { certs, repo } = makeCerts();
    const dto = await new CreateCertificateService(certs).execute({
      name: 'wildcard',
      certificate: `${LEAF_CERT}\n${CA_CERT}`,
      privateKey: LEAF_KEY,
    });

    const saved = repo.save.mock.calls[0][0] as Record<string, string>;
    expect(saved.privateKeyEncrypted).toBeTruthy();
    expect(saved.privateKeyEncrypted).not.toContain('PRIVATE KEY');
    // Round-trips with the configured key.
    expect(certs.decryptKey(saved.privateKeyEncrypted)).toMatch(
      /^-----BEGIN PRIVATE KEY-----/,
    );
    expect(dto).toEqual({
      id: ID,
      name: 'wildcard',
      commonName: 'example.test',
      domains: ['example.test', '*.example.test'],
      issuer: 'aoox test CA',
      notBefore: aDate,
      notAfter: aDate,
      fingerprint: aFingerprint,
      usedBy: 0,
      createdAt: aDate,
    });
    const json = JSON.stringify(dto);
    expect(json).not.toContain('PRIVATE KEY');
    expect(json).not.toContain('BEGIN CERTIFICATE');
    expect(json).not.toMatch(/privateKey|certificatePem/i);
  });

  it('answers 400 for a mismatching key, 409 for a taken name', async () => {
    const { certs } = makeCerts();
    const svc = new CreateCertificateService(certs);
    await expect(
      svc.execute({ name: 'x', certificate: LEAF_CERT, privateKey: OTHER_KEY }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await svc.execute({
      name: 'taken',
      certificate: LEAF_CERT,
      privateKey: LEAF_KEY,
    });
    await expect(
      svc.execute({
        name: 'taken',
        certificate: EC_CERT,
        privateKey: EC_KEY,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps a unique violation from a concurrent upload to 409', async () => {
    const { certs, repo } = makeCerts();
    repo.save.mockRejectedValueOnce(
      Object.assign(
        new QueryFailedError('insert', [], new Error('duplicate') as never),
        { driverError: { code: '23505' } },
      ),
    );
    await expect(
      new CreateCertificateService(certs).execute({
        name: 'race',
        certificate: LEAF_CERT,
        privateKey: LEAF_KEY,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('validates the body shape', async () => {
    const check = (body: object) =>
      validate(plainToInstance(CreateCertificateDto, body));
    expect(
      await check({ name: 'a', certificate: 'x', privateKey: 'y' }),
    ).toHaveLength(0);
    expect(
      (await check({ name: '', certificate: 'x', privateKey: 'y' })).length,
    ).toBeGreaterThan(0);
    expect(
      (await check({ name: 'a', certificate: 'x' })).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await check({
          name: 'a',
          certificate: 'x'.repeat(65537),
          privateKey: 'y',
        })
      ).length,
    ).toBeGreaterThan(0);
    const trimmed = plainToInstance(CreateCertificateDto, {
      name: '  spaced  ',
      certificate: 'x',
      privateKey: 'y',
    });
    expect(trimmed.name).toBe('spaced');
  });
});

describe('update certificate', () => {
  async function seeded(using: string[]) {
    const t = makeCerts(using);
    await new CreateCertificateService(t.certs).execute({
      name: 'wildcard',
      certificate: LEAF_CERT,
      privateKey: LEAF_KEY,
    });
    const sync = { syncForCertificate: jest.fn().mockResolvedValue([]) };
    return {
      ...t,
      sync,
      svc: new UpdateCertificateService(t.certs, sync as never),
    };
  }

  it('replaces the content, keeps the name, syncs every daemon using it and counts the domains', async () => {
    const t = await seeded(['a.example.test']);
    // A renewal: same names, different key pair would be the real case; the
    // EC fixture covers other names, so renew with the same pair.
    const dto = await t.svc.execute(ID, {
      certificate: `${LEAF_CERT}\n${CA_CERT}`,
      privateKey: LEAF_KEY,
    });
    expect(dto.name).toBe('wildcard');
    expect(dto.usedBy).toBe(1);
    expect(t.sync.syncForCertificate).toHaveBeenCalledWith(ID);
    expect(
      (t.rows.get(ID)!.certificatePem as string).match(/BEGIN CERTIFICATE/g),
    ).toHaveLength(2);
  });

  it('refuses content that no longer covers a host in use, naming it, and saves nothing', async () => {
    const t = await seeded(['app.example.test', 'app.other.test']);
    const before = t.saves();
    await expect(
      t.svc.execute(ID, { certificate: LEAF_CERT, privateKey: LEAF_KEY }),
    ).rejects.toThrow(/app\.other\.test/);
    await expect(
      t.svc.execute(ID, { certificate: LEAF_CERT, privateKey: LEAF_KEY }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.saves()).toBe(before);
    expect(t.sync.syncForCertificate).not.toHaveBeenCalled();
  });

  it('validates like create (wrong key 400) and 404s an unknown id', async () => {
    const t = await seeded([]);
    await expect(
      t.svc.execute(ID, { certificate: LEAF_CERT, privateKey: OTHER_KEY }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.svc.execute('22222222-2222-4222-8222-222222222222', {
        certificate: LEAF_CERT,
        privateKey: LEAF_KEY,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports a failed write to the proxy instead of pretending success', async () => {
    const t = await seeded([]);
    t.sync.syncForCertificate.mockRejectedValue(new Error('ssh down'));
    await expect(
      t.svc.execute(ID, { certificate: LEAF_CERT, privateKey: LEAF_KEY }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});

describe('delete and list certificates', () => {
  it('answers 409 naming the hosts while a domain uses it, and deletes when free', async () => {
    const used = makeCerts(['a.example.test', 'b.example.test']);
    await new CreateCertificateService(used.certs).execute({
      name: 'c',
      certificate: LEAF_CERT,
      privateKey: LEAF_KEY,
    });
    const del = new DeleteCertificateController(used.certs);
    await expect(del.remove({ id: ID })).rejects.toThrow(
      /2 domain\(s\): a\.example\.test, b\.example\.test/,
    );
    await expect(del.remove({ id: ID })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(used.repo.remove).not.toHaveBeenCalled();

    const free = makeCerts([]);
    await new CreateCertificateService(free.certs).execute({
      name: 'c',
      certificate: LEAF_CERT,
      privateKey: LEAF_KEY,
    });
    await new DeleteCertificateController(free.certs).remove({ id: ID });
    expect(free.repo.remove).toHaveBeenCalledTimes(1);
  });

  it('lists every certificate with its usage and never any key material', async () => {
    const t = makeCerts([]);
    await new CreateCertificateService(t.certs).execute({
      name: 'c',
      certificate: LEAF_CERT,
      privateKey: LEAF_KEY,
    });
    jest.spyOn(t.certs, 'usageCounts').mockResolvedValue(new Map([[ID, 3]]));
    const list = await new ListCertificatesController(t.certs).list();
    expect(list).toHaveLength(1);
    expect(list[0].usedBy).toBe(3);
    expect(JSON.stringify(list)).not.toMatch(
      /PRIVATE KEY|privateKey|BEGIN CERT/,
    );
    const one = await new ListCertificatesController(t.certs).get({ id: ID });
    expect(one.name).toBe('c');
  });
});

describe('access', () => {
  const rolesOf = (cls: object, handler: string) =>
    new Reflector().getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      (cls as { prototype: Record<string, () => void> }).prototype[handler],
      cls as never,
    ]);

  it('managing certificates is owner/admin only; the list is open to every member', () => {
    expect(rolesOf(CreateCertificateController, 'create')).toEqual([
      'owner',
      'admin',
    ]);
    expect(rolesOf(UpdateCertificateController, 'update')).toEqual([
      'owner',
      'admin',
    ]);
    expect(rolesOf(DeleteCertificateController, 'remove')).toEqual([
      'owner',
      'admin',
    ]);
    expect(rolesOf(ListCertificatesController, 'list')).toBeUndefined();
    expect(rolesOf(ListCertificatesController, 'get')).toBeUndefined();
  });

  it('the audit log redacts the private key and does not carry the PEM', () => {
    const body = redactBody({
      name: 'c',
      certificate: LEAF_CERT,
      privateKey: LEAF_KEY,
    }) as Record<string, string>;
    expect(body.privateKey).toBe('[redacted]');
    // Not a byte of the key survives, and the (public) PEM is cut short.
    const keyBody = LEAF_KEY.split('\n')[1];
    expect(JSON.stringify(body)).not.toContain(keyBody);
    expect(body.certificate.length).toBeLessThanOrEqual(220);
  });
});
