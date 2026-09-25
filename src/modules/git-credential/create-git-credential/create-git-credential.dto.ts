import { IsIn, IsString, Length } from 'class-validator';

export class CreateGitCredentialDto {
  @IsString()
  @Length(1, 100)
  name: string;

  @IsIn(['github', 'gitlab', 'generic'])
  provider: 'github' | 'gitlab' | 'generic';

  @IsString()
  @Length(1, 255)
  username: string;

  @IsString()
  @Length(1, 4096)
  token: string;
}
