import { IsOptional, IsString } from 'class-validator';

export class CreateConsoleTicketDto {
  /** Task container id, for a service-mode app with more than one running task; default = newest. */
  @IsOptional()
  @IsString()
  containerId?: string;
}

export class CreateConsoleTicketResponseDto {
  ticket: string;
  expiresIn: number;
  /** The container the ticket was bound to, so the web can show which task it opened. */
  containerId: string;
}
