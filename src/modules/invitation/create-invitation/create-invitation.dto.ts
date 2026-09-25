import { IsEmail, IsIn } from 'class-validator';
import type { UserRole } from '../../user/user.entity';

export class CreateInvitationDto {
  @IsEmail()
  email: string;

  @IsIn(['owner', 'admin', 'member'])
  role: UserRole;
}

export class CreateInvitationResponseDto {
  id: string;
  email: string;
  role: UserRole;
  expiresAt: Date;
  /** Shown once; never retrievable again. */
  token: string;
  /** `${WEB_ORIGIN}/invite/<token>`, or null when WEB_ORIGIN is unset. */
  acceptUrl: string | null;
}
