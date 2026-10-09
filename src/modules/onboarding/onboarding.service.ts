import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Application } from '../application/application.entity';
import { ComposeApp } from '../compose/compose-app.entity';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import { PanelDomainSettings } from '../panel-domain/panel-domain-settings.entity';
import { Project } from '../project/project.entity';
import { ProxyService } from '../proxy/proxy.service';
import { Registry } from '../registry/registry.entity';
import {
  OnboardingDto,
  onboardingView,
  type OnboardingFacts,
} from './onboarding-steps';

/** The proxy check is a Docker call; the dashboard may be opened often. */
const PROXY_CACHE_MS = 30_000;

const NOTHING: OnboardingFacts = {
  localRegistry: false,
  proxyRunning: false,
  panelDomain: false,
  projects: 0,
  runningResource: false,
};

@Injectable()
export class OnboardingService {
  private proxyCache: { at: number; running: boolean } | null = null;

  constructor(
    @InjectRepository(Registry)
    private readonly registries: Repository<Registry>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(Application)
    private readonly applications: Repository<Application>,
    @InjectRepository(ManagedDatabase)
    private readonly databases: Repository<ManagedDatabase>,
    @InjectRepository(ComposeApp)
    private readonly composeApps: Repository<ComposeApp>,
    @InjectRepository(PanelDomainSettings)
    private readonly panelDomain: Repository<PanelDomainSettings>,
    private readonly proxy: ProxyService,
  ) {}

  /**
   * A non-owner, or an owner who hid the checklist, costs one cheap query and
   * nothing else. Otherwise: a handful of indexed existence checks plus the
   * (cached) proxy lookup.
   */
  async view(userId: string, role: string): Promise<OnboardingDto> {
    if (role !== 'owner') return onboardingView(role, false, NOTHING);
    if (await this.dismissed(userId)) {
      return onboardingView(role, true, NOTHING);
    }

    const [localRegistry, projects, panelDomain, app, db, stack, proxyRunning] =
      await Promise.all([
        this.registries.exists({ where: { type: 'self-hosted' } }),
        this.projects.count({ take: 1 }),
        this.panelDomain.findOne({ where: {} }).then((r) => !!r?.webHost),
        this.applications.exists({ where: { status: 'running' } }),
        this.databases.exists({ where: { status: 'running' } }),
        this.composeApps.exists({ where: { status: 'running' } }),
        this.proxyRunning(),
      ]);
    return onboardingView(role, false, {
      localRegistry,
      proxyRunning,
      panelDomain,
      projects,
      runningResource: app || db || stack,
    });
  }

  async dismiss(userId: string): Promise<void> {
    await this.registries.query(
      `UPDATE users SET onboarding_dismissed_at = now() WHERE id = $1`,
      [userId],
    );
  }

  private async dismissed(userId: string): Promise<boolean> {
    const rows = await this.registries.query<
      { onboarding_dismissed_at: Date | null }[]
    >(`SELECT onboarding_dismissed_at FROM users WHERE id = $1`, [userId]);
    return rows[0]?.onboarding_dismissed_at != null;
  }

  private async proxyRunning(now = Date.now()): Promise<boolean> {
    if (this.proxyCache && now - this.proxyCache.at < PROXY_CACHE_MS) {
      return this.proxyCache.running;
    }
    let running = false;
    try {
      running = (await this.proxy.status()).running;
    } catch {
      // Docker unreachable: the step simply stays open.
    }
    this.proxyCache = { at: now, running };
    return running;
  }
}
