import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

/** Rows older than this are deleted nightly. */
export const AUDIT_RETENTION_DAYS = 90;

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  via: string;
  tokenId?: string | null;
  action: string;
  method: string;
  path: string;
  params?: Record<string, string>;
  body?: Record<string, unknown> | null;
  status: number;
  ip?: string | null;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AuditLog) readonly repo: Repository<AuditLog>,
  ) {}

  /** Fire-and-forget: logging must never fail or slow down the request. */
  record(entry: AuditEntry): void {
    void this.repo
      .save(
        this.repo.create({
          actorId: entry.actorId ?? null,
          actorEmail: entry.actorEmail ?? null,
          via: entry.via,
          tokenId: entry.tokenId ?? null,
          action: entry.action,
          method: entry.method,
          path: entry.path.slice(0, 500),
          params: entry.params ?? {},
          body: entry.body ?? null,
          status: entry.status,
          ip: entry.ip ?? null,
        }),
      )
      .catch((err) => this.logger.warn(`Audit insert failed: ${String(err)}`));
  }

  @Cron('17 3 * * *')
  async prune(): Promise<void> {
    const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86_400_000);
    const { affected } = await this.repo.delete({
      createdAt: LessThan(cutoff),
    });
    if (affected) this.logger.log(`Pruned ${affected} audit row(s)`);
  }
}
