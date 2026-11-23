import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { LogsTicketPayload } from '../../application/logs.protocol';
import { DockerService } from '../../docker/docker.service';
import { pickDatabaseContainer } from '../database-ticket';
import {
  containerNameForDb,
  ManagedDatabaseService,
} from '../managed-database.service';
import { CreateDatabaseLogTicketResponseDto } from './create-database-log-ticket.dto';

export const DATABASE_LOG_TICKET_TTL_SECONDS = 60;

/**
 * Ticket for the `/logs` socket bound to a database container. Developer or
 * higher (404 outsiders, 403 viewers) even though it is a read: engine logs
 * quote data (failing rows, duplicate keys, slow statements) that a viewer
 * may not read through the data browser. The route is in `READ_ONLY_POSTS`
 * (it only reads), so the read-only API token of a developer may use it.
 */
@Injectable()
export class CreateDatabaseLogTicketService {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly docker: DockerService,
    private readonly jwtService: JwtService,
  ) {}

  async execute(
    ownerId: string,
    databaseId: string,
  ): Promise<CreateDatabaseLogTicketResponseDto> {
    const db = await this.databases.findOwnedForExportOrFail(
      databaseId,
      ownerId,
    );
    const name = containerNameForDb(db);
    const container = pickDatabaseContainer(
      await this.docker.findContainerByName(name),
      'exists',
      name,
    );
    const payload: LogsTicketPayload = {
      sub: ownerId,
      scope: 'logs',
      ownerKind: 'database',
      databaseId: db.id,
      containerId: container.Id,
      jti: randomUUID(),
    };
    const ticket = await this.jwtService.signAsync(payload, {
      expiresIn: DATABASE_LOG_TICKET_TTL_SECONDS,
    });
    return {
      ticket,
      expiresIn: DATABASE_LOG_TICKET_TTL_SECONDS,
      containerId: container.Id,
    };
  }
}
