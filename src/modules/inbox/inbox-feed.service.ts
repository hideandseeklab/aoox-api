import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type SelectQueryBuilder } from 'typeorm';
import { ProjectAccessService } from '../project/project-access.service';
import { InboxEvent } from './inbox-event.entity';

export class InboxItemDto {
  id: string;
  event: string;
  level: 'success' | 'failure' | 'info';
  title: string;
  summary: string;
  /** Structured facts for localized rendering, or null on older events. */
  params: Record<string, string | number | boolean | null> | null;
  /** Path inside the web app, or null. */
  link: string | null;
  projectId: string | null;
  createdAt: string;
}

export class InboxPageDto {
  items: InboxItemDto[];
  /** Visible events newer than the user's read marker. */
  unread: number;
}

export const INBOX_MAX_LIMIT = 50;
export const INBOX_DEFAULT_LIMIT = 20;

/**
 * Reads the inbox for one user. Project events are visible to whoever can
 * access that project (`ProjectAccessService`); platform events (no project:
 * disk, servers, certificates…) only when that access is "all", which is
 * exactly owners/admins without a project-scoped API token.
 */
@Injectable()
export class InboxFeedService {
  constructor(
    @InjectRepository(InboxEvent)
    private readonly events: Repository<InboxEvent>,
    private readonly access: ProjectAccessService,
  ) {}

  /** Restricts a query to what the user may see; false = nothing at all. */
  private async visible(
    userId: string,
    qb: SelectQueryBuilder<InboxEvent>,
  ): Promise<boolean> {
    const ids = await this.access.accessibleProjectIds(userId);
    if (ids === 'all') return true;
    if (ids.length === 0) return false;
    qb.andWhere('e.project_id IN (:...visibleIds)', { visibleIds: ids });
    return true;
  }

  async list(
    userId: string,
    limit = INBOX_DEFAULT_LIMIT,
    before?: Date,
  ): Promise<InboxPageDto> {
    const take = Math.min(Math.max(Math.trunc(limit) || 1, 1), INBOX_MAX_LIMIT);
    const page = this.events.createQueryBuilder('e');
    if (!(await this.visible(userId, page))) return { items: [], unread: 0 };
    if (before) page.andWhere('e.created_at < :before', { before });
    const rows = await page
      .orderBy('e.created_at', 'DESC')
      .take(take)
      .getMany();

    const unreadQb = this.events.createQueryBuilder('e');
    await this.visible(userId, unreadQb);
    const marker = await this.readMarker(userId);
    const unread = await unreadQb
      .andWhere('e.created_at > :marker', { marker })
      .getCount();
    return {
      items: rows.map((e) => ({
        id: e.id,
        event: e.event,
        level: e.level,
        title: e.title,
        summary: e.summary,
        params: e.params ?? null,
        link: e.link,
        projectId: e.projectId,
        createdAt: e.createdAt.toISOString(),
      })),
      unread,
    };
  }

  /** Everything up to now counts as read. */
  async markAllRead(userId: string): Promise<void> {
    await this.events.query(
      `UPDATE users SET inbox_read_at = now() WHERE id = $1`,
      [userId],
    );
  }

  private async readMarker(userId: string): Promise<Date> {
    const rows = await this.events.query<{ inbox_read_at: Date }[]>(
      `SELECT inbox_read_at FROM users WHERE id = $1`,
      [userId],
    );
    return rows[0]?.inbox_read_at ?? new Date(0);
  }
}
