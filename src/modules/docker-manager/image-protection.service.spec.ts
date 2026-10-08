import { ImageProtectionService } from './image-protection.service';

function qb(rows: { ref: string }[]) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['innerJoin', 'select', 'where', 'andWhere']) {
    chain[m] = jest.fn(() => chain);
  }
  chain.getRawMany = jest.fn().mockResolvedValue(rows);
  return chain;
}

function setup(over: { env?: Record<string, string> } = {}) {
  const apps = {
    find: jest
      .fn()
      .mockResolvedValue([
        { currentImage: 'myorg/blog-web:cur1' },
        { currentImage: null },
      ]),
  };
  const deployQb = qb([{ ref: 'myorg/blog-web:old2' }]);
  const previewQb = qb([{ ref: 'myorg/blog-web:pr7' }]);
  const registries = {
    find: jest
      .fn()
      .mockResolvedValue([
        { url: 'https://registry.example.com', domain: 'registry.example.com' },
      ]),
  };
  const svc = new ImageProtectionService(
    apps as never,
    { createQueryBuilder: () => deployQb } as never,
    { createQueryBuilder: () => previewQb } as never,
    registries as never,
    { get: (k: string) => over.env?.[k] } as never,
  );
  return { svc, apps, deployQb, previewQb, registries };
}

const img = (tag: string) => ({
  Id: 'sha256:' + 'c'.repeat(64),
  RepoTags: [tag],
});

describe('ImageProtectionService', () => {
  it('protects what apps, kept deployments and open previews reference, on the host', async () => {
    const { svc, previewQb } = setup();
    const { reasonFor } = await svc.load(null);
    expect(reasonFor(img('myorg/blog-web:cur1'))).toMatch(
      /application is running/,
    );
    expect(reasonFor(img('myorg/blog-web:old2'))).toMatch(/rollback/);
    expect(reasonFor(img('myorg/blog-web:pr7'))).toMatch(/preview/);
    // Only building/running previews count.
    expect(previewQb.andWhere).toHaveBeenCalledWith(
      "p.status IN ('building', 'running')",
    );
  });

  it("also treats anything under the registry host or domain as the registry's own", async () => {
    const { svc } = setup({
      env: { REGISTRY_PUBLIC_HOST: 'panel.example.net', REGISTRY_PORT: '5050' },
    });
    const { reasonFor } = await svc.load(null);
    expect(reasonFor(img('localhost:5000/never/seen:1'))).toBeNull(); // not this install's host:port
    expect(reasonFor(img('panel.example.net:5050/x/y:1'))).toMatch(
      /local registry/,
    );
    expect(reasonFor(img('registry.example.com/x/y:1'))).toMatch(
      /local registry/,
    );
  });

  it('defaults to localhost:5000', async () => {
    const { svc } = setup();
    expect(
      (await svc.load(null)).reasonFor(img('localhost:5000/x/y:1')),
    ).toMatch(/local registry/);
  });

  it('scopes to the chosen server: its apps only, no registry rule', async () => {
    const { svc, apps, deployQb, registries } = setup();
    const { reasonFor } = await svc.load('srv-1');
    expect(apps.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { serverId: 'srv-1' } }),
    );
    expect(deployQb.andWhere).toHaveBeenCalledWith('a.server_id = :serverId', {
      serverId: 'srv-1',
    });
    expect(registries.find).not.toHaveBeenCalled();
    expect(reasonFor(img('localhost:5000/other/thing:1'))).toBeNull();
    // Still protected when the server's own rows reference it.
    expect(reasonFor(img('myorg/blog-web:cur1'))).toMatch(
      /application is running/,
    );
  });

  it('uses a NULL server filter for the host', async () => {
    const { svc, deployQb } = setup();
    await svc.load(null);
    expect(deployQb.andWhere).toHaveBeenCalledWith('a.server_id IS NULL', {
      serverId: null,
    });
  });
});
