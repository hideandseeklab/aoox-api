import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizeTerminalController } from './authorize-terminal/authorize-terminal.controller';
import { AuthorizeTerminalService } from './authorize-terminal/authorize-terminal.service';
import { CreateTicketController } from './create-ticket/create-ticket.controller';
import { CreateTicketService } from './create-ticket/create-ticket.service';
import { DockerModule } from '../docker/docker.module';
import { ServerModule } from '../server/server.module';
import { SshModule } from '../ssh/ssh.module';
import { TerminalBackendService } from './terminal-backend.service';
import { TerminalStatusController } from './terminal-status/terminal-status.controller';
import { TerminalGateway } from './terminal.gateway';

@Module({
  imports: [AuthModule, SshModule, ServerModule, DockerModule],
  controllers: [
    CreateTicketController,
    TerminalStatusController,
    AuthorizeTerminalController,
  ],
  providers: [
    CreateTicketService,
    TerminalBackendService,
    TerminalGateway,
    AuthorizeTerminalService,
  ],
})
export class TerminalModule {}
