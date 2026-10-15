import { Matches } from 'class-validator';

export class OrphanContainerParamsDto {
  /** Full container id, or its 12+ character prefix. */
  @Matches(/^[a-fA-F0-9]{12,64}$/)
  id!: string;
}
