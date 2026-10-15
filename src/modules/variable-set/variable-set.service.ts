import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { Project } from '../project/project.entity';
import { ProjectService } from '../project/project.service';
import {
  SetRole,
  setRoleFor,
  VariableSetAccessService,
  type ProjectRoles,
} from './variable-set-access.service';
import {
  describeUsers,
  EnvironmentUser,
  EnvironmentView,
  VariableSetEnvironmentService,
} from './variable-set-environment.service';
import { VariableSetProject } from './variable-set-project.entity';
import {
  slugifySetName,
  uniqueSetName,
  uniqueSetSlug,
} from './variable-set-names';
import { VARIABLE_SET_SLUG, VariableSet } from './variable-set.entity';

export interface ProjectRef {
  id: string;
  name: string;
}

export interface EnvironmentSummary {
  id: string;
  name: string;
  protected: boolean;
  keyCount: number;
  updatedAt: Date;
  /** Applications and stacks linking it (in projects the caller may see). */
  usedByCount: number;
}

interface SetBase {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sharedWithAll: boolean;
  /** Projects it is shared with explicitly; only those the caller may see. */
  projects: ProjectRef[];
  /** The caller's role on the set (see VariableSetAccessService). */
  role: SetRole;
  /** Instance owner/admin: may rename, share, delete, add/remove environments. */
  canManage: boolean;
  /** Distinct applications / stacks linking any of its environments (visible ones). */
  usage: { applications: number; composeApps: number };
  createdAt: Date;
  updatedAt: Date;
}

export interface VariableSetSummary extends SetBase {
  environments: EnvironmentSummary[];
}

export interface VariableSetDetail extends SetBase {
  environments: EnvironmentView[];
}

/** A set as the project page shows it: environments and this project's users only. */
export interface ProjectVariableSet {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sharedWithAll: boolean;
  environments: Array<{
    id: string;
    name: string;
    protected: boolean;
    keys: string[];
    /** Notes of those variables (plaintext; see `EnvironmentView.notes`). */
    notes: Record<string, string>;
  }>;
  /** Applications and stacks of this project linking one of its environments. */
  usedBy: Array<
    EnvironmentUser & { environmentId: string; environmentName: string }
  >;
}

export interface CreateSetInput {
  name: string;
  slug?: string;
  description?: string | null;
  sharedWithAll?: boolean;
  projectIds?: string[];
}

/**
 * Variable sets themselves: list, detail, create, rename/describe, share,
 * delete, and the per-project summary. Managing needs an instance
 * owner/admin (the routes also carry `@Roles`); listing and reading
 * names/keys is open to everyone the set is shared with.
 */
@Injectable()
export class VariableSetService {
  readonly sets: Repository<VariableSet>;

  constructor(
    private readonly access: VariableSetAccessService,
    private readonly environments: VariableSetEnvironmentService,
    private readonly projects: ProjectService,
  ) {
    this.sets = access.sets;
  }

  async list(userId: string): Promise<VariableSetSummary[]> {
    const ctx = await this.access.context(userId);
    const all = await this.sets.find({ order: { name: 'ASC' } });
    const shared = await this.access.sharedProjectIds(all.map((s) => s.id));
    const visible = all
      .map((set) => ({
        set,
        projectIds: shared.get(set.id) ?? [],
        role: setRoleFor(ctx, set, shared.get(set.id) ?? []),
      }))
      .filter((v): v is typeof v & { role: SetRole } => v.role !== null);
    if (visible.length === 0) return [];
    const envs = await this.environments.repo.find({
      where: { variableSetId: In(visible.map((v) => v.set.id)) },
      order: { createdAt: 'ASC' },
    });
    const users = await this.environments.usersOf(
      envs.map((e) => e.id),
      ctx,
    );
    const names = await this.projectNames(visible.flatMap((v) => v.projectIds));
    return visible.map(({ set, projectIds, role }) => {
      const own = sortEnvironments(
        envs.filter((e) => e.variableSetId === set.id),
      );
      const setUsers = own.flatMap((e) => users.get(e.id) ?? []);
      return {
        ...this.base(set, projectIds, role, ctx, names, setUsers),
        environments: own.map((e) => ({
          id: e.id,
          name: e.name,
          protected: e.protected,
          keyCount: (e.keys ?? []).length,
          updatedAt: e.updatedAt,
          usedByCount: (users.get(e.id) ?? []).length,
        })),
      };
    });
  }

