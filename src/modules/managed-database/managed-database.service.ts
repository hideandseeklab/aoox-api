import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { resourceLimits } from '../docker/resource-limits';
import { Mount } from '../application/mount.entity';
import { bindsFor, prepareMounts } from '../application/mounts';
import { composeLabels, DockerService } from '../docker/docker.service';
import { SwarmService } from '../swarm/swarm.service';
import { ProjectAccessService } from '../project/project-access.service';
import { decryptSecret, encryptSecret } from '../docker/secret.util';
import { APP_NETWORK } from '../proxy/proxy.service';
import { ENGINES } from './engines';
import { ManagedDatabase } from './managed-database.entity';

export function containerNameForDb(db: ManagedDatabase): string {
  return `aoox-db-${db.slug}`;
}

export function volumeNameForDb(db: ManagedDatabase): string {
  return `aoox_db_${db.slug.replace(/-/g, '_')}`;
}

export interface DatabaseConnection {
  username: string;
  password: string;
  database: string;
  /** Reachable from application containers on the aoox network. */
  internalHost: string;
  internalPort: number;
  internalUrl: string;
  /** Reachable from the host / outside, only when a host port is published. */
  externalHost: string | null;
  externalPort: number | null;
  externalUrl: string | null;
}

@Injectable()
export class ManagedDatabaseService {
  private readonly logger = new Logger(ManagedDatabaseService.name);
  private readonly key: string;

  constructor(
    @InjectRepository(ManagedDatabase)
    readonly repo: Repository<ManagedDatabase>,
    @InjectRepository(Mount)
    readonly mounts: Repository<Mount>,
    private readonly docker: DockerService,
    private readonly config: ConfigService,
    private readonly swarm: SwarmService,
    private readonly access: ProjectAccessService,
  ) {
    this.key = config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  encrypt(plain: string): string {
    return encryptSecret(plain, this.key);
  }

  /** Ownership is enforced through the parent project. */
  async findOwnedOrFail(id: string, ownerId: string): Promise<ManagedDatabase> {
    const db = await this.repo.findOne({
      where: { id },
      relations: { project: true },
    });
    if (!db) throw new NotFoundException('Database not found');
    await this.access.assertAccess(ownerId, db.project);
    return db;
  }

  async password(db: ManagedDatabase): Promise<string> {
    const row = await this.repo
      .createQueryBuilder('d')
      .addSelect('d.passwordEncrypted')
      .where('d.id = :id', { id: db.id })
      .getOneOrFail();
    return decryptSecret(row.passwordEncrypted, this.key);
  }

  async connection(db: ManagedDatabase): Promise<DatabaseConnection> {
    const spec = ENGINES[db.engine];
    const password = await this.password(db);
    const internalHost = containerNameForDb(db);
    const externalHost = db.hostPort
      ? (this.config.get<string>('REGISTRY_PUBLIC_HOST') ?? 'localhost')
      : null;
    const base = { username: db.username, password, database: db.databaseName };
    return {
      ...base,
      internalHost,
      internalPort: spec.port,
      internalUrl: spec.url({ ...base, host: internalHost, port: spec.port }),
      externalHost,
      externalPort: db.hostPort,
      externalUrl:
        externalHost && db.hostPort
          ? spec.url({ ...base, host: externalHost, port: db.hostPort })
          : null,
    };
  }

  /** Pulls the image, creates the volume and starts the container. Async caller. */
  async provision(db: ManagedDatabase, password: string): Promise<void> {
    const spec = ENGINES[db.engine];
    const image = `${spec.image}:${db.imageTag}`;
    const name = containerNameForDb(db);
    const volume = volumeNameForDb(db);
    const port = `${spec.port}/tcp`;

    await this.docker.ensureImage(image);
    await this.docker.ensureNetwork(APP_NETWORK);
    await this.docker.engine.createVolume(volume);

    const existing = await this.docker.findContainerByName(name);
    if (existing) await this.docker.engine.removeContainer(existing.Id, true);

    const opts = {
      username: db.username,
      password,
      database: db.databaseName,
    };
    // Config files / extra volumes attached to this database (see application mounts).
    const mounts = await this.mounts.find({
      where: { databaseId: db.id },
      order: { createdAt: 'ASC' },
    });
    const filesMountpoint = await prepareMounts(this.docker, db, mounts);
    const id = await this.docker.engine.createContainer(
      {
        Image: image,
        Env: spec.env(opts),
        Cmd: spec.cmd?.({ password }),
        Labels: {
          'aoox.component': 'database',
          'aoox.database': db.id,
          'aoox.project': db.projectId,
          ...composeLabels(`db-${db.slug}`),
        },
        ExposedPorts: { [port]: {} },
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          LogConfig: this.docker.logConfig,
          NetworkMode: APP_NETWORK,
          Binds: [
            `${volume}:${spec.dataPath}`,
            ...bindsFor(db, mounts, filesMountpoint),
          ],
          PortBindings: db.hostPort
            ? { [port]: [{ HostPort: String(db.hostPort) }] }
            : {},
          ...resourceLimits(db.cpuMillicores, db.memoryMb),
        },
      },
      name,
    );
    // Reachable by name from swarm-mode apps too (no-op without a swarm).
    await this.swarm.connectIfActive(id);
    await this.docker.engine.startContainer(id);
    this.logger.log(`Database ${name} (${image}) started`);
  }

  /** Detached provisioning; always leaves the row in `running` or `error`. */
  provisionInBackground(db: ManagedDatabase, password: string): void {
    void this.provision(db, password)
      .then(() =>
        this.repo.update(db.id, { status: 'running', errorMessage: null }),
      )
      .catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Provisioning ${db.slug} failed: ${message}`);
        await this.repo.update(db.id, {
          status: 'error',
          errorMessage: message,
        });
      });
  }

  async remove(db: ManagedDatabase, purge: boolean): Promise<void> {
    const c = await this.docker.findContainerByName(containerNameForDb(db));
    if (c) await this.docker.engine.removeContainer(c.Id, true);
    if (purge) {
      await this.docker.engine
        .removeVolume(volumeNameForDb(db))
        .catch(() => undefined);
    }
  }

  static slugify(name: string): string {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 30) || 'db';
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
