import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProjectAccessService } from '../project/project-access.service';
import { Project } from '../project/project.entity';
import { keysOf } from './env-text';
import { VariableSetEnvironment } from './variable-set-environment.entity';
import { MAX_LINKS, VariableSetLink } from './variable-set-link.entity';
import { VariableSetProject } from './variable-set-project.entity';
import { VariableSet } from './variable-set.entity';

export type LinkOwnerKind = 'application' | 'compose';

/** An application or compose stack that receives variables. */
export interface LinkOwner {
  kind: LinkOwnerKind;
  /** Undefined before the row is saved (create). */
  id?: string;
  projectId: string;
}

/** One link as the API shows it (no values). */
export interface LinkView {
  /** 0-based; later links override earlier ones on the same key. */
  position: number;
  environmentId: string;
  environmentName: string;
  protected: boolean;
  setId: string;
  setName: string;
  setSlug: string;
  /** Variable names of that environment. */
  keys: string[];
  /** Notes of those variables (names to text; plaintext, never values). */
  notes: Record<string, string>;
  /** Keys a later link also defines: its value wins over this one. */
  shadowedKeys: string[];
  /** Keys the application's / stack's own env defines: it always wins. */
  overriddenByOwnEnv: string[];
}

/**
 * Pure: per link, which of its keys are overridden by a later link or by the
 * owner's own env. Computed from the plaintext key lists, never from values.
 */
export function linkConflicts(
  layers: Array<{ keys: string[] }>,
  ownKeys: string[],
): Array<{ shadowedKeys: string[]; overriddenByOwnEnv: string[] }> {
  const own = new Set(ownKeys);
  return layers.map((layer, i) => {
    const later = new Set(layers.slice(i + 1).flatMap((l) => l.keys));
    return {
      shadowedKeys: layer.keys.filter((k) => later.has(k)),
      overriddenByOwnEnv: layer.keys.filter((k) => own.has(k) && !later.has(k)),
    };
  });
}

/**
 * The ordered (set environment) links of applications and compose stacks.
 * Used by the application and compose modules; this module never imports
 * them (the link table's owner columns have SQL-only foreign keys).
 */
@Injectable()
export class VariableSetLinkService {
  constructor(
    @InjectRepository(VariableSetLink)
    readonly repo: Repository<VariableSetLink>,
    private readonly access: ProjectAccessService,
  ) {}

  private ownerWhere(kind: LinkOwnerKind, id: string) {
    return kind === 'application'
      ? { applicationId: id }
      : { composeAppId: id };
  }

  /** Environment ids linked to an owner, in order. Empty for an unsaved owner. */
  async environmentIdsFor(kind: LinkOwnerKind, id?: string): Promise<string[]> {
    if (!id) return [];
    const rows = await this.repo.find({
      where: this.ownerWhere(kind, id),
      order: { position: 'ASC' },
      select: { id: true, environmentId: true, position: true },
    });
    return rows.map((r) => r.environmentId);
  }

  /** The links of an owner (or the given environment ids) with set names and conflicts. */
  async views(
    owner: LinkOwner,
    ownEnv: string,
    environmentIds?: string[],
  ): Promise<LinkView[]> {
    const ids =
      environmentIds ?? (await this.environmentIdsFor(owner.kind, owner.id));
    if (ids.length === 0) return [];
    const envs = await this.repo.manager.find(VariableSetEnvironment, {
      where: { id: In(ids) },
    });
    const sets = await this.repo.manager.find(VariableSet, {
      where: { id: In([...new Set(envs.map((e) => e.variableSetId))]) },
    });
    const envById = new Map(envs.map((e) => [e.id, e]));
    const setById = new Map(sets.map((s) => [s.id, s]));
    const ordered = ids
      .map((id) => envById.get(id))
      .filter((e): e is VariableSetEnvironment => !!e);
    const conflicts = linkConflicts(
      ordered.map((e) => ({ keys: e.keys ?? [] })),
      keysOf(ownEnv ?? ''),
    );
    return ordered.map((e, i) => {
      const set = setById.get(e.variableSetId)!;
      return {
        position: i,
        environmentId: e.id,
        environmentName: e.name,
        protected: e.protected,
        setId: set.id,
        setName: set.name,
        setSlug: set.slug,
        keys: e.keys ?? [],
        notes: e.notes ?? {},
        ...conflicts[i],
      };
    });
  }