  async detail(userId: string, setId: string): Promise<VariableSetDetail> {
    const { set, projectIds, role, ctx } = await this.access.load(
      userId,
      setId,
    );
    const envs = await this.environments.listOf(set.id);
    const views = await this.environments.views(envs, ctx);
    const names = await this.projectNames(projectIds);
    return {
      ...this.base(
        set,
        projectIds,
        role,
        ctx,
        names,
        views.flatMap((v) => v.usedBy),
      ),
      environments: views,
    };
  }

  /** Creates a set with development, staging and production (protected). */
  async create(
    userId: string,
    input: CreateSetInput,
  ): Promise<VariableSetDetail> {
    const ctx = await this.access.context(userId);
    if (!ctx.platform) {
      throw new ForbiddenException(
        'Only instance owners and admins can create variable sets',
      );
    }
    const name = input.name.trim();
    if (!name) throw new BadRequestException('name must not be empty');
    if (await this.nameTaken(name)) {
      throw new ConflictException(
        `A variable set named "${name}" already exists`,
      );
    }
    let slug: string;
    if (input.slug) {
      slug = input.slug;
      if (!VARIABLE_SET_SLUG.test(slug)) {
        throw new BadRequestException(
          'slug must be 1-64 lowercase letters, digits and -, not starting or ending with -',
        );
      }
      if (await this.sets.exists({ where: { slug } })) {
        throw new ConflictException(`The slug "${slug}" is already used`);
      }
    } else {
      const taken = (await this.sets.find({ select: { slug: true } })).map(
        (s) => s.slug,
      );
      slug = uniqueSetSlug(slugifySetName(name), taken);
    }
    const projectIds = await this.existingProjects(input.projectIds ?? []);
    let id = '';
    try {
      await this.sets.manager.transaction(async (m) => {
        const saved = await m.save(
          m.create(VariableSet, {
            name,
            slug,
            description: input.description?.trim() || null,
            sharedWithAll: input.sharedWithAll ?? false,
          }),
        );
        id = saved.id;
        if (projectIds.length > 0) {
          await m.insert(
            VariableSetProject,
            projectIds.map((projectId) => ({ variableSetId: id, projectId })),
          );
        }
        await this.environments.ensureDefaults(id, m);
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(
          'A variable set with this name or slug already exists',
        );
      }
      throw err;
    }
    return this.detail(userId, id);
  }

  /** Renames or re-describes a set. The slug never changes (token scopes use it). */
  async update(
    userId: string,
    setId: string,
    input: { name?: string; description?: string | null },
  ): Promise<VariableSetDetail> {
    const { set } = await this.access.loadForManage(userId, setId);
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('name must not be empty');
      if (
        name.toLowerCase() !== set.name.toLowerCase() &&
        (await this.nameTaken(name))
      ) {
        throw new ConflictException(
          `A variable set named "${name}" already exists`,
        );
      }
      set.name = name;
    }
    if (input.description !== undefined) {
      set.description = input.description?.trim() || null;
    }
    try {
      await this.sets.save(set);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(
          `A variable set named "${set.name}" already exists`,
        );
      }
      throw err;
    }
    return this.detail(userId, setId);
  }

  /**
   * Who the set is shared with. Taking access away from a project whose
   * applications or stacks still link the set is refused with 409 naming them
   * (unlink first), so a deploy never meets a set its project cannot see.
   */
  async share(
    userId: string,
    setId: string,
    sharedWithAll: boolean,
    projectIdsIn: string[],
  ): Promise<VariableSetDetail> {
    const { set } = await this.access.loadForManage(userId, setId);
    const projectIds = await this.existingProjects(projectIdsIn);
    if (!sharedWithAll) {
      const keep = new Set(projectIds);
      const users = await this.usersOfSet(set.id);
      const losing = users.filter((u) => !keep.has(u.projectId));
      if (losing.length > 0) {
        throw new ConflictException(
          `Still linked by ${describeUsers(losing)}; unlink them before taking access away from their project`,
        );
      }
    }
    await this.sets.manager.transaction(async (m) => {
      await m.update(VariableSet, { id: set.id }, { sharedWithAll });
      await m.delete(VariableSetProject, { variableSetId: set.id });
      if (projectIds.length > 0) {
        await m.insert(
          VariableSetProject,
          projectIds.map((projectId) => ({ variableSetId: set.id, projectId })),
        );
      }
    });
    return this.detail(userId, setId);
  }

  /** Deletes a set with its environments and history; 409 while anything links it. */
  async remove(userId: string, setId: string): Promise<void> {
    const { set } = await this.access.loadForManage(userId, setId);
    const users = await this.usersOfSet(set.id);
    if (users.length > 0) {
      throw new ConflictException(
        `Variable set "${set.name}" is still used by ${describeUsers(users)}; unlink it first`,
      );
    }
    try {
      await this.sets.delete({ id: set.id });
    } catch (err) {
      if ((err as { code?: string }).code === '23503') {
        throw new ConflictException(
          `Variable set "${set.name}" is still in use`,
        );
      }
      throw err;
    }
  }

  /** Sets shared with a project (explicitly or with all), with that project's users. */
  async forProject(
    userId: string,
    projectId: string,
  ): Promise<ProjectVariableSet[]> {
    await this.projects.findOwnedOrFail(projectId, userId);
    const sets = await this.sets
      .createQueryBuilder('s')
      .where(
        `s.shared_with_all OR EXISTS (SELECT 1 FROM variable_set_projects vp
          WHERE vp.variable_set_id = s.id AND vp.project_id = :projectId)`,
        { projectId },
      )
      .orderBy('s.name', 'ASC')
      .getMany();
    if (sets.length === 0) return [];
    const envs = sortEnvironments(
      await this.environments.repo.find({
        where: { variableSetId: In(sets.map((s) => s.id)) },
        order: { createdAt: 'ASC' },
      }),
    );
    const users = await this.environments.usersOf(
      envs.map((e) => e.id),
      'all',
    );
    return sets.map((s) => {
      const own = envs.filter((e) => e.variableSetId === s.id);
      return {
        id: s.id,
        name: s.name,
        slug: s.slug,
        description: s.description,
        sharedWithAll: s.sharedWithAll,
        environments: own.map((e) => ({
          id: e.id,
          name: e.name,
          protected: e.protected,
          keys: e.keys ?? [],
          notes: e.notes ?? {},
        })),
        usedBy: own.flatMap((e) =>
          (users.get(e.id) ?? [])
            .filter((u) => u.projectId === projectId)
            .map((u) => ({
              ...u,
              environmentId: e.id,
              environmentName: e.name,
            })),
        ),
      };
    });
  }

  private async usersOfSet(setId: string): Promise<EnvironmentUser[]> {
    const envs = await this.environments.repo.find({
      where: { variableSetId: setId },
      select: { id: true },
    });
    const users = await this.environments.usersOf(
      envs.map((e) => e.id),
      'all',
    );
    const seen = new Set<string>();
    const out: EnvironmentUser[] = [];
    for (const list of users.values()) {
      for (const u of list) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        out.push(u);
      }
    }
    return out;
  }

  private base(
    set: VariableSet,
    projectIds: string[],
    role: SetRole,
    ctx: ProjectRoles,
    names: Map<string, string>,
    users: EnvironmentUser[],
  ): SetBase {
    const visible = projectIds.filter(
      (id) => ctx.roles === 'all' || ctx.roles.has(id),
    );
    const distinct = (kind: EnvironmentUser['kind']) =>
      new Set(users.filter((u) => u.kind === kind).map((u) => u.id)).size;
    return {
      id: set.id,
      name: set.name,
      slug: set.slug,
      description: set.description,
      sharedWithAll: set.sharedWithAll,
      projects: visible
        .filter((id) => names.has(id))
        .map((id) => ({ id, name: names.get(id)! }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      role,
      canManage: role === 'platform',
      usage: {
        applications: distinct('application'),
        composeApps: distinct('compose'),
      },
      createdAt: set.createdAt,
      updatedAt: set.updatedAt,
    };
  }

  private async projectNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.sets.manager.find(Project, {
      where: { id: In(unique) },
      select: { id: true, name: true },
    });
    return new Map(rows.map((p) => [p.id, p.name]));
  }

  private async existingProjects(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const found = await this.sets.manager.find(Project, {
      where: { id: In(unique) },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new BadRequestException('projectIds contains an unknown project');
    }
    return unique;
  }

  private async nameTaken(name: string): Promise<boolean> {
    // Case-insensitive, like the deduplication of migrated and imported names.
    const all = await this.sets.find({ select: { id: true, name: true } });
    return (
      uniqueSetName(
        name,
        all.map((s) => s.name),
      ) !== name
    );
  }
}

const ORDER = ['development', 'staging', 'production'];

function sortEnvironments<T extends { name: string }>(envs: T[]): T[] {
  const rank = (n: string) => {
    const i = ORDER.indexOf(n);
    return i === -1 ? ORDER.length : i;
  };
  return [...envs].sort((a, b) => rank(a.name) - rank(b.name));
}
