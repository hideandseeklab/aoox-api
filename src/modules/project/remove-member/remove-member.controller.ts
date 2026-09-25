import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ProjectMemberUserParamsDto } from '../project-member.dto';
import { ProjectService } from '../project.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class RemoveMemberController {
  constructor(private readonly projects: ProjectService) {}

  /** Removes an explicit member (project admins only; implicit members have no row). */
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: ProjectMemberUserParamsDto,
  ): Promise<void> {
    const project = await this.projects.findOwnedOrFail(params.id, user.sub);
    await this.projects.access.assertAdmin(user.sub, project);
    const members = this.projects.access.members;
    const row = await members.findOne({
      where: { projectId: project.id, userId: params.userId },
    });
    if (!row) throw new NotFoundException('Member not found');
    await members.remove(row);
  }
}
