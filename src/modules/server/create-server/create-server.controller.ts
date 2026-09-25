import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import type { ServerDto } from '../server.service';
import { CreateServerDto } from './create-server.dto';
import { CreateServerService } from './create-server.service';

@Controller('servers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class CreateServerController {
  constructor(private readonly service: CreateServerService) {}

  @Post()
  create(@Body() dto: CreateServerDto): Promise<ServerDto> {
    return this.service.execute(dto);
  }
}
