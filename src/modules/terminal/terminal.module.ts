import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreateTicketController } from './create-ticket/create-ticket.controller';
import { CreateTicketService } from './create-ticket/create-ticket.service';
import { ServerModule } from '../server/server.module';
import { SshModule } from '../ssh/ssh.module';
import { TerminalBackendService } from './terminal-backend.service';
import { TerminalStatusController } from './terminal-status/terminal-status.controller';
import { TerminalGateway } from './terminal.gateway';

@Module({
  imports: [AuthModule, SshModule, ServerModule],
  controllers: [CreateTicketController, TerminalStatusController],
  providers: [CreateTicketService, TerminalBackendService, TerminalGateway],
})
export class TerminalModule {}
