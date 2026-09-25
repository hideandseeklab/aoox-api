import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UserModule } from '../user/user.module';
import { JwtStrategy } from './jwt.strategy';
import { MeController } from './me/me.controller';
import { MeService } from './me/me.service';
import { SetupController } from './setup/setup.controller';
import { SetupService } from './setup/setup.service';
import { SetupStatusController } from './setup-status/setup-status.controller';
import { SetupStatusService } from './setup-status/setup-status.service';
import { SignInController } from './sign-in/sign-in.controller';
import { SignInService } from './sign-in/sign-in.service';
import { TwoFactorController } from './two-factor/two-factor.controller';
import { TwoFactorService } from './two-factor/two-factor.service';

@Module({
  imports: [
    UserModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ??
            '7d') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [
    SignInController,
    SetupStatusController,
    SetupController,
    MeController,
    TwoFactorController,
  ],
  providers: [
    SignInService,
    SetupStatusService,
    SetupService,
    MeService,
    JwtStrategy,
    TwoFactorService,
  ],
  exports: [JwtModule],
})
export class AuthModule {}
