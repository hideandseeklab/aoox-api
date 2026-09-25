import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class SignInDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class SignInResponseDto {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
  };
}

/** Password was right but 2FA is on: finish with `POST /auth/sign-in/2fa`. */
export class TwoFactorRequiredDto {
  requiresTwoFactor: true;
  /** Short-lived JWT proving the first factor (scope `2fa`). */
  challengeToken: string;
}

export class SignInTwoFactorDto {
  @IsString()
  @IsNotEmpty()
  challengeToken: string;

  /** 6-digit TOTP or a backup code. */
  @IsString()
  @IsNotEmpty()
  code: string;
}
