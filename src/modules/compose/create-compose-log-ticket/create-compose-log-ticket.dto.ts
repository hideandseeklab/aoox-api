import { IsOptional, IsString, Matches } from 'class-validator';

export class CreateComposeLogTicketDto {
  /** Service name; may be omitted when the stack has exactly one service. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,100}$/)
  service?: string;
}

export class CreateComposeLogTicketResponseDto {
  ticket: string;
  expiresIn: number;
  /** The container the ticket was bound to. */
  containerId: string;
  /** The service it belongs to. */
  service: string;
}
