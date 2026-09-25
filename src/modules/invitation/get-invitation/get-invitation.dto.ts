import { IsString, Length } from 'class-validator';

export class InvitationTokenParamsDto {
  @IsString()
  @Length(32, 64)
  token: string;
}

/** What the accept page shows before the form. */
export class InvitationPreviewDto {
  email: string;
  role: string;
  expiresAt: Date;
}
