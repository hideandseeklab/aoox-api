export class QueryHistoryEntryDto {
  id: string;
  db: string | null;
  sql: string;
  success: boolean;
  errorMessage: string | null;
  rowCount: number | null;
  durationMs: number;
  createdAt: Date;
}
