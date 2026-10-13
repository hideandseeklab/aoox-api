import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { decryptSecret, encryptSecret } from '../docker/secret.util';
import {
  ChangeSummary,
  compareEnvTexts,
  ENV_NAME,
  envMap,
  keysOf,
  nextFlags,
  SecretFlags,
  setValues,
  summarizeChange,
  validateEnvironmentText,
} from './env-text';
import {
  SetAccess,
  VariableSetAccessService,
  type ProjectRoles,
} from './variable-set-access.service';
import {
  ENV_VERSION_KEEP,
  VariableSetEnvironmentVersion,
  VersionAction,
  VersionVia,
} from './variable-set-environment-version.entity';
import {
  DEFAULT_ENVIRONMENTS,
  VariableSetEnvironment,
} from './variable-set-environment.entity';

/** Upper bound per set; environments are meant to be a handful. */
export const MAX_ENVIRONMENTS = 20;

/** An application or stack that links an environment. */
export interface EnvironmentUser {
  kind: 'application' | 'compose';
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  /** The link's position in that resource's list (0 = first, overridden by later ones). */
  position: number;
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
  /** Applications and stacks linking it, limited to projects the caller may see. */
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

/** One layer of variables for the resolver, in link order. */
export interface VariableLayer {
  environmentId: string;
  text: string;
  flags: SecretFlags;
}

export interface RevealView {
  variables: string;
  keys: string[];
  secretKeys: string[];
  plainKeys: string[];
  updatedAt: Date;
}

/**
 * Environments of a variable set and their values: reveal, edit (optimistic,
 * row-locked, versioned), history, restore, diff and promote. Access is
 * decided by VariableSetAccessService: viewers never see values, protected
 * environments need an instance owner/admin, an API token's variable scope
 * narrows. Deploy and background code reads values through `layersFor`, with
 * no actor and no role check.
 */
@Injectable()
export class VariableSetEnvironmentService {
  private readonly key: string;

