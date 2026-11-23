export class CreateDatabaseConsoleTicketResponseDto {
  ticket: string;
  expiresIn: number;
  /** The container the ticket was bound to. */
  containerId: string;
}
