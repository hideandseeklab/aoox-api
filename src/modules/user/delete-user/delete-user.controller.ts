import {
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { UserService } from '../user.service';
import { DeleteUserParamsDto } from './delete-user.dto';

/**
 * Owner only; never yourself and never the last owner. `projects.owner_id`
 * cascades, so a user who created projects is refused (409) until those
 * projects are handed over — deleting a person must not delete deployments.
 */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class DeleteUserController {
  constructor(private readonly users: UserService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() actor: JwtPayload,
    @Param() params: DeleteUserParamsDto,
  ): Promise<void> {
    if (params.id === actor.sub) {
      throw new ForbiddenException('You cannot delete your own account');
    }
    const user = await this.users.findById(params.id);
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'owner') await this.users.assertNotLastOwner(user.id);
    await this.users.assertOwnsNoProjects(user.id);
    await this.users.repo.remove(user);
  }
}
