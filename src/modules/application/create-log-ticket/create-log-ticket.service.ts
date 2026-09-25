import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { ApplicationService } from '../application.service';
import { LogsTicketPayload } from '../logs.protocol';
import { CreateLogTicketResponseDto } from './create-log-ticket.dto';

export const LOG_TICKET_TTL_SECONDS = 60;

/** Short-lived ticket for the `/logs` socket, bound to one application the user owns. */
@Injectable()
export class CreateLogTicketService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly jwtService: JwtService,
  ) {}

  async execute(
    ownerId: string,
    applicationId: string,
  ): Promise<CreateLogTicketResponseDto> {
    const app = await this.applications.findOwnedOrFail(applicationId, ownerId);
    const payload: LogsTicketPayload = {
      sub: ownerId,
      scope: 'logs',
      applicationId: app.id,
      jti: randomUUID(),
    };
    const ticket = await this.jwtService.signAsync(payload, {
      expiresIn: LOG_TICKET_TTL_SECONDS,
    });
    return { ticket, expiresIn: LOG_TICKET_TTL_SECONDS };
  }
}
