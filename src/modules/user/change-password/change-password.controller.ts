import {
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
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { hashPassword, verifyPassword } from '../password.util';
import { UserService } from '../user.service';
import { ChangePasswordDto } from './change-password.dto';

/** Own password only; requires the current one, and a session (not an API token). */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class ChangePasswordController {
  constructor(private readonly users: UserService) {}

  @Post('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Change your own password' })
  async change(
    @CurrentUser() actor: JwtPayload & { tokenId?: string },
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    if (actor.tokenId) {
      throw new ForbiddenException('Sign in with your password to change it');
    }
    const user = await this.users.findByEmailWithPassword(actor.email);
    if (
      !user ||
      !(await verifyPassword(dto.currentPassword, user.passwordHash))
    ) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.users.repo.update(user.id, {
      passwordHash: await hashPassword(dto.newPassword),
    });
  }
}
