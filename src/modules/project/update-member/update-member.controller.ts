import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import {
  ProjectMemberUserParamsDto,
  UpdateProjectMemberDto,
} from '../project-member.dto';
import { ProjectMember } from '../project-member.entity';
import { ProjectService } from '../project.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class UpdateMemberController {
  constructor(private readonly projects: ProjectService) {}

  /** Changes an explicit member's project role (project admins only). */
  @Patch(':id/members/:userId')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param() params: ProjectMemberUserParamsDto,
    @Body() dto: UpdateProjectMemberDto,
  ): Promise<ProjectMember> {
    const project = await this.projects.findOwnedOrFail(params.id, user.sub);
    await this.projects.access.assertAdmin(user.sub, project);
    const members = this.projects.access.members;
    const row = await members.findOne({
      where: { projectId: project.id, userId: params.userId },
    });
    if (!row) throw new NotFoundException('Member not found');
    row.role = dto.role;
    return members.save(row);
  }
}
