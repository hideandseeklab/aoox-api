import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserService } from '../../user/user.service';
import { InstanceVersionService } from '../../instance-update/instance-version.service';
import { appVersion } from './app-version';
import { MeResponseDto } from './me.dto';

@Injectable()
export class MeService {
  constructor(
    private readonly userService: UserService,
    private readonly versions: InstanceVersionService,
  ) {}

  async execute(userId: string): Promise<MeResponseDto> {
    const user = await this.userService.findById(userId);
    // Token may outlive the account (deleted user, wiped database).
    if (!user) throw new UnauthorizedException('User no longer exists');
    const update =
      user.role === 'owner' ? await this.updateAvailable() : undefined;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      twoFactorEnabled: user.totpEnabled,
      version: appVersion(),
      ...(update ? { updateAvailable: update } : {}),
    };
  }

  /** From the cached state only — never a registry call — and never fatal to `/auth/me`. */
  private async updateAvailable(): Promise<
    MeResponseDto['updateAvailable'] | undefined
  > {
    try {
      const info = await this.versions.info();
      return info.updateAvailable && info.latestVersion
        ? { version: info.latestVersion, applying: info.applying }
        : undefined;
    } catch {
      return undefined;
    }
  }
}
