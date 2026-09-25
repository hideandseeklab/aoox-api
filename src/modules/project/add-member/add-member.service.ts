import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User } from '../../user/user.entity';
import { AddProjectMemberDto } from '../project-member.dto';
import { ProjectMember } from '../project-member.entity';
import { ProjectService } from '../project.service';

/** Adds an existing user (by e-mail) to the project. Project admins only. */
@Injectable()
export class AddMemberService {
  constructor(private readonly projects: ProjectService) {}

  async execute(
    ownerId: string,
    projectId: string,
    dto: AddProjectMemberDto,
  ): Promise<ProjectMember> {
    const project = await this.projects.findOwnedOrFail(projectId, ownerId);
    await this.projects.access.assertAdmin(ownerId, project);
    const user = await this.projects.repo.manager.findOne(User, {
      where: { email: dto.email.trim().toLowerCase() },
    });
    if (!user) {
      throw new NotFoundException(
        'No user with that e-mail; invite them from Settings first',
      );
    }
    if (user.role !== 'member' || user.id === project.ownerId) {
      throw new BadRequestException(
        'That user already sees every project (platform owner/admin or project creator)',
      );
    }
    const members = this.projects.access.members;
    if (
      await members.findOne({
        where: { projectId: project.id, userId: user.id },
      })
    ) {
      throw new ConflictException('Already a member of this project');
    }
    return members.save(
      members.create({
        projectId: project.id,
        userId: user.id,
        role: dto.role,
      }),
    );
  }
}
