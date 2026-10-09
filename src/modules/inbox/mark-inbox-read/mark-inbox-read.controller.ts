import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { InboxFeedService } from '../inbox-feed.service';

@Controller('inbox')
@UseGuards(JwtAuthGuard)
export class MarkInboxReadController {
  constructor(private readonly feed: InboxFeedService) {}

  /** "Mark all as read" for the signed-in user (a per-user marker, not per event). */
  @Post('read')
  @HttpCode(204)
  async read(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.feed.markAllRead(user.sub);
  }
}
