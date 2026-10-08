import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Domain } from '../application/domain.entity';
import { ServerService } from '../server/server.service';
import { ProxyConfigFile } from './proxy-config.entity';
import {
  ParsedConfig,
  middlewareRefs,
  userFileName,
  validateDynamicConfig,
} from './proxy-config-schema';
import {
  ProxyConfigState,
  ProxyConfigSyncService,
  SyncReport,
} from './proxy-config-sync.service';

export interface ProxyConfigItem {
  id: string;
  name: string;
  /** `user-<name>.yml`, the file in the proxy's dynamic directory. */
  fileName: string;
  serverId: string | null;
  enabled: boolean;
  size: number;
  middlewares: string[];
  routers: string[];
  services: string[];
  /** Domains that reference one of this file's middlewares. */
  usedByDomains: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProxyConfigDetail extends ProxyConfigItem {
  content: string;
}

export interface ProxyConfigWrite {
  file: ProxyConfigDetail;
  sync: SyncReport;
}

const EMPTY: ParsedConfig = { middlewares: [], routers: [], services: [] };

function summarize(content: string): ParsedConfig {
  const r = validateDynamicConfig(content);
  return r.ok ? r.parsed : EMPTY;
}

@Injectable()
export class ProxyConfigService {
  private readonly logger = new Logger(ProxyConfigService.name);

  constructor(
    @InjectRepository(ProxyConfigFile)
    private readonly files: Repository<ProxyConfigFile>,
    @InjectRepository(Domain) private readonly domains: Repository<Domain>,
    private readonly sync: ProxyConfigSyncService,
    private readonly servers: ServerService,
  ) {}

  private scope(serverId: string | null) {
    return { serverId: serverId ?? IsNull() };
  }

  /** Domains (host + app) on that proxy that reference any of `refs`. */
  async usedBy(
    serverId: string | null,
    refs: readonly string[],
  ): Promise<Array<{ host: string; refs: string[] }>> {
    if (refs.length === 0) return [];
    const qb = this.domains
      .createQueryBuilder('d')
      .innerJoin('d.application', 'a')
      .select(['d.host', 'd.middlewares'])
      .where('jsonb_exists_any(d.middlewares, CAST(:refs AS text[]))', {
        refs: [...refs],
      });
    if (serverId) qb.andWhere('a.server_id = :serverId', { serverId });
    else qb.andWhere('a.server_id IS NULL');
    const rows = await qb.getMany();
    return rows.map((d) => ({
      host: d.host,
      refs: d.middlewares.filter((m) => refs.includes(m)),
    }));
  }

