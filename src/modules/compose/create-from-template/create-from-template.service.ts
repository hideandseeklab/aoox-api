import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ProjectService } from '../../project/project.service';
import {
  renderEnv,
  TEMPLATE_COMPOSE_PATH,
  TemplateService,
  TemplateVariableError,
} from '../../template/template.service';
import { ComposeApp } from '../compose-app.entity';
import { ComposeRunnerService } from '../compose-runner.service';
import { ComposeService } from '../compose.service';
import { CreateFromTemplateDto } from './create-from-template.dto';

/**
 * One-click stack: copies the template's compose file into a new `template`
 * compose app, fills its env (generated secrets included) and deploys it
 * right away. Afterwards it is edited like any compose app.
 */
@Injectable()
export class CreateFromTemplateService {
  constructor(
    private readonly compose: ComposeService,
    private readonly projects: ProjectService,
    private readonly templates: TemplateService,
    private readonly runner: ComposeRunnerService,
  ) {}

  async execute(
    ownerId: string,
    dto: CreateFromTemplateDto,
  ): Promise<ComposeApp> {
    const project = await this.projects.findOwnedOrFail(dto.projectId, ownerId);
    const template = this.templates.findOrFail(dto.templateId);
    const exposable = new Set(
      template.services.map((s) => `${s.service}:${s.port}`),
    );
    for (const d of [
      ...(dto.serviceDomains ?? []),
      ...(dto.servicePorts ?? []),
    ]) {
      if (!exposable.has(`${d.service}:${d.port}`)) {
        throw new BadRequestException(
          `${d.service}:${d.port} is not exposed by this template`,
        );
      }
    }
    let env: string;
    try {
      env = renderEnv(template, sanitize(dto.variables ?? {}));
    } catch (err) {
      if (err instanceof TemplateVariableError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    const name = dto.name?.trim() || template.name;
    const draft = this.compose.repo.create({
      projectId: project.id,
      project,
      name,
      slug: ComposeService.slugify(name),
      source: 'template',
      templateId: template.id,
      composeContent: template.compose,
      webhookToken: randomBytes(24).toString('base64url'),
      composePath: TEMPLATE_COMPOSE_PATH,
      gitUrl: null,
      gitBranch: 'main',
      gitCredentialId: null,
      env,
      serviceDomains: (dto.serviceDomains ?? []).map((d) => ({
        service: d.service,
        port: d.port,
        host: d.host.trim().toLowerCase(),
        https: d.https,
      })),
      servicePorts: (dto.servicePorts ?? []).map((p) => ({
        service: p.service,
        port: p.port,
        hostPort: p.hostPort,
      })),
      status: 'idle',
    });
    await this.compose.assertHostPortsFree(draft);
    const app = await this.compose.repo.save(draft);
    this.runner.start(app, 'deploy');
    return { ...app, status: 'deploying' };
  }
}

/** The DTO is a free-form record: keep only string values under sane keys. */
function sanitize(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (
      /^[A-Z0-9_]{1,64}$/.test(k) &&
      typeof v === 'string' &&
      v.length <= 2000
    ) {
      out[k] = v;
    }
  }
  return out;
}
