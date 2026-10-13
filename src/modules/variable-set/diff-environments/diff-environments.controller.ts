import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DiffQueryDto, SetParamsDto } from '../variable-set.dto';
import {
  EnvironmentDiff,
  VariableSetEnvironmentService,
} from '../variable-set-environment.service';

@Controller('variable-sets/:id')
@UseGuards(JwtAuthGuard)
export class DiffEnvironmentsController {
  constructor(private readonly environments: VariableSetEnvironmentService) {}

  /** Key-level comparison of two environments of the set by name; never values (see the service). */
  @Get('diff')
  diff(
    @CurrentUser() user: JwtPayload,
    @Param() params: SetParamsDto,
    @Query() query: DiffQueryDto,
  ): Promise<EnvironmentDiff> {
    return this.environments.diff(user.sub, params.id, query.from, query.to);
  }
}
