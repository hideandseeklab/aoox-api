import { IsIn, IsUUID } from 'class-validator';
import type { UserRole } from '../user.entity';

export class UpdateUserRoleParamsDto {
  @IsUUID()
  id: string;
}

export class UpdateUserRoleDto {
  @IsIn(['owner', 'admin', 'member'])
  role: UserRole;
}
