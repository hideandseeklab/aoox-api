import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ManagedDatabase } from '../managed-database.entity';
import { CreateDatabaseDto } from './create-database.dto';
import { CreateDatabaseService } from './create-database.service';

@Controller('databases')
@UseGuards(JwtAuthGuard)
export class CreateDatabaseController {
  constructor(private readonly service: CreateDatabaseService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDatabaseDto,
  ): Promise<ManagedDatabase> {
    return this.service.execute(user.sub, dto);
  }
}
