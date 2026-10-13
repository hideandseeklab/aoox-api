import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { SetParamsDto } from '../variable-set.dto';
import { VariableSetDetail, VariableSetService } from '../variable-set.service';

@Controller('variable-sets')
@UseGuards(JwtAuthGuard)
export class GetVariableSetController {
  constructor(private readonly sets: VariableSetService) {}

  /** Names, keys, flags and usage; never values. 404 when not shared with the caller. */
  @Get(':id')
  get(
    @CurrentUser() user: JwtPayload,
    @Param() params: SetParamsDto,
  ): Promise<VariableSetDetail> {
    return this.sets.detail(user.sub, params.id);
  }
}
