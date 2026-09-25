import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { User } from '../user.entity';
import { UserService } from '../user.service';
import {
  UpdateUserRoleDto,
  UpdateUserRoleParamsDto,
} from './update-user-role.dto';

/** Owner only. Takes effect on the target's next request (JwtStrategy re-reads the role). */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class UpdateUserRoleController {
  constructor(private readonly users: UserService) {}

  @Patch(':id/role')
  async update(
    @Param() params: UpdateUserRoleParamsDto,
    @Body() dto: UpdateUserRoleDto,
  ): Promise<User> {
    const user = await this.users.findById(params.id);
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'owner' && dto.role !== 'owner') {
      await this.users.assertNotLastOwner(user.id);
    }
    user.role = dto.role;
    return this.users.repo.save(user);
  }
}
