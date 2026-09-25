import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class InitSwarmDto {
  /** IP (or IP:port) other nodes use to reach this manager; empty = daemon picks. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9.:-]*$/, {
    message: 'advertiseAddr must be an address',
  })
  advertiseAddr?: string;
}
