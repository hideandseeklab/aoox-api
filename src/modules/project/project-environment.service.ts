import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { currentTokenScope } from '../auth/request-context';
import { decryptSecret, encryptSecret } from '../docker/secret.util';
import {
  ChangeSummary,
  compareEnvTexts,
  ENV_NAME,
  ENV_TEXT_MAX,
  envMap,
  keysOf,
  nextFlags,
  normalizeEnvText,
  SecretFlags,
  setValues,
  summarizeChange,
  validateEnvironmentText,
} from './env-text';
import {
  ENV_VERSION_KEEP,
  ProjectEnvironmentVersion,
  VersionAction,
  VersionVia,
} from './environment-version.entity';
import {
  DEFAULT_ENVIRONMENTS,
  ENVIRONMENT_NAME,
  PRODUCTION_ENVIRONMENT,
  ProjectEnvironment,
} from './project-environment.entity';
import { Project } from './project.entity';
import { ProjectService } from './project.service';

/** Upper bound per project; environments are meant to be a handful. */
export const MAX_ENVIRONMENTS = 20;

export interface EnvironmentUser {
  kind: 'application' | 'compose';
  id: string;
  name: string;
}

/**
 * Who makes a change; the version history keeps the email as a snapshot.
 * A bare user id is accepted for callers without a request (no snapshot).
 */
export interface EnvActor {
  userId: string;
  email: string | null;
  via: 'session' | 'token';
}
export type EnvActorInput = EnvActor | string;

/** Builds the actor from the `req.user` the guards produce (`tokenId` is set for API tokens). */
export function actorOf(user: {
  sub: string;
  email: string;
  tokenId?: string;
}): EnvActor {
  return {
    userId: user.sub,
    email: user.email,
    via: user.tokenId ? 'token' : 'session',
  };
}

function toActor(a: EnvActorInput): EnvActor {
  return typeof a === 'string' ? { userId: a, email: null, via: 'session' } : a;
}

export interface VersionView {
  id: string;
  createdAt: Date;
  authorEmail: string | null;
  via: VersionVia;
  action: VersionAction;
  detail: string | null;
  summary: ChangeSummary;
  /** The newest version is the current content. */
  current: boolean;
}

export interface EnvironmentDiff {
  from: { id: string; name: string };
  to: { id: string; name: string };
  /** False when the caller may not reveal both sides: values are then not compared. */
  comparable: boolean;
  onlyInFrom: string[];
  onlyInTo: string[];
  inBoth: string[];
  /** Keys present on both sides with different values; null when not comparable. */
  different: string[] | null;
  same: string[] | null;
}

export interface UpdateOptions {
  /** Secret flags to set (`true`/`false`) or clear (`null`); omitted = keep the current ones. */
  flags?: Record<string, boolean | null>;
  /** Recorded in the history: how the change was made. */
  action?: 'edit' | 'set' | 'unset' | 'push';
}

export interface EnvironmentView {
  id: string;
  name: string;
  protected: boolean;
  keys: string[];
  /** Keys flagged secret. */
  secretKeys: string[];
  /** Keys explicitly flagged not secret (unmarked keys are in neither list). */
  plainKeys: string[];
  updatedAt: Date;
  usedBy: EnvironmentUser[];
}

export interface ExportedEnvironment {
  name: string;
  protected: boolean;
  /** `KEY=VALUE` text; present only when the export includes secrets. */
  variables?: string;
  /** Names flagged secret / explicitly not secret (names only). */
  secretKeys?: string[];
  plainKeys?: string[];
}

/**
 * Who is linking an application or stack. Without an actor (import, which
 * creates a project its importer owns, and background code) no role rule runs.
 */
export interface LinkActor {
  userId: string;
  /** The environment the resource is linked to now (updates); undefined on create. */
  currentId?: string | null;
}

/** What a linked application or stack needs to find its environment. */
export interface EnvironmentLink {
  projectId: string;
  environmentId?: string | null;
}

/**
 * Environments of a project (development / staging / production / custom).
 * ProjectModule cannot import the application or compose modules (they import
 * it), so "who uses this environment" is read with plain SQL, like
 * `project-summary`.
 *
 * Access: any member lists names and keys; revealing or editing values is a
 * write request (POST/PUT), so viewers are rejected by `assertAccess`; values
 * of a protected environment additionally need the project `admin` role.
 */
