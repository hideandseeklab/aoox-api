import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../user/user.entity';

export const ROLES_KEY = 'roles';
/** Restrict a route to the given roles; use together with JwtAuthGuard. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
