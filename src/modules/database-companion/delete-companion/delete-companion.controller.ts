import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ManagedDatabaseService } from '../../managed-database/managed-database.service';
import { CompanionParamsDto } from '../companion.dto';
import { DatabaseCompanionService } from '../database-companion.service';

@Controller('databases')
@UseGuards(JwtAuthGuard)
export class DeleteCompanionController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly companions: DatabaseCompanionService,
  ) {}

  @Delete(':id/companion')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: CompanionParamsDto,
  ): Promise<void> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    await this.companions.remove(db);
  }
}
