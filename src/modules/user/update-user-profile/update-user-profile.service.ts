import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { User } from '../user.entity';
import { UserService } from '../user.service';
import { UpdateUserProfileDto } from './update-user-profile.dto';

@Injectable()
export class UpdateUserProfileService {
  constructor(private readonly users: UserService) {}

  async execute(
    actor: JwtPayload & { tokenId?: string },
    id: string,
    dto: UpdateUserProfileDto,
  ): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException('User not found');
    if (user.id === actor.sub || user.role === 'owner') {
      throw new ForbiddenException(
        "Owners' profiles can only be changed by themselves",
      );
    }
    const patch: { name?: string | null; email?: string } = {};
    if (dto.name !== undefined) patch.name = UserService.cleanName(dto.name);
    if (dto.email) {
      const email = UserService.normalizeEmail(dto.email);
      if (email !== user.email) {
        await this.users.assertEmailAvailable(email, user.id);
        patch.email = email;
      }
    }
    if (Object.keys(patch).length > 0) {
      await this.users.updateProfile(user.id, patch);
    }
    const fresh = await this.users.findById(user.id);
    if (!fresh) throw new NotFoundException('User not found');
    return fresh;
  }
}
