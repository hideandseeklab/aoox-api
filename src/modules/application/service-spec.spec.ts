import {
  mountFromBind,
  serviceSpecFor,
  ServiceSpecInput,
} from './service-spec';

const base: ServiceSpecInput = {
  name: 'aoox-app-web-abc123',
  image: 'localhost:5000/p/web:1',
  env: ['A=1'],
  serviceLabels: { 'traefik.enable': 'true' },
  containerLabels: { 'aoox.component': 'application' },
  binds: ['aoox_app_web_uploads:/uploads', '/srv/x:/x:ro'],
  limits: { NanoCpus: 500_000_000, Memory: 0, MemorySwap: 0 },
  replicas: 2,
  containerPort: 3000,
  hostPort: null,
  network: 'aoox-swarm',
  logConfig: {
    Type: 'json-file',
    Config: { 'max-size': '10m', 'max-file': '3' },
  },
};

describe('mountFromBind', () => {
  it('maps volumes and read-only binds', () => {
    expect(mountFromBind('vol:/data')).toEqual({
      Type: 'volume',
      Source: 'vol',
      Target: '/data',
    });
    expect(mountFromBind('/srv/x:/x:ro')).toEqual({
      Type: 'bind',
      Source: '/srv/x',
      Target: '/x',
      ReadOnly: true,
    });
  });
});

describe('serviceSpecFor', () => {
  it('splits labels between service and task containers and rolls start-first without a host port', () => {
    const spec = serviceSpecFor(base);
    expect(spec.Labels).toEqual({
      'aoox.component': 'application',
      'traefik.enable': 'true',
    });
    expect(spec.TaskTemplate.ContainerSpec.Labels).toEqual({
      'aoox.component': 'application',
    });
    expect(spec.UpdateConfig?.Order).toBe('start-first');
    expect(spec.UpdateConfig?.FailureAction).toBe('rollback');
    expect(spec.Mode).toEqual({ Replicated: { Replicas: 2 } });
    expect(spec.TaskTemplate.Resources?.Limits).toEqual({
      NanoCPUs: 500_000_000,
    });
    expect(spec.TaskTemplate.Networks).toEqual([{ Target: 'aoox-swarm' }]);
    expect(spec.TaskTemplate.LogDriver).toEqual({
      Name: 'json-file',
      Options: { 'max-size': '10m', 'max-file': '3' },
    });
    expect(spec.EndpointSpec?.Ports).toEqual([]);
    expect(spec.TaskTemplate.ContainerSpec.Mounts).toHaveLength(2);
  });

  it('publishes a host port in host mode and updates stop-first', () => {
    const spec = serviceSpecFor({
      ...base,
      hostPort: 8080,
      healthcheck: undefined,
    });
    expect(spec.EndpointSpec?.Ports).toEqual([
      {
        Protocol: 'tcp',
        TargetPort: 3000,
        PublishedPort: 8080,
        PublishMode: 'host',
      },
    ]);
    expect(spec.UpdateConfig?.Order).toBe('stop-first');
  });

  it('never sends negative replicas and omits empty limits', () => {
    const spec = serviceSpecFor({
      ...base,
      replicas: -1,
      limits: { NanoCpus: 0, Memory: 0, MemorySwap: 0 },
    });
    expect(spec.Mode?.Replicated?.Replicas).toBe(0);
    expect(spec.TaskTemplate.Resources?.Limits).toEqual({});
  });
});

describe('serviceSpecFor rolling-update tunables', () => {
  it('honours parallelism/delay/order and never start-first with a host port', () => {
    const spec = serviceSpecFor({
      ...base,
      update: { parallelism: 3, delaySeconds: 10, order: 'stop-first' },
    });
    expect(spec.UpdateConfig).toMatchObject({
      Parallelism: 3,
      Delay: 10_000_000_000,
      Order: 'stop-first',
    });
    const forced = serviceSpecFor({
      ...base,
      hostPort: 8080,
      update: { order: 'start-first' },
    });
    expect(forced.UpdateConfig?.Order).toBe('stop-first');
    expect(
      serviceSpecFor({ ...base, constraints: ['node.labels.zone==eu'] })
        .TaskTemplate.Placement,
    ).toEqual({ Constraints: ['node.labels.zone==eu'] });
  });
});
