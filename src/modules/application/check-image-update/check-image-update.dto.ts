import { IsBoolean, IsOptional } from 'class-validator';

export class CheckImageUpdateDto {
  /** Queue a deployment when the digest changed (default: only report). */
  @IsOptional()
  @IsBoolean()
  deploy?: boolean;
}
