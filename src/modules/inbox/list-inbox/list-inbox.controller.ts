import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { InboxFeedService, InboxPageDto } from '../inbox-feed.service';
import { ListInboxQueryDto } from './list-inbox.dto';

/** The signed-in user's inbox: newest first, with the unread count. Every member may read it; what they see depends on project access. */
@Controller('inbox')
@UseGuards(JwtAuthGuard)
export class ListInboxController {
  constructor(private readonly feed: InboxFeedService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() q: ListInboxQueryDto,
  ): Promise<InboxPageDto> {
    return this.feed.list(user.sub, q.limit, q.before);
  }
}
