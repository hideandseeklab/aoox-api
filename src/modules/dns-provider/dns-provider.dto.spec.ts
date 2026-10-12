import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddDomainDto } from '../application/add-domain/add-domain.dto';
import {
  assertCertMode,
  dnsRouting,
  wildcardBase,
} from '../application/cert-mode';
import { UpdateDomainDto } from '../application/update-domain/update-domain.dto';
import { redactBody } from '../audit-log/redact';
import { CreateDnsConnectionDto } from './create-dns-connection/create-dns-connection.dto';
import { toDomainDto } from '../application/domain-dto';

const errors = async (cls: new () => object, v: object) =>
  (await validate(plainToInstance(cls, v))).map((e) => e.property);

describe('CreateDnsConnectionDto', () => {
  it('accepts a token and an optional account id', async () => {
    expect(
      await errors(CreateDnsConnectionDto, {
        name: 'cf',
        apiToken: 'abcDEF1234_-xyz',
      }),
    ).toEqual([]);
    expect(
      await errors(CreateDnsConnectionDto, {
        name: 'cf',
        apiToken: 'abcDEF1234_-xyz',
        accountId: '',
      }),
    ).toEqual([]);
  });
  it('rejects short/odd tokens and a bad account id', async () => {
    expect(
      await errors(CreateDnsConnectionDto, { name: 'cf', apiToken: 'short' }),
    ).toContain('apiToken');
    expect(
      await errors(CreateDnsConnectionDto, {
        name: 'cf',
        apiToken: 'has space in it!',
      }),
    ).toContain('apiToken');
    expect(
      await errors(CreateDnsConnectionDto, {
        name: 'cf',
        apiToken: 'abcDEF1234_-xyz',
        accountId: 'nope',
      }),
    ).toContain('accountId');
  });
});

describe('domain DTOs', () => {
  it('treat "" and null dnsConnectionId as detach/none, reject non-uuids', async () => {
    for (const cls of [AddDomainDto, UpdateDomainDto]) {
      const base = cls === AddDomainDto ? { host: 'a.example.com' } : {};
      expect(await errors(cls, { ...base, dnsConnectionId: '' })).toEqual([]);
      expect(await errors(cls, { ...base, dnsConnectionId: null })).toEqual([]);
      expect(await errors(cls, { ...base, dnsConnectionId: 'x' })).toContain(
        'dnsConnectionId',
      );
      expect(await errors(cls, { ...base, certMode: 'dns-wildcard' })).toEqual(
        [],
      );
      expect(await errors(cls, { ...base, certMode: 'nope' })).toContain(
        'certMode',
      );
    }
  });
});

describe('cert mode helpers', () => {
  it('computes the wildcard base and the label routing', () => {
    expect(wildcardBase('app.example.com')).toBe('example.com');
    expect(wildcardBase('example.com')).toBeNull();
    expect(dnsRouting('app.example.com', 'dns-wildcard')).toEqual({
      main: 'example.com',
    });
    expect(dnsRouting('app.example.com', 'dns')).toEqual({});
    expect(dnsRouting('app.example.com', 'http')).toBeUndefined();
  });
  it('validates the mode against https, custom certs and the proxy', () => {
    const ok = {
      host: 'a.example.com',
      https: true,
      hasCustomCertificate: false,
      proxyHasDns: true,
    };
    expect(() => assertCertMode('dns', ok)).not.toThrow();
    expect(() => assertCertMode('http', { ...ok, https: false })).not.toThrow();
    expect(() => assertCertMode('dns', { ...ok, https: false })).toThrow();
    expect(() =>
      assertCertMode('dns', { ...ok, hasCustomCertificate: true }),
    ).toThrow();
    expect(() => assertCertMode('dns', { ...ok, proxyHasDns: false })).toThrow(
      /Enable DNS-01/,
    );
    expect(() =>
      assertCertMode('dns-wildcard', { ...ok, host: 'example.com' }),
    ).toThrow();
  });
});

describe('secrecy', () => {
  it('redacts the apiToken key in the audit log body', () => {
    const out = redactBody({
      name: 'cf',
      apiToken: 'abcDEF1234_-xyz',
      accountId: 'a',
    });
    expect(JSON.stringify(out)).not.toContain('abcDEF1234_-xyz');
    expect((out as Record<string, unknown>).apiToken).toBe('[redacted]');
  });

  it('never exposes record bookkeeping or tokens in the domain DTO', () => {
    const dto = toDomainDto(
      {
        id: 'd',
        applicationId: 'a',
        host: 'h',
        https: true,
        certificateId: null,
        middlewares: [],
        createdAt: new Date(),
        certMode: 'dns',
        dnsConnectionId: 'c1',
        dnsProxied: true,
        dnsStatus: 'warning',
        dnsMessage: 'm',
        dnsRecords: [{ zoneId: 'z', recordId: 'r' }],
      } as never,
      null,
      'cf',
    );
    expect(dto).toMatchObject({
      dnsConnectionName: 'cf',
      dnsStatus: 'warning',
      certMode: 'dns',
    });
    expect(JSON.stringify(dto)).not.toContain('recordId');
  });
});
