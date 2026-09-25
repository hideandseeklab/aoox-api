import { ConflictException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { hashPassword } from '../../user/password.util';
import { User } from '../../user/user.entity';
import { JwtPayload } from '../jwt.strategy';
import { SignInResponseDto } from '../sign-in/sign-in.dto';
import { SetupDto } from './setup.dto';

/** First-run onboarding: creates the owner account, only while no user exists. */
@Injectable()
export class SetupService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
  ) {}

  async execute(dto: SetupDto): Promise<SignInResponseDto> {
    const passwordHash = await hashPassword(dto.password);

    // Count + insert in one serializable transaction so two concurrent
    // setup requests cannot both create an owner.
    const user = await this.dataSource.transaction(
      'SERIALIZABLE',
      async (em) => {
        if ((await em.count(User)) > 0) {
          throw new ConflictException('Setup has already been completed');
        }
        return em.save(
          em.create(User, {
            email: dto.email.toLowerCase().trim(),
            passwordHash,
            name: dto.name?.trim() || null,
            role: 'owner',
          }),
        );
      },
    );

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }
}