@Injectable()
export class ProjectEnvironmentService {
  private readonly key: string;

  constructor(
    @InjectRepository(ProjectEnvironment)
    readonly repo: Repository<ProjectEnvironment>,
    private readonly projects: ProjectService,
    config: ConfigService,
  ) {
    this.key = config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  /** Creates the three standard environments; a no-op for those that exist. */
  async ensureDefaults(projectId: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .values(
        DEFAULT_ENVIRONMENTS.map((e) => ({
          projectId,
          name: e.name,
          protected: e.protected,
        })),
      )
      .orIgnore()
      .execute();
  }

  /**
   * Safety net for reads: production always exists. Development and staging
   * are only created with the project; deleting them is allowed and they must
   * not come back.
   */
  async ensureProduction(projectId: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .values({ projectId, name: PRODUCTION_ENVIRONMENT, protected: true })
      .orIgnore()
      .execute();
  }

  async list(userId: string, projectId: string): Promise<EnvironmentView[]> {
    await this.projects.findOwnedOrFail(projectId, userId);
    await this.ensureProduction(projectId);
    const rows = await this.repo.find({
      where: { projectId },
      order: { createdAt: 'ASC', name: 'ASC' },
    });
    const users = await this.usersOf(projectId);
    const order = DEFAULT_ENVIRONMENTS.map((e) => e.name as string);
    return rows
      .map((e) => this.view(e, users.get(e.id) ?? []))
      .sort((a, b) => rank(order, a.name) - rank(order, b.name));
  }

  async reveal(
    actor: EnvActorInput,
    projectId: string,
    envId: string,
  ): Promise<RevealView> {
    const { env } = await this.guardValues(
      toActor(actor).userId,
      projectId,
      envId,
    );
    return {
      variables: await this.textOf(env.id),
      keys: env.keys,
      ...flagLists(env.secretFlags),
      updatedAt: env.updatedAt,
    };
  }

  /**
   * Replaces the variables. `expectedUpdatedAt` (the `updatedAt` of the
   * reveal/list the caller edited from) makes it an optimistic write: when
   * the environment changed in between the answer is 409 and nothing is
   * saved. Omitted = last write wins (older clients). Every real change
   * stores a version (see `commit`).
   */
  async update(
    actorIn: EnvActorInput,
    projectId: string,
    envId: string,
    variables: string,
    expectedUpdatedAt?: string,
    opts: UpdateOptions = {},
  ): Promise<EnvironmentView> {
    const actor = toActor(actorIn);
    await this.guardValues(actor.userId, projectId, envId);
    const problem = validateEnvironmentText(variables);
    if (problem) throw new BadRequestException(problem);
    const patch = opts.flags ?? {};
    assertFlagPatch(patch, keysOf(variables));
    const saved = await this.transact(
      projectId,
      envId,
      expectedUpdatedAt,
      (m, env, oldText) =>
        this.commit(m, env, oldText, variables, patch, {
          actor,
          action: opts.action ?? 'edit',
          detail: null,
        }),
    );
    const users = await this.usersOf(projectId);
    return this.view(saved, users.get(saved.id) ?? []);
  }

  /** Version list of an environment: who, when, which keys. Never values; any member may read it. */
  async listVersions(
    userId: string,
    projectId: string,
    envId: string,
  ): Promise<VersionView[]> {
    await this.projects.findOwnedOrFail(projectId, userId);
    await this.findInProject(envId, projectId);
    const rows = await this.repo.manager.find(ProjectEnvironmentVersion, {
      where: { environmentId: envId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: ENV_VERSION_KEEP,
    });
    return rows.map((v, i) => ({
      id: v.id,
      createdAt: v.createdAt,
      authorEmail: v.authorEmail,
      via: v.via,
      action: v.action,
      detail: v.detail,
      summary: v.summary,
      current: i === 0,
    }));
  }

  /** Reads the values of one version; same rules as revealing the environment. */
  async revealVersion(
    actor: EnvActorInput,
    projectId: string,
    envId: string,
    versionId: string,
  ): Promise<{
    variables: string;
    secretKeys: string[];
    plainKeys: string[];
    createdAt: Date;
  }> {
    await this.guardValues(toActor(actor).userId, projectId, envId);
    const v = await this.loadVersion(this.repo.manager, envId, versionId);
    return {
      variables: v.variablesEncrypted
        ? decryptSecret(v.variablesEncrypted, this.key)
        : '',
      ...flagLists(v.secretFlags),
      createdAt: v.createdAt,
    };
  }

  /**
   * Writes an old version's text as a NEW version (history is never
   * rewritten). Same rules as editing. The old text must still pass today's
   * strict validation (400 otherwise).
   */
  async restoreVersion(
    actorIn: EnvActorInput,
    projectId: string,
    envId: string,
    versionId: string,
    expectedUpdatedAt?: string,
  ): Promise<EnvironmentView> {
    const actor = toActor(actorIn);
    await this.guardValues(actor.userId, projectId, envId);
    const saved = await this.transact(
      projectId,
      envId,
      expectedUpdatedAt,
      async (m, env, oldText) => {
        const v = await this.loadVersion(m, envId, versionId);
        const text = v.variablesEncrypted
          ? decryptSecret(v.variablesEncrypted, this.key)
          : '';
        const problem = validateEnvironmentText(text);
        if (problem) {
          throw new BadRequestException(
            `This version no longer passes validation: ${problem}`,
          );
        }
        const keys = keysOf(text);
        const patch: Record<string, boolean | null> = {};
        for (const k of keys) patch[k] = v.secretFlags?.[k] ?? null;
        if (
          normalizeText(text) === normalizeText(oldText) &&
          sameFlags(env.secretFlags, nextFlags({}, [], keys, patch))
        ) {
          throw new BadRequestException(
            'This version is already the current content',
          );
        }
        return this.commit(m, env, oldText, text, patch, {
          actor,
          action: 'restore',
          detail: `Restored the version of ${v.createdAt.toISOString()}`,
        });
      },
    );
    const users = await this.usersOf(projectId);
    return this.view(saved, users.get(saved.id) ?? []);
  }

  /**
   * Key-level comparison of two environments by name. Values are compared
   * server-side and never returned. Whether a key's value differs is one bit
   * about the values, so it is only computed when the caller may reveal BOTH
   * sides (same rule as reveal); otherwise only the key lists, which every
   * member can already see, are compared and `different`/`same` are null.
   */
  async diff(
    userId: string,
    projectId: string,
    fromName: string,
    toName: string,
  ): Promise<EnvironmentDiff> {
    const project = await this.projects.findOwnedOrFail(projectId, userId);
    await this.ensureProduction(projectId);
    const from = await this.findByName(projectId, fromName);
    const to = await this.findByName(projectId, toName);
    const role = await this.projects.access.roleFor(userId, project);
    const may = (e: ProjectEnvironment) =>
      role !== 'viewer' &&
      (!e.protected || role === 'admin') &&
      this.tokenMayUse(e.name);
    const fromKeys = keysOfEnv(from);
    const toKeys = keysOfEnv(to);
    const base = {
      from: { id: from.id, name: from.name },
      to: { id: to.id, name: to.name },
    };
    if (may(from) && may(to)) {
      const c = compareEnvTexts(
        await this.textOf(from.id),
        await this.textOf(to.id),
      );
      return {
        ...base,
        comparable: true,
        onlyInFrom: c.onlyInFrom,
        onlyInTo: c.onlyInTo,
        inBoth: [...c.same, ...c.different],
        different: c.different,
        same: c.same,
      };
    }
    const inTo = new Set(toKeys);
    const inFrom = new Set(fromKeys);
    return {
      ...base,
      comparable: false,
      onlyInFrom: fromKeys.filter((k) => !inTo.has(k)),
      onlyInTo: toKeys.filter((k) => !inFrom.has(k)),
      inBoth: fromKeys.filter((k) => inTo.has(k)),
      different: null,
      same: null,
    };
  }

  /**
   * Copies the values of `keys` from one environment into another. Needs the
   * reveal right on the source and the edit right on the target (both are the
   * same rule, so a protected side needs a project admin). The target keeps
   * its comments and order; new keys are appended; the source's secret flag
   * travels with each key.
   */
  async promote(
    actorIn: EnvActorInput,
    projectId: string,
    targetId: string,
    sourceId: string,
    keys: string[],
    expectedUpdatedAt?: string,
  ): Promise<{ environment: EnvironmentView; summary: ChangeSummary }> {
    const actor = toActor(actorIn);
    if (sourceId === targetId) {
      throw new BadRequestException(
        'Choose two different environments to promote between',
      );
    }
    const unique = [...new Set(keys)];
    if (unique.length === 0) {
      throw new BadRequestException('Choose at least one variable to promote');
    }
    const { env: source } = await this.guardValues(
      actor.userId,
      projectId,
      sourceId,
    );
    await this.guardValues(actor.userId, projectId, targetId);
    const sourceValues = envMap(await this.textOf(source.id));
    const missing = unique.filter((k) => !sourceValues.has(k));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Not set in "${source.name}": ${missing.join(', ')}`,
      );
    }
    let summary: ChangeSummary | undefined;
    const saved = await this.transact(
      projectId,
      targetId,
      expectedUpdatedAt,
      async (m, env, oldText) => {
        const text = setValues(
          oldText,
          unique.map((k) => [k, sourceValues.get(k) as string]),
        );
        const problem = validateEnvironmentText(text);
        if (problem) {
          throw new BadRequestException(
            `Cannot promote into "${env.name}": ${problem}`,
          );
        }
        const patch: Record<string, boolean | null> = {};
        for (const k of unique) patch[k] = source.secretFlags?.[k] ?? null;
        const before = env.secretFlags ?? {};
        const out = await this.commit(m, env, oldText, text, patch, {
          actor,
          action: 'promote',
          detail: `From ${source.name}`,
        });
        summary = summarizeChange(oldText, text, before, out.secretFlags);
        return out;
      },
    );
    const users = await this.usersOf(projectId);
    return {
      environment: this.view(saved, users.get(saved.id) ?? []),
      summary: summary as ChangeSummary,
    };
  }

  /**
   * Row-locked, optimistic write shared by every way of changing variables
   * (edit, set/unset/push, restore, promote). `fn` gets the locked row and
   * its current text and returns the saved row.
   */
  private async transact(
    projectId: string,
    envId: string,
    expectedUpdatedAt: string | undefined,
    fn: (
      m: EntityManager,
      env: ProjectEnvironment,
      oldText: string,
    ) => Promise<ProjectEnvironment>,
  ): Promise<ProjectEnvironment> {
    const expected =
      expectedUpdatedAt === undefined
        ? undefined
        : new Date(expectedUpdatedAt).getTime();
    if (expected !== undefined && Number.isNaN(expected)) {
      throw new BadRequestException('expectedUpdatedAt is not a valid date');
    }
    return this.repo.manager.transaction(async (m) => {
      // The row lock makes check-and-write atomic against a concurrent write.
      const env = await m.findOne(ProjectEnvironment, {
        where: { id: envId, projectId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!env) throw new NotFoundException('Environment not found');
      if (expected !== undefined && env.updatedAt.getTime() !== expected) {
        throw new ConflictException(
          `The "${env.name}" environment was changed by someone else; reload it and try again`,
        );
      }
      const row = await m.findOne(ProjectEnvironment, {
        where: { id: envId },
        select: { id: true, variablesEncrypted: true },
      });
      const oldText = row?.variablesEncrypted
        ? decryptSecret(row.variablesEncrypted, this.key)
        : '';
      return fn(m, env, oldText);
    });
  }

  /**
   * Saves `text`/flags on the locked row and, when something really changed,
   * stores a version (plus a baseline of the previous content when this is the
   * first version, so the first edit can be undone) and prunes old ones.
   */
  private async commit(
    m: EntityManager,
    env: ProjectEnvironment,
    oldText: string,
    text: string,
    flagPatch: Record<string, boolean | null>,
    ctx: { actor: EnvActor; action: VersionAction; detail: string | null },
  ): Promise<ProjectEnvironment> {
    const previousFlags = env.secretFlags ?? {};
    const keys = keysOf(text);
    const flags = nextFlags(previousFlags, env.keys ?? [], keys, flagPatch);
    const summary = summarizeChange(oldText, text, previousFlags, flags);
    const changed =
      normalizeText(oldText) !== normalizeText(text) ||
      !sameFlags(previousFlags, flags);

    if (changed) {
      const existing = await m.count(ProjectEnvironmentVersion, {
        where: { environmentId: env.id },
      });
      if (existing === 0 && oldText.trim()) {
        await m.insert(ProjectEnvironmentVersion, {
          environmentId: env.id,
          variablesEncrypted: encryptSecret(oldText, this.key),
          secretFlags: previousFlags,
          authorId: null,
          authorEmail: null,
          via: 'system',
          action: 'baseline',
          detail: 'Content before the first recorded change',
          summary: {
            added: keysOf(oldText),
            changed: [],
            removed: [],
            flags: [],
          },
          createdAt: env.updatedAt,
        });
      }
      await m.insert(ProjectEnvironmentVersion, {
        environmentId: env.id,
        variablesEncrypted: text.trim() ? encryptSecret(text, this.key) : null,
        secretFlags: flags,
        authorId: ctx.actor.userId,
        authorEmail: ctx.actor.email,
        via: ctx.actor.via,
        action: ctx.action,
        detail: ctx.detail,
        summary,
      });
      await m.query(
        `DELETE FROM project_environment_versions
         WHERE environment_id = $1 AND id NOT IN (
           SELECT id FROM project_environment_versions
           WHERE environment_id = $1
           ORDER BY created_at DESC, id DESC LIMIT $2)`,
        [env.id, ENV_VERSION_KEEP],
      );
    }
    env.variablesEncrypted = text.trim() ? encryptSecret(text, this.key) : null;
    env.keys = keys;
    env.secretFlags = flags;
    return m.save(env);
  }

  private async loadVersion(
    m: EntityManager,
    envId: string,
    versionId: string,
  ): Promise<ProjectEnvironmentVersion> {
    const v = await m.findOne(ProjectEnvironmentVersion, {
      where: { id: versionId, environmentId: envId },
      select: {
        id: true,
        environmentId: true,
        variablesEncrypted: true,
        secretFlags: true,
        createdAt: true,
      },
    });
    if (!v) throw new NotFoundException('Version not found');
    return v;
  }

  private async findByName(
    projectId: string,
    name: string,
  ): Promise<ProjectEnvironment> {
    const env = await this.repo.findOne({ where: { projectId, name } });
    if (!env) throw new NotFoundException(`Environment "${name}" not found`);
    return env;
  }

  async create(
    userId: string,
    projectId: string,
    name: string,
  ): Promise<EnvironmentView> {
    await this.projects.findOwnedOrFail(projectId, userId);
    this.assertTokenMayUse(name);
    await this.ensureProduction(projectId);
    if ((await this.repo.count({ where: { projectId } })) >= MAX_ENVIRONMENTS) {
      throw new BadRequestException(
        `A project can have at most ${MAX_ENVIRONMENTS} environments`,
      );
    }
    if (await this.repo.exists({ where: { projectId, name } })) {
      throw new ConflictException(`Environment "${name}" already exists`);
    }
    try {
      const saved = await this.repo.save(
        this.repo.create({ projectId, name, protected: false, keys: [] }),
      );
      return this.view(saved, []);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`Environment "${name}" already exists`);
      }
      throw err;
    }
  }

  async remove(
    userId: string,
    projectId: string,
    envId: string,
  ): Promise<void> {
    const project = await this.projects.findOwnedOrFail(projectId, userId);
    await this.projects.access.assertAdmin(userId, project);
    const env = await this.findInProject(envId, projectId);
    this.assertTokenMayUse(env.name);
    if (env.name === PRODUCTION_ENVIRONMENT) {
      throw new BadRequestException(
        'The production environment cannot be deleted',
      );
    }
    const used = (await this.usersOf(projectId)).get(env.id) ?? [];
    if (used.length > 0) {
      throw new ConflictException(
        `Environment "${env.name}" is still used by ${used
          .map((u) => `${u.kind} "${u.name}"`)
          .join(', ')}; switch them to another environment first`,
      );
    }
    try {
      await this.repo.delete({ id: env.id, projectId });
    } catch (err) {
      // Linked between the check and the delete: the FK is the last guard.
      if ((err as { code?: string }).code === '23503') {
        throw new ConflictException(
          `Environment "${env.name}" is still in use`,
        );
      }
      throw err;
    }
  }

  /** The environment, which must belong to the project (404 otherwise). */
  async findInProject(
    envId: string,
    projectId: string,
  ): Promise<ProjectEnvironment> {
    const env = await this.repo.findOne({ where: { id: envId, projectId } });
    if (!env) throw new NotFoundException('Environment not found');
    return env;
  }

  /**
   * For create/update of an application or stack: `environmentId` must be one
   * of the project's environments (400 otherwise).
   *
   * With an actor the protection rule applies, because a stack or app linked
   * to a protected environment can read its values at runtime (container
   * console, logs, `docker inspect`), which is what the reveal rule guards:
   * - linking to a protected environment, or moving away from one, needs the
   *   project `admin` role (403); keeping the current link is always fine;
   * - without an id (create) an admin gets `production`, anyone else the
   *   first unprotected environment (`development`, else the oldest), so a
   *   client that omits the field keeps working; 403 if there is none.
   */
  async resolveLink(
    projectId: string,
    environmentId: string | null | undefined,
    actor?: LinkActor,
  ): Promise<string> {
    let isAdmin = true;
    if (actor) {
      const project = await this.projects.findOwnedOrFail(
        projectId,
        actor.userId,
      );
      isAdmin =
        (await this.projects.access.roleFor(actor.userId, project)) === 'admin';
    }
    if (!environmentId) {
      await this.ensureProduction(projectId);
      if (!isAdmin) return (await this.defaultUnprotected(projectId)).id;
      const prod = await this.repo.findOneOrFail({
        where: { projectId, name: PRODUCTION_ENVIRONMENT },
      });
      return prod.id;
    }
    const env = await this.repo.findOne({
      where: { id: environmentId, projectId },
    });
    if (!env) {
      throw new BadRequestException(
        'environmentId must be an environment of the same project',
      );
    }
    if (actor && !isAdmin && env.id !== actor.currentId) {
      if (env.protected) {
        throw new ForbiddenException(
          `Only project admins can link to the protected "${env.name}" environment`,
        );
      }
      if (actor.currentId) {
        const current = await this.repo.findOne({
          where: { id: actor.currentId, projectId },
          select: { id: true, name: true, protected: true },
        });
        if (current?.protected) {
          throw new ForbiddenException(
            `Only project admins can move something away from the protected "${current.name}" environment`,
          );
        }
      }
    }
    return env.id;
  }

  /** `development` when it exists, else the oldest unprotected environment. */
  private async defaultUnprotected(
    projectId: string,
  ): Promise<ProjectEnvironment> {
    const unprotected = await this.repo.find({
      where: { projectId, protected: false },
      order: { createdAt: 'ASC' },
    });
    const pick =
      unprotected.find((e) => e.name === 'development') ?? unprotected[0];
    if (!pick) {
      throw new ForbiddenException(
        'Only project admins can use the protected environment; this project has no other environment, ask an admin to create one',
      );
    }
    return pick;
  }

  /**
   * Decrypted `KEY=VALUE` text for the resolver. The linked environment, or
   * the project's `production` when the link is missing (a pre-save entity).
   * Background and deploy paths call this directly: no actor, no role check.
   */
  async variablesFor(link: EnvironmentLink): Promise<string> {
    let id = link.environmentId ?? null;
    if (!id) {
      const prod = await this.repo.findOne({
        where: { projectId: link.projectId, name: PRODUCTION_ENVIRONMENT },
        select: { id: true },
      });
      id = prod?.id ?? null;
    }
    return id ? this.textOf(id) : '';
  }

  /** The text and secret flags of the linked environment, for the resolver (same lookup as `variablesFor`). */
  async variablesAndFlagsFor(
    link: EnvironmentLink,
  ): Promise<{ text: string; flags: SecretFlags }> {
    let id = link.environmentId ?? null;
    if (!id) {
      const prod = await this.repo.findOne({
        where: { projectId: link.projectId, name: PRODUCTION_ENVIRONMENT },
        select: { id: true },
      });
      id = prod?.id ?? null;
    }
    if (!id) return { text: '', flags: {} };
    const row = await this.repo.findOne({
      where: { id },
      select: { id: true, variablesEncrypted: true, secretFlags: true },
    });
    return {
      text: row?.variablesEncrypted
        ? decryptSecret(row.variablesEncrypted, this.key)
        : '',
      flags: row?.secretFlags ?? {},
    };
  }

  /** For project export: every environment, with values only when asked. */
  async exportAll(
    projectId: string,
    includeValues: boolean,
  ): Promise<ExportedEnvironment[]> {
    await this.ensureProduction(projectId);
    const rows = await this.repo.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
    });
    const out: ExportedEnvironment[] = [];
    for (const e of rows) {
      const item: ExportedEnvironment = {
        name: e.name,
        protected: e.protected,
        ...flagLists(e.secretFlags),
      };
      if (includeValues) item.variables = await this.textOf(e.id);
      out.push(item);
    }
    return out;
  }

  /**
   * For project import (no actor, the importer owns the new project): creates
   * the standard three, then applies the file's environments by name.
   * `legacyEnv` is the old `project.env` of files from before environments;
   * it lands in `production`. Returns name to id for linking apps and stacks.
   * Untrusted input: bad names or oversized text become warnings.
   */
  async importAll(
    projectId: string,
    environments: ExportedEnvironment[],
    legacyEnv: string | undefined,
    warnings: string[],
  ): Promise<Map<string, string>> {
    await this.ensureDefaults(projectId);
    const wanted = new Map<string, ExportedEnvironment>();
    for (const e of environments) {
      if (typeof e?.name !== 'string' || !ENVIRONMENT_NAME.test(e.name)) {
        warnings.push(
          `environment "${String(e?.name).slice(0, 40)}": invalid name, skipped`,
        );
        continue;
      }
      wanted.set(e.name, e);
    }
    if (legacyEnv?.trim() && !wanted.get(PRODUCTION_ENVIRONMENT)?.variables) {
      wanted.set(PRODUCTION_ENVIRONMENT, {
        name: PRODUCTION_ENVIRONMENT,
        protected: true,
        variables: legacyEnv,
      });
    }
    const existing = new Map(
      (await this.repo.find({ where: { projectId } })).map((e) => [e.name, e]),
    );
    const withoutValues: string[] = [];
    for (const e of wanted.values()) {
      if (!existing.has(e.name) && existing.size >= MAX_ENVIRONMENTS) {
        warnings.push(
          `environment "${e.name}": too many environments, skipped`,
        );
        continue;
      }
      const row =
        existing.get(e.name) ??
        this.repo.create({
          projectId,
          name: e.name,
          protected: e.protected === true,
          keys: [],
        });
      const text = normalizeEnvText(
        typeof e.variables === 'string' ? e.variables : '',
      );
      if (text.length > ENV_TEXT_MAX) {
        warnings.push(
          `environment "${e.name}": variables too large, left empty`,
        );
      } else if (e.variables === undefined) {
        withoutValues.push(e.name);
      } else if (text) {
        row.variablesEncrypted = encryptSecret(text, this.key);
        row.keys = keysOf(text);
        // Flags from the file (names only) apply to keys that exist; keys
        // without one get the name rule, like any newly added key.
        const patch: Record<string, boolean | null> = {};
        for (const k of Array.isArray(e.secretKeys) ? e.secretKeys : []) {
          if (typeof k === 'string') patch[k] = true;
        }
        for (const k of Array.isArray(e.plainKeys) ? e.plainKeys : []) {
          if (typeof k === 'string') patch[k] = false;
        }
        row.secretFlags = nextFlags({}, [], row.keys, patch);
      }
      existing.set(e.name, await this.repo.save(row));
    }
    if (withoutValues.length > 0) {
      warnings.push(
        `environments exported without secrets (${withoutValues.join(', ')}): variables left empty`,
      );
    }
    return new Map([...existing].map(([name, e]) => [name, e.id]));
  }

  /**
   * Access check shared by reveal and update. Order matters: the POST reveal
   * route is exempt from the generic viewer write rule (so read-only API
   * tokens can pull variables), hence viewers are refused here explicitly.
   */
  private async guardValues(
    userId: string,
    projectId: string,
    envId: string,
  ): Promise<{ env: ProjectEnvironment; project: Project }> {
    // Throws 404 for outsiders and 403 for viewers on writes (PUT).
    const project = await this.projects.findOwnedOrFail(projectId, userId);
    const role = await this.projects.access.roleFor(userId, project);
    if (role === 'viewer') {
      throw new ForbiddenException(
        'Viewers cannot read or change environment values',
      );
    }
    const env = await this.findInProject(envId, projectId);
    this.assertTokenMayUse(env.name);
    if (env.protected && role !== 'admin') {
      throw new ForbiddenException(
        `Only project admins can read or change the values of the protected "${env.name}" environment`,
      );
    }
    return { env, project };
  }

  /** An API token limited to some environment names cannot touch others. */
  private tokenMayUse(name: string): boolean {
    const allowed = currentTokenScope()?.environments;
    return !allowed || allowed.includes(name);
  }

  private assertTokenMayUse(name: string): void {
    const allowed = currentTokenScope()?.environments;
    if (allowed && !allowed.includes(name)) {
      throw new ForbiddenException(
        `This API token is limited to the ${allowed.join(', ')} environment${allowed.length > 1 ? 's' : ''}`,
      );
    }
  }

  private async textOf(envId: string): Promise<string> {
    const row = await this.repo.findOne({
      where: { id: envId },
      select: { id: true, variablesEncrypted: true },
    });
    return row?.variablesEncrypted
      ? decryptSecret(row.variablesEncrypted, this.key)
      : '';
  }

  private view(
    e: ProjectEnvironment,
    usedBy: EnvironmentUser[],
  ): EnvironmentView {
    return {
      id: e.id,
      name: e.name,
      protected: e.protected,
      keys: e.keys ?? [],
      ...flagLists(e.secretFlags),
      updatedAt: e.updatedAt,
      usedBy,
    };
  }

  private async usersOf(
    projectId: string,
  ): Promise<Map<string, EnvironmentUser[]>> {
    const rows: Array<{
      environment_id: string;
      kind: EnvironmentUser['kind'];
      id: string;
      name: string;
    }> = await this.repo.query(
      `SELECT environment_id, 'application' AS kind, id, name FROM applications WHERE project_id = $1
       UNION ALL
       SELECT environment_id, 'compose' AS kind, id, name FROM compose_apps WHERE project_id = $1
       ORDER BY name`,
      [projectId],
    );
    const out = new Map<string, EnvironmentUser[]>();
    for (const r of rows) {
      const list = out.get(r.environment_id) ?? [];
      list.push({ kind: r.kind, id: r.id, name: r.name });
      out.set(r.environment_id, list);
    }
    return out;
  }
}

function rank(order: string[], name: string): number {
  const i = order.indexOf(name);
  return i === -1 ? order.length : i;
}

export interface RevealView {
  variables: string;
  keys: string[];
  secretKeys: string[];
  plainKeys: string[];
  updatedAt: Date;
}

function flagLists(flags: SecretFlags | null | undefined): {
  secretKeys: string[];
  plainKeys: string[];
} {
  const f = flags ?? {};
  return {
    secretKeys: Object.keys(f).filter((k) => f[k] === true),
    plainKeys: Object.keys(f).filter((k) => f[k] === false),
  };
}

function keysOfEnv(e: ProjectEnvironment): string[] {
  return e.keys ?? [];
}

/** Line endings and trailing blank space do not make a change. */
function normalizeText(t: string): string {
  return t.replace(/\r\n/g, '\n').trimEnd();
}

function sameFlags(a: SecretFlags | null, b: SecretFlags): boolean {
  const x = a ?? {};
  const kx = Object.keys(x);
  return kx.length === Object.keys(b).length && kx.every((k) => x[k] === b[k]);
}

/** A flag patch may only name variables that exist in the new text. */
function assertFlagPatch(
  patch: Record<string, boolean | null>,
  keys: string[],
): void {
  const known = new Set(keys);
  const bad = Object.entries(patch).filter(
    ([k, v]) => !ENV_NAME.test(k) || !(typeof v === 'boolean' || v === null),
  );
  if (bad.length > 0) {
    throw new BadRequestException(
      'flags must map variable names to true, false or null',
    );
  }
  const unknown = Object.keys(patch).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new BadRequestException(
      `flags refer to variables that are not in the text: ${unknown.slice(0, 5).join(', ')}`,
    );
  }
}
