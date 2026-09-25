import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { verifyPassword } from '../../user/password.util';
import { UserService } from '../../user/user.service';
import { CurrentUser } from '../current-user.decorator';
import { JwtAuthGuard } from '../jwt-auth.guard';
import type { JwtPayload } from '../jwt.strategy';
import {
  TwoFactorCodeDto,
  TwoFactorDisableDto,
  TwoFactorEnableResponseDto,
  TwoFactorSetupResponseDto,
} from './two-factor.dto';
import { TwoFactorService } from './two-factor.service';

type Actor = JwtPayload & { tokenId?: string };

/** Own 2FA only, and only from a password session — never via an API token. */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/2fa')
@UseGuards(JwtAuthGuard)
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly users: UserService,
  ) {}

  @Post('setup')
  @ApiOperation({
    summary: 'Start 2FA setup: new secret + QR (not active until enabled)',
  })
  async setup(@CurrentUser() actor: Actor): Promise<TwoFactorSetupResponseDto> {
    const user = await this.load(actor);
    if (user.totpEnabled) {
      throw new BadRequestException('2FA is already enabled; disable it first');
    }
    return this.twoFactor.setup(user);
  }

  @Post('enable')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Confirm setup with a code; returns backup codes once',
  })
  async enable(
    @CurrentUser() actor: Actor,
    @Body() dto: TwoFactorCodeDto,
  ): Promise<TwoFactorEnableResponseDto> {
    const user = await this.load(actor);
    if (user.totpEnabled)
      throw new BadRequestException('2FA is already enabled');
    const backupCodes = await this.twoFactor.enable(user, dto.code);
    if (!backupCodes) throw new UnauthorizedException('Invalid code');
    return { backupCodes };
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Turn 2FA off (requires the current password)' })
  async disable(
    @CurrentUser() actor: Actor,
    @Body() dto: TwoFactorDisableDto,
  ): Promise<void> {
    const user = await this.load(actor);
    if (!(await verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Password is incorrect');
    }
    await this.twoFactor.disable(user.id);
  }

  private async load(actor: Actor) {
    if (actor.tokenId) {
      throw new ForbiddenException('2FA cannot be managed with an API token');
    }
    const user = await this.users.findByIdWithSecrets(actor.sub);
    if (!user) throw new UnauthorizedException('User no longer exists');
    return user;
  }
}
