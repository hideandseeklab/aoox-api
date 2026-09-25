import { IsOptional, IsUUID } from 'class-validator';

export class CreateTicketDto {
  /** Target a remote server (servers module); omit for the aoox host. */
  @IsOptional()
  @IsUUID()
  serverId?: string;
}

export class CreateTicketResponseDto {
  ticket: string;
  expiresIn: number;
}