  constructor(
    @InjectRepository(VariableSetEnvironment)
    readonly repo: Repository<VariableSetEnvironment>,
    readonly access: VariableSetAccessService,
    config: ConfigService,
  ) {
    this.key = config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  /** Creates the three standard environments of a new set; a no-op for those that exist. */
  async ensureDefaults(setId: string, m?: EntityManager): Promise<void> {
    await (m ?? this.repo.manager)
      .createQueryBuilder()
      .insert()
      .into(VariableSetEnvironment)
      .values(
        DEFAULT_ENVIRONMENTS.map((e) => ({
          variableSetId: setId,
          name: e.name,
          protected: e.protected,
        })),
      )
      .orIgnore()
      .execute();
  }

  /** Environments of a set in display order (the defaults first, then by age). */
  async listOf(setId: string): Promise<VariableSetEnvironment[]> {
    const rows = await this.repo.find({
      where: { variableSetId: setId },
      order: { createdAt: 'ASC', name: 'ASC' },
    });
    const order = DEFAULT_ENVIRONMENTS.map((e) => e.name as string);
    return rows.sort((a, b) => rank(order, a.name) - rank(order, b.name));
  }

  async views(
    envs: VariableSetEnvironment[],
    ctx: ProjectRoles,
  ): Promise<EnvironmentView[]> {
    const users = await this.usersOf(
      envs.map((e) => e.id),
      ctx,
    );
    return envs.map((e) => this.view(e, users.get(e.id) ?? []));
  }

  async reveal(
    actor: EnvActorInput,
    setId: string,
    envId: string,
  ): Promise<RevealView> {
    const { env } = await this.guardValues(toActor(actor).userId, setId, envId);
    return {
      variables: await this.textOf(env.id),
      keys: env.keys,
      ...flagLists(env.secretFlags),
      updatedAt: env.updatedAt,
    };
  }

  /**
   * Replaces the variables. `expectedUpdatedAt` (the `updatedAt` of the
   * reveal the caller edited from) makes it an optimistic write: when the
   * environment changed in between the answer is 409 and nothing is saved.
   * Omitted = last write wins (older clients). Every real change stores a
   * version (see `commit`).
   */
  async update(
    actorIn: EnvActorInput,
    setId: string,
    envId: string,
    variables: string,
    expectedUpdatedAt?: string,
    opts: UpdateOptions = {},
  ): Promise<EnvironmentView> {
    const actor = toActor(actorIn);
    const { access } = await this.guardValues(actor.userId, setId, envId);
    const problem = validateEnvironmentText(variables);
    if (problem) throw new BadRequestException(problem);
    const patch = opts.flags ?? {};
    assertFlagPatch(patch, keysOf(variables));
    const saved = await this.transact(
      setId,
      envId,
      expectedUpdatedAt,
      (m, env, oldText) =>
        this.commit(m, env, oldText, variables, patch, {
          actor,
          action: opts.action ?? 'edit',
          detail: null,
        }),
    );
    return (await this.views([saved], access.ctx))[0];
  }

  /** Version list of an environment: who, when, which keys. Never values; anyone who sees the set may read it. */
  async listVersions(
    userId: string,
    setId: string,
    envId: string,
  ): Promise<VersionView[]> {
    await this.access.load(userId, setId);
    await this.findInSet(envId, setId);
    const rows = await this.repo.manager.find(VariableSetEnvironmentVersion, {
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
    setId: string,
    envId: string,
    versionId: string,
  ): Promise<{
    variables: string;
    secretKeys: string[];
    plainKeys: string[];
    createdAt: Date;
  }> {
    await this.guardValues(toActor(actor).userId, setId, envId);
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
    setId: string,
    envId: string,
    versionId: string,
    expectedUpdatedAt?: string,
  ): Promise<EnvironmentView> {
    const actor = toActor(actorIn);
    const { access } = await this.guardValues(actor.userId, setId, envId);
    const saved = await this.transact(
      setId,
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
    return (await this.views([saved], access.ctx))[0];
  }

  /**
   * Key-level comparison of two environments of a set, by name. Values are
   * compared server-side and never returned. Whether a key's value differs is
   * one bit about the values, so it is only computed when the caller may
   * reveal BOTH sides (same rule as reveal); otherwise only the key lists,
   * which everyone who sees the set can already read, are compared and
   * `different`/`same` are null.
   */
  async diff(
    userId: string,
    setId: string,
    fromName: string,
    toName: string,
  ): Promise<EnvironmentDiff> {
    const access = await this.access.load(userId, setId);
    const from = await this.findByName(setId, fromName);
    const to = await this.findByName(setId, toName);
    const may = (e: VariableSetEnvironment) =>
      this.access.mayUseValues(access, e);
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
   * Copies the values of `keys` from one environment of the set into another.
   * Needs the reveal right on the source and the edit right on the target
   * (the same rule, so a protected side needs an instance owner/admin). The
   * target keeps its comments and order; new keys are appended; the source's
   * secret flag travels with each key.
   */
  async promote(
    actorIn: EnvActorInput,
    setId: string,
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
    const { env: source, access } = await this.guardValues(
      actor.userId,
      setId,
      sourceId,
    );
    await this.guardValues(actor.userId, setId, targetId);
    const sourceValues = envMap(await this.textOf(source.id));
    const missing = unique.filter((k) => !sourceValues.has(k));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Not set in "${source.name}": ${missing.join(', ')}`,
      );
    }
    let summary: ChangeSummary | undefined;
    const saved = await this.transact(
      setId,
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
    return {
      environment: (await this.views([saved], access.ctx))[0],
      summary: summary as ChangeSummary,
    };
  }

  /**
   * Row-locked, optimistic write shared by every way of changing variables
   * (edit, set/unset/push, restore, promote). `fn` gets the locked row and
   * its current text and returns the saved row.
   */
  private async transact(
    setId: string,
    envId: string,
    expectedUpdatedAt: string | undefined,
    fn: (
      m: EntityManager,
      env: VariableSetEnvironment,
      oldText: string,
    ) => Promise<VariableSetEnvironment>,
  ): Promise<VariableSetEnvironment> {
    const expected =
      expectedUpdatedAt === undefined
        ? undefined
        : new Date(expectedUpdatedAt).getTime();
    if (expected !== undefined && Number.isNaN(expected)) {
      throw new BadRequestException('expectedUpdatedAt is not a valid date');
    }
    return this.repo.manager.transaction(async (m) => {
      // The row lock makes check-and-write atomic against a concurrent write.
      const env = await m.findOne(VariableSetEnvironment, {
        where: { id: envId, variableSetId: setId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!env) throw new NotFoundException('Environment not found');
      if (expected !== undefined && env.updatedAt.getTime() !== expected) {
        throw new ConflictException(
          `The "${env.name}" environment was changed by someone else; reload it and try again`,
        );
      }
      const row = await m.findOne(VariableSetEnvironment, {
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
    env: VariableSetEnvironment,
    oldText: string,
    text: string,
    flagPatch: Record<string, boolean | null>,
    ctx: { actor: EnvActor; action: VersionAction; detail: string | null },
  ): Promise<VariableSetEnvironment> {
    const previousFlags = env.secretFlags ?? {};
    const keys = keysOf(text);
    const flags = nextFlags(previousFlags, env.keys ?? [], keys, flagPatch);
    const summary = summarizeChange(oldText, text, previousFlags, flags);
    const changed =
      normalizeText(oldText) !== normalizeText(text) ||
      !sameFlags(previousFlags, flags);

    if (changed) {
      const existing = await m.count(VariableSetEnvironmentVersion, {
        where: { environmentId: env.id },
      });
      if (existing === 0 && oldText.trim()) {
        await m.insert(VariableSetEnvironmentVersion, {
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
      await m.insert(VariableSetEnvironmentVersion, {
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
        `DELETE FROM variable_set_environment_versions
         WHERE environment_id = $1 AND id NOT IN (
           SELECT id FROM variable_set_environment_versions
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
  ): Promise<VariableSetEnvironmentVersion> {
    const v = await m.findOne(VariableSetEnvironmentVersion, {
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
    setId: string,
    name: string,
  ): Promise<VariableSetEnvironment> {
    const env = await this.repo.findOne({
      where: { variableSetId: setId, name },
    });
    if (!env) throw new NotFoundException(`Environment "${name}" not found`);
    return env;
  }

  /** Adds an environment to a set (instance owner/admin; the route carries `@Roles`). */
  async create(
    userId: string,
    setId: string,
    name: string,
    isProtected = false,
  ): Promise<EnvironmentView> {
    const access = await this.access.loadForManage(userId, setId);
    this.access.assertTokenMayUse(access.set.slug, name);
    if (
      (await this.repo.count({ where: { variableSetId: setId } })) >=
      MAX_ENVIRONMENTS
    ) {
      throw new BadRequestException(
        `A variable set can have at most ${MAX_ENVIRONMENTS} environments`,
      );
    }
    if (await this.repo.exists({ where: { variableSetId: setId, name } })) {
      throw new ConflictException(`Environment "${name}" already exists`);
    }
    try {
      const saved = await this.repo.save(
        this.repo.create({
          variableSetId: setId,
          name,
          protected: isProtected,
          keys: [],
          secretFlags: {},
        }),
      );
      return this.view(saved, []);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`Environment "${name}" already exists`);
      }
      throw err;
    }
  }

  /**
   * Deletes an environment and its history (instance owner/admin; protected
   * ones included). Refused with 409 while any application or stack links it;
   * the message names them all (the caller is an instance owner/admin).
   */
  async remove(userId: string, setId: string, envId: string): Promise<void> {
    const access = await this.access.loadForManage(userId, setId);
    const env = await this.findInSet(envId, setId);
    this.access.assertTokenMayUse(access.set.slug, env.name);
    const used = (await this.usersOf([env.id], 'all')).get(env.id) ?? [];
    if (used.length > 0) {
      throw new ConflictException(
        `Environment "${env.name}" is still used by ${describeUsers(used)}; unlink it first`,
      );
    }
    try {
      await this.repo.delete({ id: env.id, variableSetId: setId });
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

  /** The environment, which must belong to the set (404 otherwise). */
  async findInSet(
    envId: string,
    setId: string,
  ): Promise<VariableSetEnvironment> {
    const env = await this.repo.findOne({
      where: { id: envId, variableSetId: setId },
    });
    if (!env) throw new NotFoundException('Environment not found');
    return env;
  }

  /**
   * Decrypted text and flags of each environment, in the given order (link
   * order), for the resolver. Missing ids are skipped. No actor, no role
   * check: deploy and background code call this.
   */
  async layersFor(environmentIds: string[]): Promise<VariableLayer[]> {
    if (environmentIds.length === 0) return [];
    const rows = await this.repo.find({
      where: { id: In(environmentIds) },
      select: { id: true, variablesEncrypted: true, secretFlags: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: VariableLayer[] = [];
    for (const id of environmentIds) {
      const row = byId.get(id);
      if (!row) continue;
      out.push({
        environmentId: id,
        text: row.variablesEncrypted
          ? decryptSecret(row.variablesEncrypted, this.key)
          : '',
        flags: row.secretFlags ?? {},
      });
    }
    return out;
  }

  /** For export: the environments of a set, with values only when asked. */
  async exportOf(
    setId: string,
    includeValues: boolean,
  ): Promise<ExportedEnvironment[]> {
    const out: ExportedEnvironment[] = [];
    for (const e of await this.listOf(setId)) {
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
   * Puts imported text (already normalized) on a new environment row. No
   * version is stored, like any other freshly imported content.
   */
  sealImported(
    row: VariableSetEnvironment,
    text: string,
    secretKeys: unknown,
    plainKeys: unknown,
  ): void {
    row.variablesEncrypted = text ? encryptSecret(text, this.key) : null;
    row.keys = keysOf(text);
    // Flags from the file (names only) apply to keys that exist; keys
    // without one get the name rule, like any newly added key.
    const patch: Record<string, boolean | null> = {};
    for (const k of Array.isArray(secretKeys) ? secretKeys : []) {
      if (typeof k === 'string') patch[k] = true;
    }
    for (const k of Array.isArray(plainKeys) ? plainKeys : []) {
      if (typeof k === 'string') patch[k] = false;
    }
    row.secretFlags = nextFlags({}, [], row.keys, patch);
  }

  /** Access check shared by every value operation. */
  private async guardValues(
    userId: string,
    setId: string,
    envId: string,
  ): Promise<{ env: VariableSetEnvironment; access: SetAccess }> {
    const access = await this.access.load(userId, setId);
    const env = await this.findInSet(envId, setId);
    this.access.assertValues(access, env);
    return { env, access };
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

  view(e: VariableSetEnvironment, usedBy: EnvironmentUser[]): EnvironmentView {
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

  /**
   * Applications and stacks linking these environments. Plain SQL: this
   * module cannot import the application or compose modules (they import
   * it). Limited to projects the caller may see (`ctx`); `'all'` = unfiltered.
   */
  async usersOf(
    envIds: string[],
    ctx: ProjectRoles | 'all',
  ): Promise<Map<string, EnvironmentUser[]>> {
    const out = new Map<string, EnvironmentUser[]>();
    if (envIds.length === 0) return out;
    const rows: Array<{
      environment_id: string;
      position: number;
      kind: EnvironmentUser['kind'];
      id: string;
      name: string;
      project_id: string;
      project_name: string;
    }> = await this.repo.query(
      `SELECT l.environment_id, l.position, 'application' AS kind, a.id, a.name,
              a.project_id, p.name AS project_name
       FROM variable_set_links l
       JOIN applications a ON a.id = l.application_id
       JOIN projects p ON p.id = a.project_id
       WHERE l.environment_id = ANY($1)
       UNION ALL
       SELECT l.environment_id, l.position, 'compose' AS kind, c.id, c.name,
              c.project_id, p.name AS project_name
       FROM variable_set_links l
       JOIN compose_apps c ON c.id = l.compose_app_id
       JOIN projects p ON p.id = c.project_id
       WHERE l.environment_id = ANY($1)
       ORDER BY project_name, name`,
      [envIds],
    );
    const visible = (projectId: string) =>
      ctx === 'all' || ctx.roles === 'all' || ctx.roles.has(projectId);
    for (const r of rows ?? []) {
      if (!visible(r.project_id)) continue;
      const list = out.get(r.environment_id) ?? [];
      list.push({
        kind: r.kind,
        id: r.id,
        name: r.name,
        projectId: r.project_id,
        projectName: r.project_name,
        position: Number(r.position),
      });
      out.set(r.environment_id, list);
    }
    return out;
  }
}

/** `application "web" (project "Shop")`, … for 409 messages. */
export function describeUsers(users: EnvironmentUser[]): string {
  return users
    .map(
      (u) =>
        `${u.kind === 'compose' ? 'stack' : 'application'} "${u.name}" (project "${u.projectName}")`,
    )
    .join(', ');
}

function rank(order: string[], name: string): number {
  const i = order.indexOf(name);
  return i === -1 ? order.length : i;
}

export function flagLists(flags: SecretFlags | null | undefined): {
  secretKeys: string[];
  plainKeys: string[];
} {
  const f = flags ?? {};
  return {
    secretKeys: Object.keys(f).filter((k) => f[k] === true),
    plainKeys: Object.keys(f).filter((k) => f[k] === false),
  };
}

function keysOfEnv(e: VariableSetEnvironment): string[] {
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
