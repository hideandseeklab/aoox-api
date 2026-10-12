import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationModule } from '../application/application.module';
import { Deployment } from '../application/deployment.entity';
import { ManagedDatabaseModule } from '../managed-database/managed-database.module';
import { MetricSample } from '../monitoring/metric-sample.entity';
import { NotificationModule } from '../notification/notification.module';
import {
  ApplicationResourceAlertsController,
  DatabaseResourceAlertsController,
} from './resource-alerts.controller';
import { ResourceAlertRule } from './resource-alert-rule.entity';
import { ResourceAlertService } from './resource-alert.service';

/** Optional CPU / memory threshold alerts per application and database. */
@Module({
  imports: [
    TypeOrmModule.forFeature([ResourceAlertRule, MetricSample, Deployment]),
    ScheduleModule.forRoot(),
    ApplicationModule,
    ManagedDatabaseModule,
    NotificationModule,
  ],
  controllers: [
    ApplicationResourceAlertsController,
    DatabaseResourceAlertsController,
  ],
  providers: [ResourceAlertService],
  exports: [ResourceAlertService],
})
export class ResourceAlertModule {}
