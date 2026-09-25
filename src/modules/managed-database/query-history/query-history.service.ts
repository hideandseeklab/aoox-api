import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryHistoryEntry } from './query-history.entity';

/** Rows kept per (database, user); older entries are pruned after every write. */
export const QUERY_HISTORY_KEEP = 50;
/** Statement text is capped before insert — this is a scratchpad, not a log. */
const SQL_MAX_LENGTH = 4_000;
const ERROR_MAX_LENGTH = 500;

export interface RecordQueryInput {
  databaseId: string;
  userId: string;
  db: string | null;
  sql: string;
  success: boolean;
  errorMessage: string | null;
  rowCount: number | null;
  durationMs: number;
}

/**
 * Per-user recent-queries list for the data browser. Insert is
 * fire-and-forget from the caller (a query that ran should never fail to
 * return because history couldn't be written) — see data-browser.controller.
 */
@Injectable()
export class QueryHistoryService {
  constructor(
    @InjectRepository(QueryHistoryEntry)
    private readonly repo: Repository<QueryHistoryEntry>,
  ) {}

  async record(input: RecordQueryInput): Promise<void> {
    await this.repo.save(
      this.repo.create({
        ...input,
        sql: input.sql.slice(0, SQL_MAX_LENGTH),
        errorMessage: input.errorMessage?.slice(0, ERROR_MAX_LENGTH) ?? null,
      }),
    );
    await this.prune(input.databaseId, input.userId);
  }

  list(databaseId: string, userId: string): Promise<QueryHistoryEntry[]> {
    return this.repo.find({
      where: { databaseId, userId },
      order: { createdAt: 'DESC' },
      take: QUERY_HISTORY_KEEP,
    });
  }

  async clear(databaseId: string, userId: string): Promise<void> {
    await this.repo.delete({ databaseId, userId });
  }

  /** Keeps the newest QUERY_HISTORY_KEEP rows for this (database, user) pair. */
  private async prune(databaseId: string, userId: string): Promise<void> {
    const old = await this.repo.find({
      where: { databaseId, userId },
      order: { createdAt: 'DESC' },
      select: { id: true },
      skip: QUERY_HISTORY_KEEP,
      take: 100,
    });
    if (old.length) await this.repo.delete(old.map((r) => r.id));
  }
}
