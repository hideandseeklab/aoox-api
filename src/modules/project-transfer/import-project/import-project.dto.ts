import { IsObject, IsOptional, IsString, Length } from 'class-validator';
import type { ProjectExport } from '../project-export.types';

export class ImportProjectDto {
  /** Content of an exported file; validated structurally by the service. */
  @IsObject()
  file: ProjectExport;

  /** Name for the new project (defaults to the exported one). */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;
}
