import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import {
  authorizeCommand,
  describeKeyError,
  SshKeyService,
} from '../../ssh/ssh-key.service';
import { PlatformSshKeyResponseDto } from './platform-ssh-key.dto';

/** The platform's public key, to authorize on remote servers. */
@Controller('servers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class PlatformSshKeyController {
  constructor(private readonly keys: SshKeyService) {}

  @Get('ssh-key')
  key(): PlatformSshKeyResponseDto {
    try {
      const { publicKey } = this.keys.load();
      return {
        publicKey,
        authorizeCommand: authorizeCommand(publicKey),
        error: null,
      };
    } catch (err) {
      return {
        publicKey: null,
        authorizeCommand: null,
        error: describeKeyError(err),
      };
    }
  }
}
