import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DatabaseParamsDto } from '../get-database/get-database.dto';
import { ManagedDatabaseService } from '../managed-database.service';
import { DeleteDatabaseQueryDto } from './delete-database.dto';

@Controller('databases')
@UseGuards(JwtAuthGuard)
export class DeleteDatabaseController {
  constructor(private readonly databases: ManagedDatabaseService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
    @Query() query: DeleteDatabaseQueryDto,
  ): Promise<void> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    await this.databases.remove(db, query.purge === 'true');
    await this.databases.repo.remove(db);
  }
}