  /**
   * Validates a new ordered list for an owner (400/403), without saving:
   * - at most MAX_LINKS, each environment at most once;
   * - each environment exists and its set is shared with the owner's project
   *   (or with all projects);
   * - adding or removing a link to a protected environment needs the project
   *   `admin` role of the owner's project (a linked resource can read the
   *   values at runtime: console, logs, `docker inspect`). Reordering, and
   *   resending links that stay, is always fine.
   * `actorId` null = no role rule (project import, background code).
   */
  async validate(
    owner: LinkOwner,
    environmentIds: string[],
    actorId: string | null,
  ): Promise<void> {
    if (environmentIds.length > MAX_LINKS) {
      throw new BadRequestException(
        `At most ${MAX_LINKS} variable set environments can be linked`,
      );
    }
    if (new Set(environmentIds).size !== environmentIds.length) {
      throw new BadRequestException(
        'Each variable set environment can be linked only once',
      );
    }
    const current = await this.environmentIdsFor(owner.kind, owner.id);
    const envs =
      environmentIds.length > 0
        ? await this.repo.manager.find(VariableSetEnvironment, {
            where: { id: In(environmentIds) },
          })
        : [];
    if (envs.length !== environmentIds.length) {
      throw new BadRequestException(
        'Every link must name an environment of a variable set shared with this project',
      );
    }
    const setIds = [...new Set(envs.map((e) => e.variableSetId))];
    const [sets, shares] = await Promise.all([
      this.repo.manager.find(VariableSet, { where: { id: In(setIds) } }),
      this.repo.manager.find(VariableSetProject, {
        where: { variableSetId: In(setIds), projectId: owner.projectId },
      }),
    ]);
    const shared = new Set([
      ...sets.filter((s) => s.sharedWithAll).map((s) => s.id),
      ...shares.map((s) => s.variableSetId),
    ]);
    if (envs.some((e) => !shared.has(e.variableSetId))) {
      throw new BadRequestException(
        'Every link must name an environment of a variable set shared with this project',
      );
    }
    if (actorId === null) return;
    const added = envs.filter((e) => !current.includes(e.id));
    const removedIds = current.filter((id) => !environmentIds.includes(id));
    const removed =
      removedIds.length > 0
        ? await this.repo.manager.find(VariableSetEnvironment, {
            where: { id: In(removedIds) },
            select: { id: true, name: true, protected: true },
          })
        : [];
    const touched = [...added, ...removed].filter((e) => e.protected);
    if (touched.length === 0) return;
    const project = await this.repo.manager.findOne(Project, {
      where: { id: owner.projectId },
    });
    const role = project ? await this.access.roleFor(actorId, project) : null;
    if (role !== 'admin') {
      const e = touched[0];
      throw new ForbiddenException(
        added.includes(e)
          ? `Only project admins can link to the protected "${e.name}" environment`
          : `Only project admins can unlink the protected "${e.name}" environment`,
      );
    }
  }

  /** Replaces an owner's links with the given order (call `validate` first). */
  async replace(
    kind: LinkOwnerKind,
    id: string,
    environmentIds: string[],
  ): Promise<void> {
    await this.repo.manager.transaction(async (m) => {
      await m.delete(VariableSetLink, this.ownerWhere(kind, id));
      if (environmentIds.length === 0) return;
      await m.insert(
        VariableSetLink,
        environmentIds.map((environmentId, position) => ({
          environmentId,
          position,
          applicationId: kind === 'application' ? id : null,
          composeAppId: kind === 'compose' ? id : null,
        })),
      );
    });
  }
}
