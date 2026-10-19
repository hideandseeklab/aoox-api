import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  hostPortBinding,
  LOOPBACK_IP,
  normalizeBind,
} from '../docker/host-port-bind';
import { resourceLimits } from '../docker/resource-limits';
import { Mount } from '../application/mount.entity';
import {
  bindsFor,
  filesVolumeFor,
  prepareMounts,
  volumeNameFor,
} from '../application/mounts';
import { shellQuote } from '../application/nixpacks-builder.service';
import { composeLabels, DockerService } from '../docker/docker.service';
import { DockerEngineError } from '../docker/docker-engine.client';
import { SwarmService } from '../swarm/swarm.service';
import { ProjectAccessService } from '../project/project-access.service';
import { decryptSecret, encryptSecret } from '../docker/secret.util';
import { APP_NETWORK } from '../proxy/proxy.service';
import { companionContainerName } from '../database-companion/companion-names';
import { ENGINES, imageNameFor, POSTGRES_VARIANTS } from './engines';
import { readinessScript, READY_TIMEOUT_SECONDS } from './readiness';
import { ManagedDatabase } from './managed-database.entity';

export function containerNameForDb(db: ManagedDatabase): string {
  return `aoox-db-${db.slug}`;
}

export function volumeNameForDb(db: ManagedDatabase): string {
  return `aoox_db_${db.slug.replace(/-/g, '_')}`;
}

const INTERRUPTED_MESSAGE =
  'Provisioning was interrupted by an API restart. Delete this database and create it again.';

/** The row disappeared while the detached provision was still running. */
export class DatabaseDeletedError extends Error {
  constructor(slug: string) {
    super(`Database ${slug} was deleted while it was starting`);
  }
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
  /** The published port listens on 127.0.0.1: only this server (or an SSH tunnel) can reach it. */
  externalLoopbackOnly: boolean;
}

@Injectable()
export class ManagedDatabaseService implements OnApplicationBootstrap {
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

  /**
   * Provisioning runs detached inside this process, so a row still
   * `creating` at boot was interrupted by a restart: nothing will ever move
   * it on. It is not resumed (a half-initialised data directory is never
   * repaired); it goes to `error` with a message, which can be deleted
   * (deleting is refused while `creating`).
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const res = await this.repo.update(
        { status: 'creating' },
        { status: 'error', errorMessage: INTERRUPTED_MESSAGE },
      );
      if (res.affected) {
        this.logger.warn(
          `${res.affected} database(s) were still starting when the API stopped; marked as error`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Could not check databases left in "creating": ${String(err)}`,
      );
    }
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

  /** Like findOwnedOrFail, but viewers are refused (exports and dumps carry data out). */
  async findOwnedForExportOrFail(
    id: string,
    ownerId: string,
  ): Promise<ManagedDatabase> {
    const db = await this.findOwnedOrFail(id, ownerId);
    await this.access.assertCanExport(ownerId, db.project);
    return db;
  }

  /** Developer or higher (404 outsiders, 403 viewers) for a database already loaded. */
  async assertCanReadData(ownerId: string, db: ManagedDatabase): Promise<void> {
    await this.access.assertCanExport(ownerId, db.project);
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
    const loopbackOnly =
      !!db.hostPort && normalizeBind(db.hostPortBind) === 'loopback';
    const externalHost = db.hostPort
      ? loopbackOnly
        ? LOOPBACK_IP
        : (this.config.get<string>('REGISTRY_PUBLIC_HOST') ?? 'localhost')
      : null;
    const base = { username: db.username, password, database: db.databaseName };
    return {
      ...base,
      internalHost,
      internalPort: spec.port,
      internalUrl: spec.url({ ...base, host: internalHost, port: spec.port }),
      externalHost,
      externalPort: db.hostPort,
      externalLoopbackOnly: loopbackOnly,
      externalUrl:
        externalHost && db.hostPort
          ? spec.url({ ...base, host: externalHost, port: db.hostPort })
          : null,
    };
  }

