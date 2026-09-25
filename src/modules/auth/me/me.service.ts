import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserService } from '../../user/user.service';
import { MeResponseDto } from './me.dto';

@Injectable()
export class MeService {
  constructor(private readonly userService: UserService) {}

  async execute(userId: string): Promise<MeResponseDto> {
    const user = await this.userService.findById(userId);
    // Token may outlive the account (deleted user, wiped database).
    if (!user) throw new UnauthorizedException('User no longer exists');
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      twoFactorEnabled: user.totpEnabled,
    };
  }
}
