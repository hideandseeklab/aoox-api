import { Injectable } from '@nestjs/common';
import { User } from '../../user/user.entity';
import {
  ProjectMemberDto,
  ProjectMembersResponseDto,
} from '../project-member.dto';
import { ProjectService } from '../project.service';

@Injectable()
export class ListMembersService {
  constructor(private readonly projects: ProjectService) {}

  /** Explicit rows plus the implicit members (creator, platform owners/admins). */
  async execute(
    ownerId: string,
    projectId: string,
  ): Promise<ProjectMembersResponseDto> {
    const project = await this.projects.findOwnedOrFail(projectId, ownerId);
    const myRole = (await this.projects.access.roleFor(ownerId, project))!;
    const rows = await this.projects.access.members.find({
      where: { projectId: project.id },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });
    const explicit = new Map(rows.map((r) => [r.userId, r] as const));
    const implicitUsers = await this.projects.repo.manager.find(User, {
      order: { createdAt: 'ASC' },
    });
    const members: ProjectMemberDto[] = [];
    for (const u of implicitUsers) {
      const row = explicit.get(u.id);
      const implicit =
        u.role === 'owner' || u.role === 'admin' || u.id === project.ownerId;
      if (!row && !implicit) continue;
      members.push({
        userId: u.id,
        email: u.email,
        name: u.name ?? '',
        platformRole: u.role,
        role: implicit ? 'admin' : row!.role,
        implicit,
      });
    }
    return { myRole, members };
  }
}
