import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { User } from '../user.entity';
import {
  UpdateUserProfileDto,
  UpdateUserProfileParamsDto,
} from './update-user-profile.dto';
import { UpdateUserProfileService } from './update-user-profile.service';

/** Owner edits the name/email of a non-owner user (no password needed). */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class UpdateUserProfileController {
  constructor(private readonly service: UpdateUserProfileService) {}

  @Patch(':id')
  @ApiOperation({ summary: 'Owner: change name/email of a non-owner user' })
  update(
    @CurrentUser() actor: JwtPayload & { tokenId?: string },
    @Param() params: UpdateUserProfileParamsDto,
    @Body() dto: UpdateUserProfileDto,
  ): Promise<User> {
    return this.service.execute(actor, params.id, dto);
  }
}
