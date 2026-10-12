import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { MAINTENANCE_MESSAGE_MAX } from '../../maintenance-mode/maintenance-page';

export class SetMaintenanceDto {
  /** true = every domain shows the maintenance page (503); false = normal routing. */
  @IsBoolean()
  enabled: boolean;

  /**
   * Plain text for the page (newlines allowed, markup is shown as text).
   * Omit or send "" for the default message.
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAINTENANCE_MESSAGE_MAX)
  message?: string;
}
