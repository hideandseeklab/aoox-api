import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { ApplicationService, containerNameFor } from '../application.service';
import { ConsoleTicketPayload } from '../console.protocol';
import { SwarmDeployService } from '../swarm-deploy.service';
import {
  CreateConsoleTicketDto,
  CreateConsoleTicketResponseDto,
} from './create-console-ticket.dto';

export const CONSOLE_TICKET_TTL_SECONDS = 60;

/**
 * Short-lived ticket for the `/console` socket, bound to one application
 * **and** one already-running container the caller may reach — never
 * derived from the handshake, same pattern as the terminal ticket's
 * `serverId`. `findOwnedOrFail` + `ProjectAccessService.assertAccess`
 * already reject a viewer here: this route isn't in `request-context.ts`'s
 * `READ_ONLY_POSTS`, so it counts as a write and a viewer gets 403 (a
 * read-only API token too, via `JwtAuthGuard`) — developer/admin/owner only.
 */
@Injectable()
export class CreateConsoleTicketService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly remote: RemoteDockerService,
    private readonly swarmDeploy: SwarmDeployService,
    private readonly jwtService: JwtService,
  ) {}

  async execute(
    ownerId: string,
    applicationId: string,
    dto: CreateConsoleTicketDto,
  ): Promise<CreateConsoleTicketResponseDto> {
    const app = await this.applications.findOwnedOrFail(applicationId, ownerId);

    let containerId: string;
    if (app.deployMode === 'service') {
      // Only tasks on this node are reachable (no cross-node exec, see swarm-deploy.service.ts).
      const tasks = await this.swarmDeploy.taskContainers(app);
      if (tasks.length === 0) {
        throw new BadRequestException(
          'No running task for this application on this node',
        );
      }
      if (dto.containerId) {
        if (!tasks.includes(dto.containerId)) {
          throw new BadRequestException(
            'That task is not currently running on this node',
          );
        }
        containerId = dto.containerId;
      } else {
        containerId = tasks[0]; // newest, see taskContainers()
      }
    } else {
      const docker = await this.remote.forServer(app.serverId);
      const container = await docker.findContainerByName(containerNameFor(app));
      if (!container || container.State !== 'running') {
        throw new BadRequestException('Application container is not running');
      }
      containerId = container.Id;
    }

    const payload: ConsoleTicketPayload = {
      sub: ownerId,
      scope: 'console',
      applicationId: app.id,
      containerId,
      jti: randomUUID(),
      ...(app.serverId ? { serverId: app.serverId } : {}),
    };
    const ticket = await this.jwtService.signAsync(payload, {
      expiresIn: CONSOLE_TICKET_TTL_SECONDS,
    });
    return { ticket, expiresIn: CONSOLE_TICKET_TTL_SECONDS, containerId };
  }
}
