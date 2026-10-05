import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { Domain } from '../application/domain.entity';
import { tarFiles } from '../application/nixpacks-builder.service';
import { composeLabels, DockerService } from '../docker/docker.service';
import { decryptSecret } from '../docker/secret.util';
import { HostPortService } from '../host-port/host-port.service';
import { ENGINES } from '../managed-database/engines';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import {
  containerNameForDb,
  ManagedDatabaseService,
} from '../managed-database/managed-database.service';
import { ProjectAccessService } from '../project/project-access.service';
import { APP_NETWORK, ProxyService } from '../proxy/proxy.service';
import { companionContainerName } from './companion-names';
import {
  CompanionCredentialsDto,
  CompanionDto,
  CompanionOptionsDto,
  CreateCompanionDto,
} from './companion.dto';
import {
  CompanionContext,
  companionImageRef,
  CompanionTool,
  getCompanionTool,
  toolsForEngine,
} from './companion-tools';
import { DatabaseCompanion } from './database-companion.entity';

/**
 * Labels stamped on every companion container. Deliberately NOT
 * `aoox.database` / `aoox.application`: MetricRetentionService attributes
 * containers to those owners and would add the admin UI's CPU/RAM to the
 * database's own history, and container-down-notifier only reports
 * application/database components (a crashed admin UI is silent).
 * `aoox.project` keeps it in the project's resource-usage card, which is
 * where its (small) cost belongs.
 */
export function companionLabels(
  db: Pick<ManagedDatabase, 'id' | 'slug' | 'projectId'>,
): Record<string, string> {
  return {
    'aoox.component': 'companion',
    'aoox.companion': db.id,
    'aoox.project': db.projectId,
    ...composeLabels(`dbadmin-${db.slug}`),
  };
}

@Injectable()
export class DatabaseCompanionService {
  private readonly logger = new Logger(DatabaseCompanionService.name);
  private readonly key: string;

