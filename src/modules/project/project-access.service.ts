import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { currentTokenScope, isWriteRequest } from '../auth/request-context';
import { User } from '../user/user.entity';
import { ProjectMember, ProjectRole } from './project-member.entity';
import { Project } from './project.entity';

/**
 * Who may see which project. One rule set, used by every `findOwnedOrFail`
 * and every list, so a new resource type only has to call it:
 * - platform `owner`/`admin` → every project (they run the instance);
 * - the project's creator (`owner_id`) → that project, as `admin`;
 * - anyone else → only projects with a `project_members` row.
 * A project the actor may not see is reported as **404**, like a missing
 * one, so ids never leak. Background work (schedulers, watchers, runners)
 * has no actor and keeps using the repositories directly.
 */
@Injectable()
export class ProjectAccessService {
  constructor(
    @InjectRepository(ProjectMember)
    readonly members: Repository<ProjectMember>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
  ) {}

  private async platformRole(userId: string): Promise<User['role'] | null> {
    const u = await this.members.manager.findOne(User, {
      where: { id: userId },
      select: { id: true, role: true },
    });
    return u?.role ?? null;
  }

  /** `'all'` for platform owners/admins, otherwise the ids the user belongs to (created or member). */
  async accessibleProjectIds(userId: string): Promise<'all' | string[]> {
    // An API token's project scope can only narrow, never widen.
    const scope = currentTokenScope()?.projectIds ?? null;
    const role = await this.platformRole(userId);
    if (role === 'owner' || role === 'admin') return scope ?? 'all';
    const [owned, member] = await Promise.all([
      this.projects.find({ where: { ownerId: userId }, select: { id: true } }),
      this.members.find({ where: { userId }, select: { projectId: true } }),
    ]);
    const own = new Set([
      ...owned.map((p) => p.id),
      ...member.map((m) => m.projectId),
    ]);
    return scope ? scope.filter((id) => own.has(id)) : [...own];
  }

  /** TypeORM `where` fragment restricting a `projects` query to what the user may see. */
  async whereAccessible(
    userId: string,
  ): Promise<{ id?: ReturnType<typeof In<string>> }> {
    const ids = await this.accessibleProjectIds(userId);
    return ids === 'all' ? {} : { id: In(ids) };
  }

  /** The user's role inside a project, or null when they may not see it. */
  async roleFor(userId: string, project: Project): Promise<ProjectRole | null> {
    // A token limited to other projects sees nothing here, whoever owns it.
    const scope = currentTokenScope()?.projectIds;
    if (scope && !scope.includes(project.id)) return null;
    const role = await this.platformRole(userId);
    if (role === 'owner' || role === 'admin') return 'admin';
    if (project.ownerId === userId) return 'admin';
    const m = await this.members.findOne({
      where: { projectId: project.id, userId },
    });
    return m?.role ?? null;
  }

  /**
   * 404 unless the user may see the project; 403 when a `viewer` is on a
   * request that changes something. The write check is derived from the
   * HTTP method (see request-context.ts), so it covers every project-scoped
   * endpoint without each one repeating it, and never fires in background work.
   */
  async assertAccess(userId: string, project: Project): Promise<ProjectRole> {
    const role = await this.roleFor(userId, project);
    if (!role) throw new NotFoundException('Project not found');
    if (role === 'viewer' && isWriteRequest()) {
      throw new ForbiddenException(
        'Viewers have read-only access to this project',
      );
    }
    return role;
  }

  /** 404 for outsiders, 403 for members who are not project admins. */
  async assertAdmin(userId: string, project: Project): Promise<void> {
    const role = await this.assertAccess(userId, project);
    if (role !== 'admin') {
      throw new ForbiddenException('Only project admins can do this');
    }
  }
}
