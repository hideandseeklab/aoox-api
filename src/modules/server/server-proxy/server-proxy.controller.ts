import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { IsBooleanString, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { ProxyService, ProxyStatus } from '../../proxy/proxy.service';
import { RemoteDockerService } from '../remote-docker.service';
import { proxySettingsOf } from '../server.entity';
import { ServerService } from '../server.service';
import {
  ProvisionServerProxyDto,
  ServerProxyParamsDto,
} from './server-proxy.dto';

class RemoveQueryDto {
  @IsOptional()
  @IsBooleanString()
  purge?: string;
}

/**
 * Traefik on a remote server: same container/labels as on the host, but
 * ports and ACME come from the server row. Apps deployed to the server get
 * routed by it (domains, HTTPS) once it runs.
 */
@Controller('servers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ServerProxyController {
  constructor(
    private readonly servers: ServerService,
    private readonly remote: RemoteDockerService,
    private readonly proxy: ProxyService,
  ) {}

  @Get(':id/proxy')
  async status(@Param() params: ServerProxyParamsDto): Promise<ProxyStatus> {
    const server = await this.servers.findOrFail(params.id);
    const docker = await this.remote.forServer(server.id);
    return this.proxy.statusOn(docker, proxySettingsOf(server));
  }

  /** (Re)provisions with the given settings; an existing proxy is replaced so new settings apply. */
  @Post(':id/proxy')
  async provision(
    @Param() params: ServerProxyParamsDto,
    @Body() dto: ProvisionServerProxyDto,
  ): Promise<ProxyStatus> {
    const server = await this.servers.findOrFail(params.id);
    if (dto.httpPort !== undefined) server.proxyHttpPort = dto.httpPort;
    if (dto.httpsPort !== undefined) server.proxyHttpsPort = dto.httpsPort;
    if (dto.acmeEmail !== undefined) server.acmeEmail = dto.acmeEmail;
    if (dto.acmeStaging !== undefined) server.acmeStaging = dto.acmeStaging;
    await this.servers.repo.save(server);
    const docker = await this.remote.forServer(server.id);
    if (!(await docker.ping())) {
      throw new ServiceUnavailableException(
        'Docker on the server is not reachable',
      );
    }
    await this.proxy.provisionOn(docker, proxySettingsOf(server));
    return this.proxy.statusOn(docker, proxySettingsOf(server));
  }

  @Delete(':id/proxy')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param() params: ServerProxyParamsDto,
    @Query() query: RemoveQueryDto,
  ): Promise<void> {
    const server = await this.servers.findOrFail(params.id);
    const docker = await this.remote.forServer(server.id);
    await this.proxy.removeOn(docker, query.purge === 'true');
  }
}
