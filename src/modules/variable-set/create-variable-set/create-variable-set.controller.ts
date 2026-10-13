import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { CreateVariableSetDto } from '../variable-set.dto';
import { VariableSetDetail, VariableSetService } from '../variable-set.service';

@Controller('variable-sets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class CreateVariableSetController {
  constructor(private readonly sets: VariableSetService) {}

  /** Creates the set with development, staging and production (protected). */
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVariableSetDto,
  ): Promise<VariableSetDetail> {
    return this.sets.create(user.sub, dto);
  }
}
