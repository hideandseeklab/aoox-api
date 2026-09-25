import {
  Body,
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
import { hashPassword } from '../password.util';
import { UserService } from '../user.service';
import {
  SetUserPasswordDto,
  SetUserPasswordParamsDto,
} from './set-user-password.dto';

/**
 * Owner resets a member's password (no e-mail delivery exists): the owner
 * hands the new password over out of band. Not for other owners, and not
 * for oneself (use change-password, which checks the current one).
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class SetUserPasswordController {
  constructor(private readonly users: UserService) {}

  @Post(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Owner: set a password for a non-owner user' })
  async set(
    @CurrentUser() actor: JwtPayload & { tokenId?: string },
    @Param() params: SetUserPasswordParamsDto,
    @Body() dto: SetUserPasswordDto,
  ): Promise<void> {
    if (actor.tokenId) {
      throw new ForbiddenException('Not allowed with an API token');
    }
    const user = await this.users.findById(params.id);
    if (!user) throw new NotFoundException('User not found');
    if (user.id === actor.sub || user.role === 'owner') {
      throw new ForbiddenException(
        "Owners' passwords can only be changed by themselves",
      );
    }
    await this.users.repo.update(user.id, {
      passwordHash: await hashPassword(dto.password),
    });
  }
}
