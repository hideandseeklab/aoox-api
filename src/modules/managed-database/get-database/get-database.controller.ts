import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DatabaseParamsDto } from './get-database.dto';
import {
  GetDatabaseService,
  ManagedDatabaseDetail,
} from './get-database.service';

@Controller('databases')
@UseGuards(JwtAuthGuard)
export class GetDatabaseController {
  constructor(private readonly service: GetDatabaseService) {}

  @Get(':id')
  get(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<ManagedDatabaseDetail> {
    return this.service.execute(user.sub, params.id);
  }
}
