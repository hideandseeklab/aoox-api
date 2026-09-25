import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class SetupDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(8, 128)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}
