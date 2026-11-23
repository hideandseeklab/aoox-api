import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { LogsTicketPayload } from '../../application/logs.protocol';
import { pickComposeContainer } from '../compose-service-pick';
import { ComposeService } from '../compose.service';
import {
  CreateComposeLogTicketDto,
  CreateComposeLogTicketResponseDto,
} from './create-compose-log-ticket.dto';

export const COMPOSE_LOG_TICKET_TTL_SECONDS = 60;

/**
 * Ticket for the `/logs` socket bound to one service container of a stack
 * (host daemon). A read, like the application log ticket (`READ_ONLY_POSTS`),
 * so viewers and read-only tokens may follow logs: the gateway masks the
 * container's own secret env values in the stream (the same `envValuesToRedact`
 * rule as job output), because a viewer cannot read the stack env itself.
 */
@Injectable()
export class CreateComposeLogTicketService {
  constructor(
    private readonly compose: ComposeService,
    private readonly jwtService: JwtService,
  ) {}

  async execute(
    ownerId: string,
    composeAppId: string,
    dto: CreateComposeLogTicketDto,
  ): Promise<CreateComposeLogTicketResponseDto> {
    const app = await this.compose.findOwnedOrFail(composeAppId, ownerId);
    const container = pickComposeContainer(
      await this.compose.containers(app),
      dto.service,
      'exists',
    );
    const payload: LogsTicketPayload = {
      sub: ownerId,
      scope: 'logs',
      ownerKind: 'compose',
      composeAppId: app.id,
      service: container.service,
      containerId: container.id,
      jti: randomUUID(),
    };
    const ticket = await this.jwtService.signAsync(payload, {
      expiresIn: COMPOSE_LOG_TICKET_TTL_SECONDS,
    });
    return {
      ticket,
      expiresIn: COMPOSE_LOG_TICKET_TTL_SECONDS,
      containerId: container.id,
      service: container.service,
    };
  }
}
