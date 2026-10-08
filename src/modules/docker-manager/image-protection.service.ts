import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Application } from '../application/application.entity';
import { Deployment } from '../application/deployment.entity';
import { PreviewDeployment } from '../application/preview-deployment.entity';
import { Registry } from '../registry/registry.entity';
import {
  normalizeRegistryHost,
  protectionReason,
  type ImageLike,
  type ProtectionSources,
  type RefKind,
} from './image-protection';

/**
 * Loads what the DB still needs from a daemon's images (three small queries per
 * list/remove, never per image) and answers `reasonFor(image)`. For a remote
 * server only the apps deployed there count; the registry rule is host-only.
 */
@Injectable()
export class ImageProtectionService {
  constructor(
    @InjectRepository(Application)
    private readonly apps: Repository<Application>,
    @InjectRepository(Deployment)
    private readonly deployments: Repository<Deployment>,
    @InjectRepository(PreviewDeployment)
    private readonly previews: Repository<PreviewDeployment>,
    @InjectRepository(Registry)
    private readonly registries: Repository<Registry>,
    private readonly config: ConfigService,
  ) {}

  async load(
    serverId: string | null,
  ): Promise<{ reasonFor: (image: ImageLike) => string | null }> {
    const scope = serverId ? { serverId } : { serverId: IsNull() };
    const serverClause = serverId
      ? 'a.server_id = :serverId'
      : 'a.server_id IS NULL';

    const [apps, deployments, previews, registryRows] = await Promise.all([
      this.apps.find({ select: { currentImage: true }, where: scope }),
      this.deployments
        .createQueryBuilder('d')
        .innerJoin(Application, 'a', 'a.id = d.application_id')
        .select('DISTINCT d.image_ref', 'ref')
        .where('d.image_ref IS NOT NULL')
        .andWhere(serverClause, { serverId })
        .getRawMany<{ ref: string }>(),
      this.previews
        .createQueryBuilder('p')
        .innerJoin(Application, 'a', 'a.id = p.application_id')
        .select('DISTINCT p.image_ref', 'ref')
        .where('p.image_ref IS NOT NULL')
        .andWhere("p.status IN ('building', 'running')")
        .andWhere(serverClause, { serverId })
        .getRawMany<{ ref: string }>(),
      serverId
        ? Promise.resolve([] as Registry[])
        : this.registries.find({
            where: { type: 'self-hosted' },
            select: { url: true, domain: true },
          }),
    ]);

    const refs: ProtectionSources['refs'] = [];
    const add = (ref: string | null | undefined, kind: RefKind) => {
      if (ref) refs.push({ ref, kind });
    };
    for (const a of apps) add(a.currentImage, 'application');
    for (const d of deployments) add(d.ref, 'deployment');
    for (const p of previews) add(p.ref, 'preview');

    const registryHosts = new Set<string>();
    if (!serverId) {
      const host =
        this.config.get<string>('REGISTRY_PUBLIC_HOST') ?? 'localhost';
      const port = Number(this.config.get<string>('REGISTRY_PORT') ?? 5000);
      registryHosts.add(normalizeRegistryHost(`${host}:${port}`));
      for (const r of registryRows) {
        if (r.url) registryHosts.add(normalizeRegistryHost(r.url));
        if (r.domain) registryHosts.add(normalizeRegistryHost(r.domain));
      }
    }

    const sources: ProtectionSources = { registryHosts, refs };
    return {
      reasonFor: (image) => protectionReason(image, sources, !serverId),
    };
  }
}
