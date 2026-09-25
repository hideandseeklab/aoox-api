import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DatabaseParamsDto } from '../get-database/get-database.dto';
import {
  DatabaseConnection,
  ManagedDatabaseService,
} from '../managed-database.service';

/** Password and connection URLs, kept off GET /databases/:id so lists never carry secrets. */
@Controller('databases')
@UseGuards(JwtAuthGuard)
export class DatabaseCredentialsController {
  constructor(private readonly databases: ManagedDatabaseService) {}

  @Get(':id/credentials')
  async get(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<DatabaseConnection> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.databases.connection(db);
  }
}