  /** Pulls the image, creates the volume and starts the container. Async caller. */
  async provision(db: ManagedDatabase, password: string): Promise<void> {
    const spec = ENGINES[db.engine];
    const image = `${imageNameFor(db.engine, db.variant)}:${db.imageTag}`;
    const name = containerNameForDb(db);
    const volume = volumeNameForDb(db);
    const port = `${spec.port}/tcp`;

    await this.docker.ensureImage(image);
    // The image pull can take minutes: the row may have been deleted since.
    await this.assertRowExists(db);
    await this.docker.ensureNetwork(APP_NETWORK);
    await this.docker.engine.createVolume(volume);

    // `v`: also drops the anonymous volumes the image declares and the recipe
    // does not mount by name (named data and mount volumes are never touched).
    const existing = await this.docker.findContainerByName(name);
    if (existing) {
      await this.docker.engine.removeContainer(existing.Id, true, true);
    }

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
            ? { [port]: [hostPortBinding(db.hostPort, db.hostPortBind)] }
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
    // `running` must mean the engine answers, not just that the container exists.
    await this.waitUntilReady(db, password);
    try {
      await this.assertRowExists(db);
    } catch (err) {
      // Deleted while starting: remove what this run created.
      await this.docker.engine
        .removeContainer(id, true, true)
        .catch(() => undefined);
      throw err;
    }
    if (db.engine === 'postgres' && db.variant) {
      await this.activateVariantExtension(db, password);
    }
    if (db.engine === 'mongodb') {
      await this.initMongoDatabase(db, password);
    }
  }

  private async assertRowExists(db: ManagedDatabase): Promise<void> {
    if (!(await this.repo.exists({ where: { id: db.id } }))) {
      throw new DatabaseDeletedError(db.slug);
    }
  }

  /**
   * Blocks until the engine accepts an authenticated TCP connection (one-shot
   * probe container from the same image, on the aoox network). Throws with a
   * readable message on timeout so the row ends in `error`.
   */
  private async waitUntilReady(
    db: ManagedDatabase,
    password: string,
  ): Promise<void> {
    const image = `${imageNameFor(db.engine, db.variant)}:${db.imageTag}`;
    const { code, output } = await this.docker.runOnceWithOutput({
      Image: image,
      Entrypoint: ['sh', '-c', readinessScript(db.engine)],
      Env: [
        `DB_HOST=${containerNameForDb(db)}`,
        `DB_PORT=${ENGINES[db.engine].port}`,
        `DB_USER=${db.username}`,
        `DB_PASSWORD=${password}`,
        `DB_NAME=${db.databaseName}`,
      ],
      Labels: {
        'aoox.component': 'query',
        ...composeLabels('db-ready-check'),
      },
      HostConfig: { NetworkMode: APP_NETWORK },
    });
    if (code !== 0) {
      // Engine log lines carry a leading timestamp; keep only the message.
      const detail = output
        .trim()
        .split(/\r?\n/)
        .pop()
        ?.replace(/^\S+Z\s+/, '')
        .slice(-200);
      throw new Error(
        `The database did not become ready within ${READY_TIMEOUT_SECONDS} seconds${detail ? ` (${detail})` : ''}`,
      );
    }
  }

