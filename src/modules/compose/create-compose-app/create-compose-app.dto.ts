import { IsString, IsUUID, Length, Matches } from 'class-validator';
import { ComposeAppFieldsDto } from '../compose-app.dto';

export class CreateComposeAppDto extends ComposeAppFieldsDto {
  @IsUUID()
  projectId: string;

  @IsString()
  @Length(1, 100)
  declare name: string;

  @IsString()
  @Length(1, 500)
  @Matches(/^(https?|git):\/\/[^\s#@]+$/, {
    message: 'gitUrl must be an http(s)/git URL without credentials',
  })
  declare gitUrl: string;
}
