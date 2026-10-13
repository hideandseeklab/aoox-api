import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { SetParamsDto, ShareVariableSetDto } from '../variable-set.dto';
import { VariableSetDetail, VariableSetService } from '../variable-set.service';

@Controller('variable-sets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ShareVariableSetController {
  constructor(private readonly sets: VariableSetService) {}

  /** Replaces who the set is shared with; taking it away from a project that still links it is 409. */
  @Put(':id/sharing')
  share(
    @CurrentUser() user: JwtPayload,
    @Param() params: SetParamsDto,
    @Body() dto: ShareVariableSetDto,
  ): Promise<VariableSetDetail> {
    return this.sets.share(
      user.sub,
      params.id,
      dto.sharedWithAll,
      dto.projectIds,
    );
  }
}