  /**
   * Runs `CREATE EXTENSION IF NOT EXISTS` for the chosen Postgres variant in
   * a one-off helper (same image, so `psql`/`pg_isready` are guaranteed to
   * exist). Waits for the server to accept connections first — `provision()`
   * doesn't otherwise wait for Postgres to be ready, only for the container
   * to start. Idempotent (`IF NOT EXISTS`), so safe to call again after a
   * variant Postgres restarts. Logs a warning rather than failing
   * provisioning if the extension can't be created — the database itself is
   * still usable without it.
   */
  private async activateVariantExtension(
    db: ManagedDatabase,
    password: string,
  ): Promise<void> {
    if (!db.variant) return;
    const image = `${imageNameFor(db.engine, db.variant)}:${db.imageTag}`;
    const statements = POSTGRES_VARIANTS[db.variant].extensionSql;
    const script = [
      'for i in $(seq 1 30); do pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" >/dev/null 2>&1 && break; sleep 1; done',
      ...statements.map(
        (stmt) =>
          `PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c ${shellQuote(stmt)}`,
      ),
    ].join(' && ');
    const id = await this.docker.engine.createContainer({
      Image: image,
      Entrypoint: ['sh', '-c', script],
      Env: [
        `DB_HOST=${containerNameForDb(db)}`,
        `DB_PORT=${ENGINES.postgres.port}`,
        `DB_USER=${db.username}`,
        `DB_PASSWORD=${password}`,
        `DB_NAME=${db.databaseName}`,
      ],
      Labels: {
        'aoox.component': 'query',
        ...composeLabels('db-variant-init'),
      },
      HostConfig: { NetworkMode: APP_NETWORK },
    });
    try {
      await this.docker.engine.startContainer(id);
      await this.docker.engine.waitContainer(id);
    } catch (err) {
      this.logger.warn(
        `Could not activate ${db.variant} extension for ${db.slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await this.docker.engine
        .removeContainer(id, true, true)
        .catch(() => undefined);
    }
  }

  /**
   * MongoDB creates databases lazily (no `CREATE DATABASE`) — a database
   * only "exists" once it holds a collection with data, so without this the
   * primary `databaseName` wouldn't show up in `schemas/` until the app's
   * first write. Waits for `mongod` to accept connections (same idea as
   * `activateVariantExtension`'s `pg_isready` loop, via `mongosh --eval`
   * instead), then writes one placeholder document. Logs a warning rather
   * than failing provisioning — the database is still usable without it.
   */
  private async initMongoDatabase(
    db: ManagedDatabase,
    password: string,
  ): Promise<void> {
    const image = `${imageNameFor(db.engine, db.variant)}:${db.imageTag}`;
    // Credentials stay in Env (not interpolated into the script/Entrypoint
    // literal) so they never show up in `docker inspect`/`docker top`, same
    // rule as every other recipe in this codebase.
    const uri =
      'mongodb://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?authSource=admin';
    const script = [
      `for i in $(seq 1 30); do mongosh "${uri}" --quiet --eval "db.adminCommand('ping')" >/dev/null 2>&1 && break; sleep 1; done`,
      `mongosh "${uri}" --quiet --eval "db.getCollection('_aoox_init').insertOne({createdAt: new Date()})"`,
    ].join(' && ');
    const id = await this.docker.engine.createContainer({
      Image: image,
      Entrypoint: ['sh', '-c', script],
      Env: [
        `DB_HOST=${containerNameForDb(db)}`,
        `DB_PORT=${ENGINES.mongodb.port}`,
        `DB_USER=${db.username}`,
        `DB_PASSWORD=${password}`,
        `DB_NAME=${db.databaseName}`,
      ],
      Labels: {
        'aoox.component': 'query',
        ...composeLabels('db-mongo-init'),
      },
      HostConfig: { NetworkMode: APP_NETWORK },
    });
    try {
      await this.docker.engine.startContainer(id);
      await this.docker.engine.waitContainer(id);
    } catch (err) {
      this.logger.warn(
        `Could not initialize database for ${db.slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await this.docker.engine
        .removeContainer(id, true, true)
        .catch(() => undefined);
    }
  }

  /** Detached provisioning; always leaves the row in `running` or `error`. */
  provisionInBackground(db: ManagedDatabase, password: string): void {
    void this.provision(db, password)
      .then(() =>
        this.repo.update(db.id, { status: 'running', errorMessage: null }),
      )
      .catch(async (err: unknown) => {
        if (err instanceof DatabaseDeletedError) {
          // The first provision created the volume: nobody owns it now.
          this.logger.warn(`${err.message}; cleaned up`);
          await this.docker.engine
            .removeVolume(volumeNameForDb(db))
            .catch(() => undefined);
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Provisioning ${db.slug} failed: ${message}`);
        await this.repo.update(db.id, {
          status: 'error',
          errorMessage: message,
        });
      });
  }

  async remove(db: ManagedDatabase, purge: boolean): Promise<void> {
    // The admin app (database_companions) goes first; it must never block the delete.
    try {
      const admin = await this.docker.findContainerByName(
        companionContainerName(db.slug),
      );
      if (admin) {
        await this.docker.engine.removeContainer(admin.Id, true, true);
      }
    } catch (err) {
      this.logger.warn(
        `Could not remove the admin app of ${db.slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const c = await this.docker.findContainerByName(containerNameForDb(db));
    // `v`: anonymous volumes of the image (e.g. MongoDB /data/configdb) go
    // with the container; the named data volume only with `purge`.
    if (c) await this.docker.engine.removeContainer(c.Id, true, true);
    if (purge) {
      await this.docker.engine
        .removeVolume(volumeNameForDb(db))
        .catch(() => undefined);
      await this.purgeMountVolumes(db);
    }
  }

  /**
   * Purge also drops what the database's mounts created: the named volumes of
   * `volume` mounts and the shared files volume holding `file` mounts
   * (neither goes away with the container). Already-missing volumes are fine;
   * any other failure stops the delete so a retry can finish it.
   */
  private async purgeMountVolumes(db: ManagedDatabase): Promise<void> {
    const mounts = await this.mounts.find({ where: { databaseId: db.id } });
    const owner = { slug: db.slug, engine: db.engine };
    const names = [
      ...mounts
        .filter((m) => m.type === 'volume')
        .map((m) => volumeNameFor(owner, m)),
      filesVolumeFor(owner),
    ];
    for (const name of names) {
      await this.docker.engine.removeVolume(name).catch((err: unknown) => {
        if (err instanceof DockerEngineError && err.status === 404) return;
        throw err;
      });
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
