import type { ContainerSummary } from '../docker/docker-engine.client';
import { claimsOnHosts, hostsInRule, routedHosts } from './traefik-hosts';

const c = (
  name: string,
  rule: string | null,
  state = 'running',
): ContainerSummary => ({
  Id: name.padEnd(64, '0'),
  Names: [`/${name}`],
  Image: 'i',
  State: state,
  Status: '',
  Labels: rule ? { 'traefik.http.routers.r1.rule': rule } : {},
});

describe('hostsInRule', () => {
  it('reads backtick, double and single quoted hosts, lower-cased', () => {
    expect(hostsInRule('Host(`Orphan.TEST`)')).toEqual(['orphan.test']);
    expect(hostsInRule('Host("a.test")')).toEqual(['a.test']);
    expect(hostsInRule("Host('a.test')")).toEqual(['a.test']);
  });

  it('reads several Host calls and several hosts in one call', () => {
    expect(hostsInRule('Host(`a.test`) || Host(`b.test`)')).toEqual([
      'a.test',
      'b.test',
    ]);
    expect(hostsInRule('Host(`a.test`, `b.test`)')).toEqual([
      'a.test',
      'b.test',
    ]);
    expect(
      hostsInRule('Host(`a.test`) && PathPrefix(`/x`) || host(`c.test`)'),
    ).toEqual(['a.test', 'c.test']);
  });

  it('ignores HostRegexp and HostSNI and path matchers', () => {
    expect(hostsInRule('HostRegexp(`{s:.+}.a.test`)')).toEqual([]);
    expect(hostsInRule('HostSNI(`a.test`)')).toEqual([]);
    expect(hostsInRule('PathPrefix(`/a.test`)')).toEqual([]);
  });
});

describe('routedHosts / claimsOnHosts', () => {
  it('collects hosts from every router rule label only', () => {
    const hosts = routedHosts({
      'traefik.http.routers.a.rule': 'Host(`a.test`)',
      'traefik.http.routers.b-secure.rule': 'Host(`b.test`)',
      'traefik.http.routers.a.entrypoints': 'web',
      'other.label': 'Host(`z.test`)',
    });
    expect([...hosts].sort()).toEqual(['a.test', 'b.test']);
  });

  it('returns the other containers claiming each host, ignoring own ones and non-serving states', () => {
    const own = c('aoox-app-mine', 'Host(`x.test`)');
    const old = c('aoox-app-old', 'Host(`X.test`) || Host(`y.test`)');
    const stopped = c('stopped', 'Host(`x.test`)', 'exited');
    const other = c('other', 'Host(`q.test`)');
    const out = claimsOnHosts(
      [own, old, stopped, other],
      ['x.test', 'y.test', 'z.test'],
      (ct) => ct.Names[0] === '/aoox-app-mine',
    );
    expect(out.get('x.test')?.map((k) => k.Names[0])).toEqual([
      '/aoox-app-old',
    ]);
    expect(out.get('y.test')?.length).toBe(1);
    expect(out.get('z.test')).toEqual([]);
  });
});
