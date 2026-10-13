import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { SetParamsDto } from '../variable-set.dto';
import { VariableSetService } from '../variable-set.service';

@Controller('variable-sets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class DeleteVariableSetController {
  constructor(private readonly sets: VariableSetService) {}

  /** 409 naming every application and stack still linking it. */
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: SetParamsDto,
  ): Promise<void> {
    await this.sets.remove(user.sub, params.id);
  }
}
