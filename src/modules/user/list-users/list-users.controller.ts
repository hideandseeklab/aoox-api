import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { User } from '../user.entity';
import { UserService } from '../user.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ListUsersController {
  constructor(private readonly users: UserService) {}

  /** `passwordHash` is `select: false`, so the entity is safe to return. */
  @Get()
  list(): Promise<User[]> {
    return this.users.repo.find({ order: { createdAt: 'ASC' } });
  }
}
