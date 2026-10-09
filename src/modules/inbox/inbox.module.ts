import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Application } from '../application/application.entity';
import { ComposeApp } from '../compose/compose-app.entity';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import { InboxEvent } from './inbox-event.entity';
import { InboxService } from './inbox.service';

/**
 * Storage and recording only, with entities rather than feature modules, so
 * `NotificationModule` can import it without a cycle (reading needs project
 * access, which is `InboxFeedModule`).
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      InboxEvent,
      Application,
      ComposeApp,
      ManagedDatabase,
    ]),
  ],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
