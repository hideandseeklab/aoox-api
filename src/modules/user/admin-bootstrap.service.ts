import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hashPassword } from './password.util';
import { UserService } from './user.service';

/**
 * Optional non-interactive onboarding for automated deployments: when
 * ADMIN_EMAIL + ADMIN_PASSWORD are set and no user exists yet, create the
 * owner account. Runs once per fresh database; never touches existing users.
 */
const MIN_PASSWORD_LENGTH = 8;

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly userService: UserService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.get<string>('ADMIN_EMAIL');
    const password = this.config.get<string>('ADMIN_PASSWORD');
    if (!email || !password) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      // Same rule as /auth/setup. Not fatal: a local dev .env may keep a short one.
      this.logger.warn(
        `ADMIN_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters; use a stronger one outside development`,
      );
    }

    if ((await this.userService.count()) > 0) {
      this.logger.debug('Users already exist; skipping ADMIN_* bootstrap');
      return;
    }

    await this.userService.create({
      email,
      passwordHash: await hashPassword(password),
      name: this.config.get<string>('ADMIN_NAME') ?? 'Admin',
      role: 'owner',
    });
    this.logger.log(`Owner account created from ADMIN_EMAIL (${email})`);
  }
}
