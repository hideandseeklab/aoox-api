/** What the checklist looks at, gathered cheaply by the service. */
export interface OnboardingFacts {
  localRegistry: boolean;
  proxyRunning: boolean;
  panelDomain: boolean;
  projects: number;
  /** An application, database or stack that is `running`. */
  runningResource: boolean;
}

export interface OnboardingStepDto {
  id: 'registry' | 'proxy' | 'panelDomain' | 'project' | 'workload';
  title: string;
  hint: string;
  done: boolean;
  /** Optional steps never keep the checklist on screen. */
  optional: boolean;
  /** Page where the step is done, inside the web app. */
  href: string;
}

export class OnboardingDto {
  /** Show the checklist: owner, not dismissed, and a required step is open. */
  visible: boolean;
  dismissed: boolean;
  steps: OnboardingStepDto[];
}

/** The steps and which are done, from facts. Pure. */
export function onboardingSteps(f: OnboardingFacts): OnboardingStepDto[] {
  return [
    {
      id: 'registry',
      title: 'Set up the local registry',
      hint: 'Where build images are stored; needed to deploy from Git.',
      done: f.localRegistry,
      optional: false,
      href: '/registry',
    },
    {
      id: 'proxy',
      title: 'Start the reverse proxy',
      hint: 'Traefik for application domains and HTTPS.',
      done: f.proxyRunning,
      optional: false,
      href: '/infra/proxy',
    },
    {
      id: 'panelDomain',
      title: 'Set the panel domain (optional)',
      hint: 'Open aoox on your own domain with HTTPS.',
      done: f.panelDomain,
      optional: true,
      href: '/infra/domain',
    },
    {
      id: 'project',
      title: 'Create your first project',
      hint: 'Applications, databases and stacks live inside a project.',
      done: f.projects > 0,
      optional: false,
      href: '/projects',
    },
    {
      id: 'workload',
      title: 'Run your first application, database or stack',
      hint: 'Deploy something and make sure it is running.',
      done: f.runningResource,
      optional: false,
      href: '/projects',
    },
  ];
}

/**
 * Only the owner sees the checklist (registry, proxy and the panel domain are
 * owner-only to set up, so for an admin it would be a list of things they
 * cannot do). It goes away once every required step is done, or when the user
 * hides it.
 */
export function onboardingView(
  role: string,
  dismissed: boolean,
  facts: OnboardingFacts,
): OnboardingDto {
  const steps = onboardingSteps(facts);
  const open = steps.some((s) => !s.optional && !s.done);
  return {
    visible: role === 'owner' && !dismissed && open,
    dismissed,
    steps,
  };
}