  private toItem(
    row: ProxyConfigFile,
    domainRefs: string[][],
  ): ProxyConfigItem {
    const parsed = summarize(row.content);
    const refs = middlewareRefs(parsed.middlewares);
    return {
      id: row.id,
      name: row.name,
      fileName: userFileName(row.name),
      serverId: row.serverId,
      enabled: row.enabled,
      size: Buffer.byteLength(row.content, 'utf8'),
      middlewares: parsed.middlewares,
      routers: parsed.routers,
      services: parsed.services,
      usedByDomains: domainRefs.filter((d) => d.some((r) => refs.includes(r)))
        .length,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Middleware references of every domain on that proxy (one query). */
  private async domainRefs(serverId: string | null): Promise<string[][]> {
    const qb = this.domains
      .createQueryBuilder('d')
      .innerJoin('d.application', 'a')
      .select(['d.id', 'd.middlewares'])
      .where('jsonb_array_length(d.middlewares) > 0');
    if (serverId) qb.andWhere('a.server_id = :serverId', { serverId });
    else qb.andWhere('a.server_id IS NULL');
    return (await qb.getMany()).map((d) => d.middlewares);
  }

  async list(serverId: string | null): Promise<ProxyConfigItem[]> {
    const rows = await this.files.find({
      where: this.scope(serverId),
      order: { name: 'ASC' },
    });
    const used = await this.domainRefs(serverId);
    return rows.map((r) => this.toItem(r, used));
  }

  private async detail(row: ProxyConfigFile): Promise<ProxyConfigDetail> {
    const used = await this.domainRefs(row.serverId);
    return { ...this.toItem(row, used), content: row.content };
  }

  async get(id: string): Promise<ProxyConfigDetail> {
    return this.detail(await this.findOrFail(id));
  }

  private async findOrFail(id: string): Promise<ProxyConfigFile> {
    const row = await this.files.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Config file not found');
    return row;
  }

  /** Middlewares available to put on a domain of an application on that proxy. */
  async availableMiddlewares(
    serverId: string | null,
  ): Promise<Array<{ ref: string; file: string }>> {
    const rows = await this.files.find({
      where: { ...this.scope(serverId), enabled: true },
      order: { name: 'ASC' },
    });
    return rows.flatMap((r) =>
      summarize(r.content).middlewares.map((m) => ({
        ref: `${m}@file`,
        file: r.name,
      })),
    );
  }

  /** Throws 400 naming the first undefined reference. */
  async assertMiddlewaresExist(
    serverId: string | null,
    refs: readonly string[],
  ): Promise<void> {
    if (refs.length === 0) return;
    const available = new Set(
      (await this.availableMiddlewares(serverId)).map((m) => m.ref),
    );
    const missing = refs.find((r) => !available.has(r));
    if (missing) {
      throw new BadRequestException(
        `Middleware "${missing}" does not exist in an enabled config file on this server's proxy`,
      );
    }
  }

  /** 400 when an element name is already declared by another enabled file on that proxy. */
  private async assertNoClash(
    serverId: string | null,
    parsed: ParsedConfig,
    exceptId: string | null,
  ): Promise<void> {
    const others = await this.files.find({
      where: { ...this.scope(serverId), enabled: true },
    });
    for (const other of others) {
      if (other.id === exceptId) continue;
      const p = summarize(other.content);
      for (const section of ['middlewares', 'routers', 'services'] as const) {
        const clash = parsed[section].find((n) => p[section].includes(n));
        if (clash) {
          throw new BadRequestException(
            `The ${section.slice(0, -1)} "${clash}" is already declared in the file "${other.name}"; names must be unique per proxy`,
          );
        }
      }
    }
  }

  private async assertNotInUse(
    row: ProxyConfigFile,
    keepRefs: readonly string[],
  ): Promise<void> {
    const dropped = middlewareRefs(summarize(row.content).middlewares).filter(
      (r) => !keepRefs.includes(r),
    );
    const used = await this.usedBy(row.serverId, dropped);
    if (used.length > 0) {
      const hosts = used.map((u) => u.host);
      throw new ConflictException(
        `${used.length === 1 ? 'The domain' : 'These domains'} ${hosts.join(', ')} ${used.length === 1 ? 'uses' : 'use'} ${dropped.length === 1 ? 'a middleware' : 'middlewares'} from this file (${[...new Set(used.flatMap((u) => u.refs))].join(', ')}); remove ${used.length === 1 ? 'it' : 'them'} from the domain first`,
      );
    }
  }

  private async assertServer(serverId: string | null): Promise<void> {
    if (serverId) await this.servers.findOrFail(serverId);
  }

  private validated(content: string): ParsedConfig {
    const r = validateDynamicConfig(content);
    if (!r.ok) {
      throw new BadRequestException({
        message: r.errors.length === 1 ? r.errors[0] : r.errors,
        error: 'Bad Request',
        statusCode: 400,
      });
    }
    return r.parsed;
  }

  /** What the editor asks before the first write to a proxy. */
  async state(serverId: string | null): Promise<ProxyConfigState> {
    await this.assertServer(serverId);
    try {
      return await this.sync.state(serverId);
    } catch (err) {
      this.logger.warn(`Proxy state read failed: ${String(err)}`);
      throw new BadGatewayException(
        'The proxy could not be reached; check that the server is reachable',
      );
    }
  }

  /**
   * 409 (`code: proxy-restart-required`) when writing would recreate a proxy
   * that cannot load the dynamic directory yet (created by an older aoox):
   * a few seconds without service for every domain on it, so the operator
   * must have agreed (`acceptProxyRestart`). Never asked again afterwards.
   */
  private async assertRestartAccepted(
    serverId: string | null,
    accepted: boolean,
  ): Promise<void> {
    if (accepted) return;
    const s = await this.state(serverId);
    if (s.needsRecreate) {
      throw new ConflictException({
        message:
          'The proxy on this server was created by an older aoox and has to be recreated once to load dynamic configuration: a few seconds without service for every domain on it (certificates and other routes stay). Confirm to continue.',
        error: 'Conflict',
        statusCode: 409,
        code: 'proxy-restart-required',
      });
    }
  }

  async create(
    serverId: string | null,
    name: string,
    content: string,
    enabled: boolean,
    acceptProxyRestart = false,
  ): Promise<ProxyConfigWrite> {
    await this.assertServer(serverId);
    const parsed = this.validated(content);
    if (await this.files.exists({ where: { ...this.scope(serverId), name } })) {
      throw new ConflictException(`A config file named "${name}" exists`);
    }
    if (enabled) {
      await this.assertNoClash(serverId, parsed, null);
      await this.assertRestartAccepted(serverId, acceptProxyRestart);
    }
    const saved = await this.files.save(
      this.files.create({ name, serverId, content, enabled }),
    );
    const sync = await this.apply(saved, enabled, parsed, async () => {
      await this.files.delete(saved.id);
    });
    return { file: await this.detail(saved), sync };
  }

  async update(
    id: string,
    patch: {
      content?: string;
      enabled?: boolean;
      acceptProxyRestart?: boolean;
    },
  ): Promise<ProxyConfigWrite> {
    const row = await this.findOrFail(id);
    const before = { content: row.content, enabled: row.enabled };
    const content = patch.content ?? row.content;
    const enabled = patch.enabled ?? row.enabled;
    const parsed = this.validated(content);
    // Refs that stay defined by an enabled file after this change.
    const keep = enabled ? middlewareRefs(parsed.middlewares) : [];
    await this.assertNotInUse(row, keep);
    if (enabled) {
      await this.assertNoClash(row.serverId, parsed, row.id);
      await this.assertRestartAccepted(
        row.serverId,
        !!patch.acceptProxyRestart,
      );
    }
    row.content = content;
    row.enabled = enabled;
    await this.files.save(row);
    const sync = await this.apply(
      row,
      enabled && (patch.content !== undefined || !before.enabled),
      parsed,
      async () => {
        row.content = before.content;
        row.enabled = before.enabled;
        await this.files.save(row);
      },
    );
    return { file: await this.detail(row), sync };
  }

  async remove(id: string): Promise<SyncReport> {
    const row = await this.findOrFail(id);
    await this.assertNotInUse(row, []);
    await this.files.delete(row.id);
    try {
      return await this.sync.sync(row.serverId);
    } catch (err) {
      this.logger.warn(
        `Sync after deleting ${row.name} failed: ${String(err)}`,
      );
      await this.files.save(row);
      throw new BadGatewayException(
        'The proxy could not be updated, so the file was left in place; try again',
      );
    }
  }

  /** Writes everything again ("apply again"): volume lost, proxy recreated, restore. */
  async resync(
    serverId: string | null,
    acceptProxyRestart = false,
  ): Promise<SyncReport> {
    await this.assertServer(serverId);
    if (
      (await this.files.count({
        where: { ...this.scope(serverId), enabled: true },
      })) > 0
    ) {
      await this.assertRestartAccepted(serverId, acceptProxyRestart);
    }
    try {
      return await this.sync.sync(serverId);
    } catch (err) {
      this.logger.warn(`Proxy config resync failed: ${String(err)}`);
      throw new BadGatewayException(
        'The files could not be written to the proxy; check that the server is reachable',
      );
    }
  }

  /**
   * Syncs after a write and, when Traefik reports an error about the file
   * (only checked for enabled content changes), puts the database and the
   * volume back and answers 400 with Traefik's own words. A daemon that is
   * not reachable reverts too (502): the caller never ends up with a row the
   * proxy does not have.
   */
  private async apply(
    row: ProxyConfigFile,
    verify: boolean,
    parsed: ParsedConfig,
    revert: () => Promise<void>,
  ): Promise<SyncReport> {
    let report: SyncReport;
    try {
      report = await this.sync.sync(
        row.serverId,
        verify ? { name: row.name, refs: this.refsOf(parsed) } : undefined,
      );
    } catch (err) {
      this.logger.warn(`Proxy config sync failed: ${String(err)}`);
      await revert();
      await this.sync.sync(row.serverId).catch(() => undefined);
      throw new BadGatewayException(
        'The file could not be written to the proxy, so nothing was changed; check that the server is reachable and try again',
      );
    }
    if (report.errors.length > 0) {
      await revert();
      await this.sync.sync(row.serverId).catch(() => undefined);
      throw new BadRequestException({
        message: `Traefik rejected the file and the previous version was restored: ${report.errors[0]}`,
        error: 'Bad Request',
        statusCode: 400,
        traefikErrors: report.errors,
      });
    }
    return report;
  }

  private refsOf(parsed: ParsedConfig): string[] {
    return [
      ...middlewareRefs(parsed.middlewares),
      ...parsed.routers.map((n) => `${n}@file`),
      ...parsed.services.map((n) => `${n}@file`),
    ];
  }
}
