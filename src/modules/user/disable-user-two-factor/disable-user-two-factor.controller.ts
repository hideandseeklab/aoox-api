import {
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { SetUserPasswordParamsDto } from '../set-user-password/set-user-password.dto';
import { UserService } from '../user.service';

/** Owner unlocks a non-owner who lost their authenticator (owners: use backup codes). */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class DisableUserTwoFactorController {
  constructor(private readonly users: UserService) {}

  @Post(':id/2fa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Owner: turn off a non-owner user's 2FA" })
  async disable(
    @CurrentUser() actor: JwtPayload & { tokenId?: string },
    @Param() params: SetUserPasswordParamsDto,
  ): Promise<void> {
    if (actor.tokenId) {
      throw new ForbiddenException('Not allowed with an API token');
    }
    const user = await this.users.findById(params.id);
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'owner') {
      throw new ForbiddenException(
        "Owners' 2FA can only be disabled by themselves",
      );
    }
    await this.users.repo.update(user.id, {
      totpEnabled: false,
      totpSecretEncrypted: null,
      totpBackupHashes: null,
    });
  }
}
