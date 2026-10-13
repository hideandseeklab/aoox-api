import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { SetParamsDto, UpdateVariableSetDto } from '../variable-set.dto';
import { VariableSetDetail, VariableSetService } from '../variable-set.service';

@Controller('variable-sets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class UpdateVariableSetController {
  constructor(private readonly sets: VariableSetService) {}

  /** Name and description only; the slug never changes. */
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param() params: SetParamsDto,
    @Body() dto: UpdateVariableSetDto,
  ): Promise<VariableSetDetail> {
    return this.sets.update(user.sub, params.id, dto);
  }
}
