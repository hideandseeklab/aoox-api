import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { ConsoleTicketPayload } from '../../application/console.protocol';
import { DockerService } from '../../docker/docker.service';
import { pickDatabaseContainer } from '../database-ticket';
import {
  containerNameForDb,
  ManagedDatabaseService,
} from '../managed-database.service';
import { CreateDatabaseConsoleTicketResponseDto } from './create-database-console-ticket.dto';

export const DATABASE_CONSOLE_TICKET_TTL_SECONDS = 60;

/**
 * Ticket for the `/console` socket bound to the database container (host
 * daemon only). A shell in the database container is full data access, so it
 * needs developer or higher like credentials and exports (404 outsiders, 403
 * viewers). The route is deliberately NOT in `READ_ONLY_POSTS`: it counts as
 * a write, so a read-only API token gets 403 in `JwtAuthGuard`, and the
 * audit log records it.
 */
@Injectable()
export class CreateDatabaseConsoleTicketService {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly docker: DockerService,
    private readonly jwtService: JwtService,
  ) {}

  async execute(
    ownerId: string,
    databaseId: string,
  ): Promise<CreateDatabaseConsoleTicketResponseDto> {
    const db = await this.databases.findOwnedForExportOrFail(
      databaseId,
      ownerId,
    );
    const name = containerNameForDb(db);
    const container = pickDatabaseContainer(
      await this.docker.findContainerByName(name),
      'running',
      name,
    );
    const payload: ConsoleTicketPayload = {
      sub: ownerId,
      scope: 'console',
      ownerKind: 'database',
      databaseId: db.id,
      containerId: container.Id,
      jti: randomUUID(),
    };
    const ticket = await this.jwtService.signAsync(payload, {
      expiresIn: DATABASE_CONSOLE_TICKET_TTL_SECONDS,
    });
    return {
      ticket,
      expiresIn: DATABASE_CONSOLE_TICKET_TTL_SECONDS,
      containerId: container.Id,
    };
  }
}