  constructor(
    @InjectRepository(DatabaseCompanion)
    readonly repo: Repository<DatabaseCompanion>,
    @InjectRepository(Domain)
    private readonly domains: Repository<Domain>,
    private readonly databases: ManagedDatabaseService,
    private readonly docker: DockerService,
    private readonly proxy: ProxyService,
    private readonly hostPorts: HostPortService,
    private readonly access: ProjectAccessService,
    private readonly config: ConfigService,
  ) {
    this.key = config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  options(db: ManagedDatabase): CompanionOptionsDto {
    return {
      tools: toolsForEngine(db.engine).map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        usesDatabaseLogin: t.usesDatabaseLogin,
      })),
    };
  }

  /** The companion of a database (status reconciled with the container), or null. */
  async get(db: ManagedDatabase): Promise<CompanionDto | null> {
    const row = await this.repo.findOne({ where: { databaseId: db.id } });
    if (!row) return null;
    await this.reconcile(row, db);
    return this.toDto(row, db);
  }

  async create(
    db: ManagedDatabase,
    dto: CreateCompanionDto,
  ): Promise<CompanionDto> {
    const tool = getCompanionTool(dto.tool);
    if (!tool || !tool.engines.includes(db.engine)) {
      throw new BadRequestException(
        `${dto.tool} does not support ${db.engine} databases`,
      );
    }
    const host = dto.host?.trim().toLowerCase() || null;
    const hostPort = dto.hostPort ?? null;
    if (!host && !hostPort) {
      throw new BadRequestException(
        'Provide a domain (host) or a host port to reach the admin UI',
      );
    }
    if (db.status !== 'running') {
      throw new ConflictException('The database must be running');
    }
    if (await this.repo.exists({ where: { databaseId: db.id } })) {
      throw new ConflictException('This database already has an admin app');
    }
    if (host) {
      const taken =
        (await this.domains.exists({ where: { host } })) ||
        (await this.repo.exists({ where: { host } }));
      if (taken) throw new ConflictException(`${host} is already in use`);
    }
    if (hostPort) await this.hostPorts.assertFree([hostPort], this.docker);

    // A domain is useless without something listening on 80/443: same rule as
    // add-domain. Done before the row exists, so a failure leaves nothing behind.
    if (host) {
      const status = await this.proxy.status();
      if (!status.running) await this.proxy.provision();
    }

    const adminPassword = tool.usesDatabaseLogin
      ? null
      : randomBytes(18)
          .toString('base64')
          .replace(/[^a-zA-Z0-9]/g, '')
          .slice(0, 24);
    const row = await this.repo
      .save(
        this.repo.create({
          databaseId: db.id,
          tool: tool.id,
          status: 'creating',
          host,
          https: host ? (dto.https ?? false) : false,
          hostPort,
          passwordEncrypted: adminPassword
            ? this.databases.encrypt(adminPassword)
            : null,
        }),
      )
      .catch((err: unknown) => {
        // Lost a race with a parallel request (unique database/host).
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException('Admin app or domain already exists');
        }
        throw err;
      });

    this.provisionInBackground(row, db, tool, adminPassword);
    return this.toDto(row, db);
  }

  async credentials(
    userId: string,
    db: ManagedDatabase,
  ): Promise<CompanionCredentialsDto> {
    // Same project role gate as the rest of the project, but viewers must not read secrets.
    const role = await this.access.roleFor(userId, db.project);
    if (role === 'viewer') {
      throw new ForbiddenException('Viewers cannot read admin app credentials');
    }
    const row = await this.repo
      .createQueryBuilder('c')
      .addSelect('c.passwordEncrypted')
      .where('c.databaseId = :id', { id: db.id })
      .getOne();
    if (!row) throw new NotFoundException('No admin app for this database');
    const tool = getCompanionTool(row.tool);
    return {
      username: tool?.username ?? null,
      password: row.passwordEncrypted
        ? decryptSecret(row.passwordEncrypted, this.key)
        : null,
    };
  }

  async remove(db: ManagedDatabase): Promise<void> {
    const row = await this.repo.findOne({ where: { databaseId: db.id } });
    if (!row) throw new NotFoundException('No admin app for this database');
    const c = await this.docker.findContainerByName(
      companionContainerName(db.slug),
    );
    if (c) await this.docker.engine.removeContainer(c.Id, true);
    await this.repo.delete(row.id);
  }

  /** Pulls the image, writes preloaded files and starts the container. */
  async provision(
    row: DatabaseCompanion,
    db: ManagedDatabase,
    tool: CompanionTool,
    adminPassword: string | null,
  ): Promise<void> {
    const image = companionImageRef(tool);
    const name = companionContainerName(db.slug);
    const port = `${tool.port}/tcp`;
    const build = tool.build(await this.contextFor(db, adminPassword));

    await this.docker.ensureImage(image);
    await this.docker.ensureNetwork(APP_NETWORK);
    const existing = await this.docker.findContainerByName(name);
    if (existing) await this.docker.engine.removeContainer(existing.Id, true);

    const domains = row.host ? [{ host: row.host, https: row.https }] : [];
    const id = await this.docker.engine.createContainer(
      {
        Image: image,
        Env: build.env,
        Cmd: build.cmd,
        // No DB secret here: labels are visible to every container listing.
        Labels: {
          ...companionLabels(db),
          ...this.proxy.labelsFor(`dbadmin-${db.slug}`, tool.port, domains),
        },
        ExposedPorts: { [port]: {} },
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          LogConfig: this.docker.logConfig,
          NetworkMode: APP_NETWORK,
          PortBindings: row.hostPort
            ? { [port]: [{ HostPort: String(row.hostPort) }] }
            : {},
        },
      },
      name,
    );
    for (const f of build.files) {
      await this.docker.engine.putArchive(
        id,
        f.dir,
        tarFiles([[f.name, f.content]]),
      );
    }
    await this.docker.engine.startContainer(id);
    this.logger.log(`Admin app ${name} (${image}) started`);
  }

  /** Detached (the image pull can be slow); always ends `running` or `error`. */
  provisionInBackground(
    row: DatabaseCompanion,
    db: ManagedDatabase,
    tool: CompanionTool,
    adminPassword: string | null,
  ): void {
    void this.provision(row, db, tool, adminPassword)
      .then(() =>
        this.repo.update(row.id, { status: 'running', errorMessage: null }),
      )
      .catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Admin app for ${db.slug} failed: ${message}`);
        await this.repo
          .update(row.id, { status: 'error', errorMessage: message })
          .catch(() => undefined);
      });
  }

  private async contextFor(
    db: ManagedDatabase,
    adminPassword: string | null,
  ): Promise<CompanionContext> {
    return {
      engine: db.engine,
      host: containerNameForDb(db),
      port: ENGINES[db.engine].port,
      username: db.username,
      password: await this.databases.password(db),
      database: db.databaseName,
      adminPassword,
    };
  }

  /**
   * Keeps `status` honest without a watcher: a settled row is checked against
   * the container when read. A stopped database does not change this (the
   * admin UI keeps running and simply cannot connect until the database is
   * started again).
   */
  private async reconcile(
    row: DatabaseCompanion,
    db: ManagedDatabase,
  ): Promise<void> {
    if (row.status === 'creating') return;
    let container: Awaited<ReturnType<DockerService['findContainerByName']>>;
    try {
      container = await this.docker.findContainerByName(
        companionContainerName(db.slug),
      );
    } catch {
      return; // daemon unreachable: keep what we know
    }
    let status = row.status;
    let errorMessage = row.errorMessage;
    if (!container) {
      // A failed provisioning has no container either; keep its real message.
      if (row.status === 'error') return;
      status = 'error';
      errorMessage = 'The admin app container no longer exists';
    } else if (container.State === 'running') {
      status = 'running';
      errorMessage = null;
    } else {
      status = 'stopped';
      errorMessage = null;
    }
    if (status !== row.status || errorMessage !== row.errorMessage) {
      row.status = status;
      row.errorMessage = errorMessage;
      await this.repo.update(row.id, { status, errorMessage });
    }
  }

  private toDto(row: DatabaseCompanion, db: ManagedDatabase): CompanionDto {
    const tool = getCompanionTool(row.tool);
    return {
      id: row.id,
      tool: row.tool,
      status: row.status,
      errorMessage: row.errorMessage,
      host: row.host,
      https: row.https,
      hostPort: row.hostPort,
      url: this.urlFor(row, db, tool),
      username: tool?.username ?? null,
      createdAt: row.createdAt,
    };
  }

  private urlFor(
    row: DatabaseCompanion,
    db: ManagedDatabase,
    tool: CompanionTool | undefined,
  ): string | null {
    const query =
      tool?.entryQuery?.({
        engine: db.engine,
        host: containerNameForDb(db),
      }) ?? '';
    if (row.host) {
      const settings = this.proxy.localSettings;
      const scheme = row.https ? 'https' : 'http';
      const port = row.https ? settings.httpsPort : settings.httpPort;
      const defaultPort = row.https ? 443 : 80;
      const suffix = port === defaultPort ? '' : `:${port}`;
      return `${scheme}://${row.host}${suffix}/${query}`;
    }
    if (row.hostPort) {
      const publicHost =
        this.config.get<string>('PUBLIC_IP')?.trim() ||
        this.config.get<string>('REGISTRY_PUBLIC_HOST')?.trim() ||
        null;
      if (!publicHost || publicHost === 'localhost') return null;
      return `http://${publicHost}:${row.hostPort}/${query}`;
    }
    return null;
  }
}
