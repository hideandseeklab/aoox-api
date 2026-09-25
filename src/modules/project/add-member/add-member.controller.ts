import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import {
  AddProjectMemberDto,
  ProjectMemberParamsDto,
} from '../project-member.dto';
import { ProjectMember } from '../project-member.entity';
import { AddMemberService } from './add-member.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class AddMemberController {
  constructor(private readonly service: AddMemberService) {}

  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  add(
    @CurrentUser() user: JwtPayload,
    @Param() params: ProjectMemberParamsDto,
    @Body() dto: AddProjectMemberDto,
  ): Promise<ProjectMember> {
    return this.service.execute(user.sub, params.id, dto);
  }
}
