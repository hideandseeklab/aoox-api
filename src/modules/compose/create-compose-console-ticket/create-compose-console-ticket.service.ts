import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { ConsoleTicketPayload } from '../../application/console.protocol';
import { pickComposeContainer } from '../compose-service-pick';
import { ComposeService } from '../compose.service';
import {
  CreateComposeConsoleTicketDto,
  CreateComposeConsoleTicketResponseDto,
} from './create-compose-console-ticket.dto';

export const COMPOSE_CONSOLE_TICKET_TTL_SECONDS = 60;

/**
 * Ticket for the `/console` socket bound to one running service container of
 * a stack (host daemon). Not in `READ_ONLY_POSTS`, so it is a write: viewers
 * get 403 (`assertAccess`), read-only API tokens 403 (`JwtAuthGuard`),
 * outsiders 404, and the audit log records it. Same as the application console.
 */
@Injectable()
export class CreateComposeConsoleTicketService {
  constructor(
    private readonly compose: ComposeService,
    private readonly jwtService: JwtService,
  ) {}

  async execute(
    ownerId: string,
    composeAppId: string,
    dto: CreateComposeConsoleTicketDto,
  ): Promise<CreateComposeConsoleTicketResponseDto> {
    const app = await this.compose.findOwnedOrFail(composeAppId, ownerId);
    const container = pickComposeContainer(
      await this.compose.containers(app),
      dto.service,
      'running',
    );
    const payload: ConsoleTicketPayload = {
      sub: ownerId,
      scope: 'console',
      ownerKind: 'compose',
      composeAppId: app.id,
      service: container.service,
      containerId: container.id,
      jti: randomUUID(),
    };
    const ticket = await this.jwtService.signAsync(payload, {
      expiresIn: COMPOSE_CONSOLE_TICKET_TTL_SECONDS,
    });
    return {
      ticket,
      expiresIn: COMPOSE_CONSOLE_TICKET_TTL_SECONDS,
      containerId: container.id,
      service: container.service,
    };
  }
}
