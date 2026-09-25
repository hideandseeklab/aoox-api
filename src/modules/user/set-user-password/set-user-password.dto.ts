import { IsString, IsUUID, Length } from 'class-validator';

export class SetUserPasswordParamsDto {
  @IsUUID()
  id: string;
}

export class SetUserPasswordDto {
  @IsString()
  @Length(8, 128)
  password: string;
}
