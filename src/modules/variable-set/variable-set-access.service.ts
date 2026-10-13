import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { currentTokenScope } from '../auth/request-context';
import { ProjectAccessService } from '../project/project-access.service';
import type { ProjectRole } from '../project/project-member.entity';
import { VariableSetEnvironment } from './variable-set-environment.entity';
import { VariableSetProject } from './variable-set-project.entity';
import { VariableSet } from './variable-set.entity';
import { variableScopeAllows } from './variable-scope';

/**
 * The caller's role on a set: `platform` = instance owner/admin (manages
 * sets, reads protected environments); otherwise the best project role the
 * caller holds in a project the set is shared with.
 */
export type SetRole = 'platform' | ProjectRole;

export type ProjectRoles = Awaited<
  ReturnType<ProjectAccessService['projectRoles']>
>;

export interface SetAccess {
  set: VariableSet;
  /** Projects the set is shared with explicitly (all of them, not filtered). */
  projectIds: string[];
  role: SetRole;
  ctx: ProjectRoles;
}

const RANK: Record<ProjectRole, number> = { viewer: 1, developer: 2, admin: 3 };

/**
 * Pure: the caller's role on a set, or null when the set is not visible to
 * them (not shared with any project they may see). An unscoped platform
 * owner/admin sees every set, including ones shared with nobody.
 */
export function setRoleFor(
  ctx: ProjectRoles,
  set: Pick<VariableSet, 'sharedWithAll'>,
  projectIds: string[],
): SetRole | null {
  if (ctx.roles === 'all') return 'platform';
  const candidates = set.sharedWithAll
    ? [...ctx.roles.keys()]
    : projectIds.filter((id) =>
        (ctx.roles as Map<string, ProjectRole>).has(id),
      );
  if (candidates.length === 0) return null;
  if (ctx.platform) return 'platform';
  let best: ProjectRole | null = null;
  for (const id of candidates) {
    const r = ctx.roles.get(id)!;
    if (!best || RANK[r] > RANK[best]) best = r;
  }
  return best;
}

/**
 * Who may see and do what with variable sets. Set routes carry no project id,
 * so the project write rule of `assertAccess` never fires on them: every
 * value operation checks viewers here explicitly.
 */
@Injectable()
export class VariableSetAccessService {
  constructor(
    @InjectRepository(VariableSet)
    readonly sets: Repository<VariableSet>,
    @InjectRepository(VariableSetProject)
    readonly shares: Repository<VariableSetProject>,
    readonly projects: ProjectAccessService,
  ) {}

  context(userId: string): Promise<ProjectRoles> {
    return this.projects.projectRoles(userId);
  }

  async sharedProjectIds(setIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>(setIds.map((id) => [id, []]));
    if (setIds.length === 0) return out;
    const rows = await this.shares.find({
      where: { variableSetId: In(setIds) },
    });
    for (const r of rows) out.get(r.variableSetId)?.push(r.projectId);
    return out;
  }

  /** The set with the caller's role; 404 when it does not exist or is not visible. */
  async load(userId: string, setId: string): Promise<SetAccess> {
    const set = await this.sets.findOne({ where: { id: setId } });
    if (!set) throw new NotFoundException('Variable set not found');
    const ctx = await this.context(userId);
    const projectIds = (await this.sharedProjectIds([set.id])).get(set.id)!;
    const role = setRoleFor(ctx, set, projectIds);
    if (!role) throw new NotFoundException('Variable set not found');
    return { set, projectIds, role, ctx };
  }

  /** Platform owner/admin only (management routes also carry `@Roles`). */
  async loadForManage(userId: string, setId: string): Promise<SetAccess> {
    const access = await this.load(userId, setId);
    if (access.role !== 'platform') {
      throw new ForbiddenException(
        'Only instance owners and admins can manage variable sets',
      );
    }
    return access;
  }

  /** Whether the caller may read (and therefore edit) this environment's values. */
  mayUseValues(access: SetAccess, env: VariableSetEnvironment): boolean {
    if (access.role === 'viewer') return false;
    if (env.protected && access.role !== 'platform') return false;
    return this.tokenMayUse(access.set.slug, env.name);
  }

  /**
   * Same rule as `mayUseValues`, with the reason as a 403. Order matters:
   * the POST reveal routes are read-only for the request rules (so read-only
   * API tokens can pull variables), hence viewers are refused here.
   */
  assertValues(access: SetAccess, env: VariableSetEnvironment): void {
    if (access.role === 'viewer') {
      throw new ForbiddenException(
        'Viewers cannot read or change variable values',
      );
    }
    this.assertTokenMayUse(access.set.slug, env.name);
    if (env.protected && access.role !== 'platform') {
      throw new ForbiddenException(
        `Only instance owners and admins can read or change the values of the protected "${env.name}" environment`,
      );
    }
  }

  tokenMayUse(setSlug: string, envName: string): boolean {
    return variableScopeAllows(
      currentTokenScope()?.variableScopes,
      setSlug,
      envName,
    );
  }

  assertTokenMayUse(setSlug: string, envName: string): void {
    if (!this.tokenMayUse(setSlug, envName)) {
      const scopes = currentTokenScope()?.variableScopes ?? [];
      throw new ForbiddenException(
        `This API token is limited to ${scopes.join(', ')}`,
      );
    }
  }
}
