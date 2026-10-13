import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import {
  VariableSetService,
  VariableSetSummary,
} from '../variable-set.service';

@Controller('variable-sets')
@UseGuards(JwtAuthGuard)
export class ListVariableSetsController {
  constructor(private readonly sets: VariableSetService) {}

  /** Sets visible to the caller (no `@Roles`: project members see the ones shared with them). */
  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<VariableSetSummary[]> {
    return this.sets.list(user.sub);
  }
}
