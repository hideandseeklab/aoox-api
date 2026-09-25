import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DockerModule } from '../docker/docker.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreateNotificationController } from './create-notification/create-notification.controller';
import { CreateNotificationService } from './create-notification/create-notification.service';
import { DeleteNotificationController } from './delete-notification/delete-notification.controller';
import { ListNotificationsController } from './list-notifications/list-notifications.controller';
import { Notification } from './notification.entity';
import { NotificationService } from './notification.service';
import { CertificateWatcherService } from './watchers/certificate-watcher.service';
import { DiskWatcherService } from './watchers/disk-watcher.service';
import { TestNotificationController } from './test-notification/test-notification.controller';
import { TestNotificationService } from './test-notification/test-notification.service';

/** Channels are managed here; the application module decides when to broadcast. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    ScheduleModule.forRoot(),
    DockerModule,
  ],
  controllers: [
    CreateNotificationController,
    ListNotificationsController,
    DeleteNotificationController,
    TestNotificationController,
  ],
  providers: [
    NotificationService,
    CreateNotificationService,
    TestNotificationService,
    DiskWatcherService,
    CertificateWatcherService,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
