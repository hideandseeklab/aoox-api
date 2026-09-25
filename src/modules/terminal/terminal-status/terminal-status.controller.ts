import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { TerminalBackendService } from '../terminal-backend.service';
import type { TerminalStatus } from '../terminal-backend.service';

/** Which backend the terminal uses and, for SSH, the key to authorize on the host. */
@Controller('terminal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class TerminalStatusController {
  constructor(private readonly backend: TerminalBackendService) {}

  @Get('status')
  status(): TerminalStatus {
    return this.backend.status();
  }
}
