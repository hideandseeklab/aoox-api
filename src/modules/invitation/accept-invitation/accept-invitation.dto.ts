import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class AcceptInvitationDto {
  @IsString()
  @Length(32, 64)
  token: string;

  @IsString()
  @Length(8, 128)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}
