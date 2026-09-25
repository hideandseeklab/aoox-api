import { IsUUID } from 'class-validator';

export class RollbackApplicationDto {
  /** A previous successful deployment of the same application. */
  @IsUUID()
  deploymentId: string;
}
