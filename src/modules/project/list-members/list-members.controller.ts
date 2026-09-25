import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import {
  ProjectMemberParamsDto,
  ProjectMembersResponseDto,
} from '../project-member.dto';
import { ListMembersService } from './list-members.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ListMembersController {
  constructor(private readonly service: ListMembersService) {}

  @Get(':id/members')
  list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ProjectMemberParamsDto,
  ): Promise<ProjectMembersResponseDto> {
    return this.service.execute(user.sub, params.id);
  }
}
