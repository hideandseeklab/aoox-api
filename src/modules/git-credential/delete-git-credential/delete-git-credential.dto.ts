import { IsUUID } from 'class-validator';

export class DeleteGitCredentialParamsDto {
  @IsUUID()
  id: string;
}
