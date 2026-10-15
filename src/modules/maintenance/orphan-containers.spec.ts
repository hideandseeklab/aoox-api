import type { ContainerSummary } from '../docker/docker-engine.client';
import { KnownOwners, orphanedContainers, ownerOf } from './orphan-containers';

const c = (
  name: string,
  labels: Record<string, string> | undefined,
  state = 'running',
): ContainerSummary => ({
  Id: name.padEnd(64, '0'),
  Names: [`/${name}`],
  Image: 'img:1',
  State: state,
  Status: '',
  Labels: labels,
});

const known: KnownOwners = {
  applications: new Set(['app-live']),
  databases: new Set(['db-live']),
  composeApps: new Set(['st-live']),
  composeSlugs: new Set(['live-stack']),
};

const names = (list: ContainerSummary[]) =>
  orphanedContainers(list, known).map((o) => o.name);

describe('orphanedContainers', () => {
  it('reports application containers (also -next and previews) whose app is gone', () => {
    const labels = { 'aoox.component': 'application' };
    expect(
      names([
        c('aoox-app-gone', { ...labels, 'aoox.application': 'app-gone' }),
        c('aoox-app-gone-next', { ...labels, 'aoox.application': 'app-gone' }),
        c('aoox-app-gone-pr3', {
          ...labels,
          'aoox.application': 'app-gone',
          'aoox.preview': 'p1',
        }),
        c('aoox-app-live', { ...labels, 'aoox.application': 'app-live' }),
      ]),
    ).toEqual(['aoox-app-gone', 'aoox-app-gone-next', 'aoox-app-gone-pr3']);
  });

  it('reports databases and companions by database id', () => {
    expect(
      names([
        c('db-a', { 'aoox.component': 'database', 'aoox.database': 'x' }),
        c('db-b', {
          'aoox.component': 'database',
          'aoox.database': 'db-live',
        }),
        c('adm-a', { 'aoox.component': 'companion', 'aoox.companion': 'x' }),
        c('adm-b', {
          'aoox.component': 'companion',
          'aoox.companion': 'db-live',
        }),
      ]),
    ).toEqual(['adm-a', 'db-a']);
  });

  it('reports stack containers by label id or by a bare aoox-<slug> project started from its checkout volume', () => {
    const dir = (slug: string) =>
      `/var/lib/docker/volumes/aoox_compose_${slug}/_data`;
    expect(
      names([
        c('s1', { 'aoox.component': 'compose', 'aoox.compose': 'st-gone' }),
        c('s2', { 'aoox.component': 'compose', 'aoox.compose': 'st-live' }),
        c('s3', {
          'com.docker.compose.project': 'aoox-old',
          'com.docker.compose.project.working_dir': dir('old'),
        }),
        c('s4', {
          'com.docker.compose.project': 'aoox-live-stack',
          'com.docker.compose.project.working_dir': dir('live-stack'),
        }),
        // Someone's own stack that merely starts with "aoox-": other workdir.
        c('s5', {
          'com.docker.compose.project': 'aoox-dev',
          'com.docker.compose.project.working_dir': '/home/me/aoox-dev',
        }),
      ]),
    ).toEqual(['s1', 's3']);
  });

  it('never reports the panel stack, proxy, registry, buildkit, helpers or unlabeled containers', () => {
    const list = [
      c('aoox-api', { 'com.docker.compose.project': 'aoox' }),
      c('aoox_db', { 'com.docker.compose.project': 'aoox' }),
      c('aoox-proxy', {
        'aoox.component': 'proxy',
        'com.docker.compose.project': 'aoox',
      }),
      c('aoox-registry', { 'aoox.component': 'registry' }),
      c('aoox-buildkit', { 'aoox.component': 'build' }),
      c('aoox-maintenance', { 'aoox.component': 'maintenance' }),
      c('job', { 'aoox.component': 'job', 'aoox.application': 'gone' }),
      c('bk', { 'aoox.component': 'backup' }),
      c('q', { 'aoox.component': 'query', 'aoox.database': 'gone' }),
      c('plain', undefined),
      c('mystifying_panini', {}),
    ];
    expect(names(list)).toEqual([]);
  });

  it('skips containers whose owner cannot be determined or that are swarm tasks', () => {
    expect(
      names([
        c('no-id', { 'aoox.component': 'application' }),
        c('task', {
          'aoox.component': 'application',
          'aoox.application': 'gone',
          'com.docker.swarm.task.id': 't1',
        }),
        c('weird', {
          'com.docker.compose.project': 'aoox-../x',
          'com.docker.compose.project.working_dir': '/aoox_compose_../x/_data',
        }),
      ]),
    ).toEqual([]);
  });

  it('ownerOf is null for non-aoox containers', () => {
    expect(ownerOf({ Labels: {} })).toBeNull();
    expect(ownerOf({})).toBeNull();
  });

  it('keeps state and image for the UI, sorted by name', () => {
    const out = orphanedContainers(
      [
        c(
          'b',
          { 'aoox.component': 'database', 'aoox.database': 'x' },
          'exited',
        ),
        c('a', { 'aoox.component': 'database', 'aoox.database': 'y' }),
      ],
      known,
    );
    expect(out.map((o) => [o.name, o.state, o.kind, o.image])).toEqual([
      ['a', 'running', 'database', 'img:1'],
      ['b', 'exited', 'database', 'img:1'],
    ]);
  });
});
