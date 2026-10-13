import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ProjectParamsDto } from '../variable-set.dto';
import {
  ProjectVariableSet,
  VariableSetService,
} from '../variable-set.service';

@Controller('projects/:id/variable-sets')
@UseGuards(JwtAuthGuard)
export class ListProjectVariableSetsController {
  constructor(private readonly sets: VariableSetService) {}

  /** Sets shared with the project and which of its applications/stacks use them. */
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ProjectParamsDto,
  ): Promise<ProjectVariableSet[]> {
    return this.sets.forProject(user.sub, params.id);
  }
}
