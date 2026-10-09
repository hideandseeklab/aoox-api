import {
  onboardingSteps,
  onboardingView,
  type OnboardingFacts,
} from './onboarding-steps';
import { OnboardingService } from './onboarding.service';

const fresh: OnboardingFacts = {
  localRegistry: false,
  proxyRunning: false,
  panelDomain: false,
  projects: 0,
  runningResource: false,
};

describe('onboardingSteps', () => {
  it('starts with every step open, in order, each linking to the right page', () => {
    const steps = onboardingSteps(fresh);
    expect(steps.map((s) => [s.id, s.done, s.optional, s.href])).toEqual([
      ['registry', false, false, '/registry'],
      ['proxy', false, false, '/infra/proxy'],
      ['panelDomain', false, true, '/infra/domain'],
      ['project', false, false, '/projects'],
      ['workload', false, false, '/projects'],
    ]);
  });

  it('marks steps done from real state', () => {
    const steps = Object.fromEntries(
      onboardingSteps({ ...fresh, localRegistry: true, projects: 2 }).map(
        (s) => [s.id, s.done],
      ),
    );
    expect(steps).toEqual({
      registry: true,
      proxy: false,
      panelDomain: false,
      project: true,
      workload: false,
    });
  });
});

describe('onboardingView', () => {
  const allRequired: OnboardingFacts = {
    localRegistry: true,
    proxyRunning: true,
    panelDomain: false, // optional
    projects: 1,
    runningResource: true,
  };

  it('shows for an owner while a required step is open', () => {
    expect(onboardingView('owner', false, fresh).visible).toBe(true);
    expect(
      onboardingView('owner', false, { ...allRequired, runningResource: false })
        .visible,
    ).toBe(true);
  });

  it('goes away on its own once every required step is done, the optional one does not count', () => {
    const v = onboardingView('owner', false, allRequired);
    expect(v.visible).toBe(false);
    expect(v.steps.find((s) => s.id === 'panelDomain')?.done).toBe(false);
  });

  it('is hidden for admins and members even with open steps', () => {
    expect(onboardingView('admin', false, fresh).visible).toBe(false);
    expect(onboardingView('member', false, fresh).visible).toBe(false);
  });

  it('stays hidden once dismissed, reporting it', () => {
    const v = onboardingView('owner', true, fresh);
    expect(v.visible).toBe(false);
    expect(v.dismissed).toBe(true);
  });
});

describe('OnboardingService', () => {
  function setup(opts: {
    dismissed?: boolean;
    registry?: boolean;
    projects?: number;
    panel?: string | null;
    app?: boolean;
    db?: boolean;
    stack?: boolean;
    proxy?: Promise<{ running: boolean }>;
  }) {
    const query = jest.fn((sql: string) =>
      sql.startsWith('SELECT')
        ? Promise.resolve([
            { onboarding_dismissed_at: opts.dismissed ? new Date() : null },
          ])
        : Promise.resolve(undefined),
    );
    const registries = {
      exists: jest.fn().mockResolvedValue(opts.registry ?? false),
      query,
    };
    const projects = { count: jest.fn().mockResolvedValue(opts.projects ?? 0) };
    const applications = {
      exists: jest.fn().mockResolvedValue(opts.app ?? false),
    };
    const databases = { exists: jest.fn().mockResolvedValue(opts.db ?? false) };
    const composeApps = {
      exists: jest.fn().mockResolvedValue(opts.stack ?? false),
    };
    const panelDomain = {
      findOne: jest
        .fn()
        .mockResolvedValue(opts.panel ? { webHost: opts.panel } : null),
    };
    const proxy = {
      status: jest.fn(() => opts.proxy ?? Promise.resolve({ running: false })),
    };
    const svc = new OnboardingService(
      registries as never,
      projects as never,
      applications as never,
      databases as never,
      composeApps as never,
      panelDomain as never,
      proxy as never,
    );
    return {
      svc,
      query,
      registries,
      projects,
      applications,
      databases,
      composeApps,
      panelDomain,
      proxy,
    };
  }

  it('an empty install: every required step open, visible for the owner', async () => {
    const h = setup({});
    const v = await h.svc.view('u1', 'owner');
    expect(v.visible).toBe(true);
    expect(v.steps.filter((s) => s.done)).toHaveLength(0);
  });

  it('follows what is actually there: registry, proxy, domain, project and a running resource', async () => {
    const h = setup({
      registry: true,
      projects: 1,
      panel: 'panel.example.com',
      db: true,
      proxy: Promise.resolve({ running: true }),
    });
    const v = await h.svc.view('u1', 'owner');
    expect(v.steps.map((s) => s.done)).toEqual([true, true, true, true, true]);
    expect(v.visible).toBe(false);
  });

  it('any running application, database or stack counts as the first running resource', async () => {
    for (const kind of ['app', 'db', 'stack'] as const) {
      const v = await setup({ [kind]: true }).svc.view('u1', 'owner');
      expect(v.steps.find((s) => s.id === 'workload')?.done).toBe(true);
    }
  });

  it('members and admins cost nothing: no query at all', async () => {
    const h = setup({});
    for (const role of ['member', 'admin']) {
      expect((await h.svc.view('u1', role)).visible).toBe(false);
    }
    expect(h.query).not.toHaveBeenCalled();
    expect(h.registries.exists).not.toHaveBeenCalled();
    expect(h.proxy.status).not.toHaveBeenCalled();
  });

  it('a dismissed checklist stops after one query and never calls Docker', async () => {
    const h = setup({ dismissed: true });
    const v = await h.svc.view('u1', 'owner');
    expect(v).toMatchObject({ visible: false, dismissed: true });
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(h.proxy.status).not.toHaveBeenCalled();
    expect(h.registries.exists).not.toHaveBeenCalled();
  });

  it('asks Docker about the proxy at most once per 30 seconds', async () => {
    const h = setup({ proxy: Promise.resolve({ running: true }) });
    await h.svc.view('u1', 'owner');
    await h.svc.view('u1', 'owner');
    expect(h.proxy.status).toHaveBeenCalledTimes(1);
  });

  it('an unreachable Docker leaves the proxy step open instead of failing the dashboard', async () => {
    const h = setup({ proxy: Promise.reject(new Error('socket')) });
    const v = await h.svc.view('u1', 'owner');
    expect(v.steps.find((s) => s.id === 'proxy')?.done).toBe(false);
  });

  it('dismiss persists per user', async () => {
    const h = setup({});
    await h.svc.dismiss('u7');
    expect(h.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /SET onboarding_dismissed_at = now\(\) WHERE id = \$1/,
      ),
      ['u7'],
    );
  });
});
