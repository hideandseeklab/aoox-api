import { ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ServerService } from '../../server/server.service';
import { TERMINAL_ROLES, TerminalTicketPayload } from '../terminal.protocol';
import { CreateTicketDto, CreateTicketResponseDto } from './create-ticket.dto';

/** Browsers cannot send Authorization headers on WebSocket handshakes, so the
 *  client exchanges its session for a short-lived single-purpose ticket. */
export const TICKET_TTL_SECONDS = 60;

@Injectable()
export class CreateTicketService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly servers: ServerService,
  ) {}

  async execute(
    user: JwtPayload,
    dto: CreateTicketDto = {},
  ): Promise<CreateTicketResponseDto> {
    // A host shell is owner/admin territory; members never get a ticket.
    if (!TERMINAL_ROLES.has(user.role)) {
      throw new ForbiddenException(
        'Terminal access requires the owner or admin role',
      );
    }
    // The target is bound into the ticket so the socket handshake cannot
    // redirect a valid ticket to another server (404 if it does not exist).
    if (dto.serverId) await this.servers.findOrFail(dto.serverId);
    const payload: TerminalTicketPayload = {
      sub: user.sub,
      role: user.role,
      scope: 'terminal',
      jti: randomUUID(),
      ...(dto.serverId ? { serverId: dto.serverId } : {}),
    };
    const ticket = await this.jwtService.signAsync(payload, {
      expiresIn: TICKET_TTL_SECONDS,
    });
    return { ticket, expiresIn: TICKET_TTL_SECONDS };
  }
}
