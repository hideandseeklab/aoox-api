import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectModule } from '../project/project.module';
import { InboxFeedService } from './inbox-feed.service';
import { InboxEvent } from './inbox-event.entity';
import { ListInboxController } from './list-inbox/list-inbox.controller';
import { MarkInboxReadController } from './mark-inbox-read/mark-inbox-read.controller';

/** `GET /inbox` and `POST /inbox/read`. Imports ProjectModule for access checks. */
@Module({
  imports: [TypeOrmModule.forFeature([InboxEvent]), ProjectModule],
  controllers: [ListInboxController, MarkInboxReadController],
  providers: [InboxFeedService],
})
export class InboxFeedModule {}
