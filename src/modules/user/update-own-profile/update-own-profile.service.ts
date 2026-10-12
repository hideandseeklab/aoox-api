import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { appVersion } from '../../auth/me/app-version';
import { verifyPassword } from '../password.util';
import { UserService } from '../user.service';
import {
  ProfileResponseDto,
  UpdateOwnProfileDto,
} from './update-own-profile.dto';

@Injectable()
export class UpdateOwnProfileService {
  constructor(private readonly users: UserService) {}

  async execute(
    actor: JwtPayload & { tokenId?: string },
    dto: UpdateOwnProfileDto,
  ): Promise<ProfileResponseDto> {
    if (actor.tokenId) {
      throw new ForbiddenException(
        'Sign in with your password to change your profile',
      );
    }
    const user = await this.users.findByIdWithSecrets(actor.sub);
    if (!user) throw new NotFoundException('User not found');

    const patch: { name?: string | null; email?: string } = {};
    if (dto.name !== undefined) patch.name = UserService.cleanName(dto.name);

    if (dto.email) {
      const email = UserService.normalizeEmail(dto.email);
      if (email !== user.email) {
        if (!dto.currentPassword) {
          throw new BadRequestException(
            'Enter your current password to change your email',
          );
        }
        if (!(await verifyPassword(dto.currentPassword, user.passwordHash))) {
          throw new UnauthorizedException('Current password is incorrect');
        }
        await this.users.assertEmailAvailable(email, user.id);
        patch.email = email;
      }
    }

    if (Object.keys(patch).length > 0) {
      await this.users.updateProfile(user.id, patch);
    }
    const fresh = await this.users.findById(user.id);
    if (!fresh) throw new NotFoundException('User not found');
    return {
      id: fresh.id,
      email: fresh.email,
      name: fresh.name,
      role: fresh.role,
      twoFactorEnabled: fresh.totpEnabled,
      version: appVersion(),
    };
  }
}
