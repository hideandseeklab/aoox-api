import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DatabaseParamsDto } from '../get-database/get-database.dto';
import { CreateDatabaseLogTicketResponseDto } from './create-database-log-ticket.dto';
import { CreateDatabaseLogTicketService } from './create-database-log-ticket.service';

@Controller('databases')
@UseGuards(JwtAuthGuard)
export class CreateDatabaseLogTicketController {
  constructor(private readonly service: CreateDatabaseLogTicketService) {}

  @Post(':id/log-ticket')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  create(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<CreateDatabaseLogTicketResponseDto> {
    return this.service.execute(user.sub, params.id);
  }
}
