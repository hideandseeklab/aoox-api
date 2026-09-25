import { IsString, IsUUID, Matches } from 'class-validator';
import { AddMountDto } from '../application/add-mount/add-mount.dto';

/** Compose service names accepted from the UI (matches compose-app.dto.ts's ServiceDomainDto). */
export const SERVICE_NAME = /^[a-zA-Z0-9_.-]+$/;

/** A compose mount also names which service it attaches to. */
export class AddComposeMountDto extends AddMountDto {
  @IsString()
  @Matches(SERVICE_NAME, { message: 'service name is not valid' })
  service: string;
}

export class ComposeMountParamsDto {
  @IsUUID()
  id: string;

  @IsUUID()
  mountId: string;
}
