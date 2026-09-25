import { IsUUID } from 'class-validator';

export class RevokeInvitationParamsDto {
  @IsUUID()
  id: string;
}
