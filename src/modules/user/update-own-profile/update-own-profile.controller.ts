import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import {
  ProfileResponseDto,
  UpdateOwnProfileDto,
} from './update-own-profile.dto';
import { UpdateOwnProfileService } from './update-own-profile.service';

/** Own name/email; any role, session only. Registered before `:id` routes. */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UpdateOwnProfileController {
  constructor(private readonly service: UpdateOwnProfileService) {}

  @Patch('me')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Change your own display name or email' })
  update(
    @CurrentUser() actor: JwtPayload & { tokenId?: string },
    @Body() dto: UpdateOwnProfileDto,
  ): Promise<ProfileResponseDto> {
    return this.service.execute(actor, dto);
  }
}
