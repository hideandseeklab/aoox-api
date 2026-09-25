import {
  Body,
  Controller,
  Delete,
  Get,
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
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { DatabaseParamsDto } from '../get-database/get-database.dto';
import { ManagedDatabaseService } from '../managed-database.service';
import { CreateSchemaDto, SchemaInfoDto, SchemaParamsDto } from './schemas.dto';
import { SchemasService } from './schemas.service';

/** Databases inside one managed server. Listing is for everyone; changes owner/admin. */
@Controller('databases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class SchemasController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly schemas: SchemasService,
  ) {}

  @Get(':id/schemas')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<SchemaInfoDto[]> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.schemas.list(db);
  }

  @Post(':id/schemas')
  @Roles('owner', 'admin')
  async create(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
    @Body() dto: CreateSchemaDto,
  ): Promise<SchemaInfoDto> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.schemas.create(db, dto.name);
  }

  @Delete(':id/schemas/:name')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async drop(
    @CurrentUser() user: JwtPayload,
    @Param() params: SchemaParamsDto,
  ): Promise<void> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    await this.schemas.drop(db, params.name);
  }
}
