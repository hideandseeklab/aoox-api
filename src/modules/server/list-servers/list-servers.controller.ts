import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import type { ServerDto } from '../server.service';
import { ServerService } from '../server.service';

/** Shell targets are owner/admin territory, so the list is too. */
@Controller('servers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ListServersController {
  constructor(private readonly servers: ServerService) {}

  @Get()
  async list(): Promise<ServerDto[]> {
    const rows = await this.servers.listWithKeyFlag();
    return rows.map((r) => this.servers.toDto(r.server, r.hasOwnKey));
  }
}
