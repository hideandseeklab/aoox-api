import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Application } from '../application/application.entity';
import { ComposeApp } from '../compose/compose-app.entity';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import type { NotificationMessage } from '../notification/notification-sender';
import { InboxEvent } from './inbox-event.entity';
import {
  INBOX_KEEP_DAYS,
  INBOX_KEEP_ROWS,
  inboxLink,
  inboxResource,
  inboxSummary,
  type InboxResource,
} from './inbox-target';

/**
 * Storage side of the in-app inbox: every broadcast notification is recorded
 * here (`record`), whatever the channels do. Reading and the read marker are
 * in `InboxFeedService` (it needs project access, which would make a module cycle here).
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    @InjectRepository(InboxEvent)
    readonly events: Repository<InboxEvent>,
    @InjectRepository(Application)
    private readonly applications: Repository<Application>,
    @InjectRepository(ComposeApp)
    private readonly composeApps: Repository<ComposeApp>,
    @InjectRepository(ManagedDatabase)
    private readonly databases: Repository<ManagedDatabase>,
  ) {}

  /** Never throws: the inbox must not get in the way of the channels. */
  async record(event: string, message: NotificationMessage): Promise<void> {
    try {
      const resource = inboxResource(message.data);
      const projectId = resource ? await this.projectOf(resource) : null;
      await this.events.save(
        this.events.create({
          event,
          level: message.level,
          title: message.title,
          summary: inboxSummary(message.fields),
          link: inboxLink(event, resource),
          projectId,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Could not record inbox event ${event}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Null when the resource is gone (the event then reads as a platform one). */
  private async projectOf(r: InboxResource): Promise<string | null> {
    const repo =
      r.kind === 'application'
        ? this.applications
        : r.kind === 'compose'
          ? this.composeApps
          : this.databases;
    const row = await (
      repo as Repository<{ id: string; projectId: string }>
    ).findOne({ where: { id: r.id }, select: { id: true, projectId: true } });
    return row?.projectId ?? null;
  }

  /** Daily: events older than the retention window, then everything beyond the newest N. */
  @Cron('40 3 * * *')
  async prune(now = new Date()): Promise<{ aged: number; surplus: number }> {
    const cutoff = new Date(now.getTime() - INBOX_KEEP_DAYS * 86_400_000);
    const aged = await this.events
      .createQueryBuilder()
      .delete()
      .where('created_at < :cutoff', { cutoff })
      .execute();
    const surplus: unknown = await this.events.query(
      `DELETE FROM inbox_events WHERE id IN (
         SELECT id FROM inbox_events ORDER BY created_at DESC OFFSET $1)`,
      [INBOX_KEEP_ROWS],
    );
    const count = (r: unknown): number =>
      Array.isArray(r) ? Number(r[1] ?? 0) : 0;
    return { aged: aged.affected ?? 0, surplus: count(surplus) };
  }
}
