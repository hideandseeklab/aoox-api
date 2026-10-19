import {
  describeRegistryAddress,
  effectivePublishAddress,
  publishAddressFrom,
  registryPortBinding,
} from './registry-address';

const base = {
  domain: null,
  port: 5000,
  publicHost: null,
  publicIp: '203.0.113.7',
};

describe('publishAddressFrom', () => {
  it('defaults to loopback for empty or invalid values', () => {
    expect(publishAddressFrom(undefined)).toBe('127.0.0.1');
    expect(publishAddressFrom('')).toBe('127.0.0.1');
    expect(publishAddressFrom('  ')).toBe('127.0.0.1');
    expect(publishAddressFrom('example.com')).toBe('127.0.0.1');
    expect(publishAddressFrom('0.0.0.0; rm')).toBe('127.0.0.1');
  });
  it('accepts IP literals', () => {
    expect(publishAddressFrom(' 0.0.0.0 ')).toBe('0.0.0.0');
    expect(publishAddressFrom('10.0.0.5')).toBe('10.0.0.5');
    expect(publishAddressFrom('::')).toBe('::');
  });
});

describe('registryPortBinding', () => {
  it('sets HostIp', () => {
    expect(registryPortBinding('127.0.0.1', 5001)).toEqual({
      '5000/tcp': [{ HostIp: '127.0.0.1', HostPort: '5001' }],
    });
  });
});

describe('describeRegistryAddress', () => {
  it('is local only on the default binding', () => {
    expect(
      describeRegistryAddress({ ...base, publishAddress: '127.0.0.1' }),
    ).toEqual({
      externalAddress: null,
      localOnly: true,
      publishAddress: '127.0.0.1',
    });
  });
  it('prefers the domain even on loopback', () => {
    expect(
      describeRegistryAddress({
        ...base,
        domain: 'r.example.com',
        publishAddress: '127.0.0.1',
      }),
    ).toMatchObject({ externalAddress: 'r.example.com', localOnly: false });
  });
  it('uses the public IP when exposed', () => {
    expect(
      describeRegistryAddress({ ...base, publishAddress: '0.0.0.0' }),
    ).toMatchObject({ externalAddress: '203.0.113.7:5000', localOnly: false });
  });
  it('prefers REGISTRY_PUBLIC_HOST over the IP', () => {
    expect(
      describeRegistryAddress({
        ...base,
        publicHost: 'reg.example.net',
        publishAddress: '0.0.0.0',
      }).externalAddress,
    ).toBe('reg.example.net:5000');
  });
  it('has no address when exposed but the IP is unknown', () => {
    expect(
      describeRegistryAddress({
        ...base,
        publicIp: null,
        publishAddress: '0.0.0.0',
      }),
    ).toMatchObject({ externalAddress: null, localOnly: false });
  });
});

describe('effectivePublishAddress', () => {
  const p = (IP: string, PublicPort = 5000) => ({
    IP,
    PrivatePort: 5000,
    PublicPort,
  });
  it('reports what the container is bound to, not the env', () => {
    expect(effectivePublishAddress([p('0.0.0.0'), p('::')], '127.0.0.1')).toBe(
      '0.0.0.0',
    );
    expect(effectivePublishAddress([p('127.0.0.1')], '0.0.0.0')).toBe(
      '127.0.0.1',
    );
  });
  it('prefers a non-loopback entry', () => {
    expect(
      effectivePublishAddress([p('127.0.0.1'), p('::')], '127.0.0.1'),
    ).toBe('::');
  });
  it('uses the fallback when nothing is published', () => {
    expect(effectivePublishAddress(undefined, '127.0.0.1')).toBe('127.0.0.1');
    expect(
      effectivePublishAddress(
        [
          { PrivatePort: 5000 },
          { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 80 },
        ],
        '0.0.0.0',
      ),
    ).toBe('0.0.0.0');
  });
});
