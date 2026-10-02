import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Application } from '../application/application.entity';
import { ApplicationModule } from '../application/application.module';
import { Deployment } from '../application/deployment.entity';
import { Domain } from '../application/domain.entity';
import { NotificationModule } from '../notification/notification.module';
import { ProxyModule } from '../proxy/proxy.module';
import { Server } from '../server/server.entity';
import { CheckHttpMonitorController } from './check-http-monitor/check-http-monitor.controller';
import { GetHttpMonitorController } from './get-http-monitor/get-http-monitor.controller';
import { HttpCheck } from './http-check.entity';
import { HttpIncident } from './http-incident.entity';
import { HttpMonitor } from './http-monitor.entity';
import { HttpMonitorService } from './http-monitor.service';
import { UpdateHttpMonitorController } from './update-http-monitor/update-http-monitor.controller';
import { UpdateHttpMonitorService } from './update-http-monitor/update-http-monitor.service';

/** Optional per-application HTTP check: config, scheduler, history, alerts. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      HttpMonitor,
      HttpCheck,
      HttpIncident,
      Application,
      Domain,
      Deployment,
      Server,
    ]),
    ScheduleModule.forRoot(),
    ApplicationModule,
    NotificationModule,
    ProxyModule,
  ],
  controllers: [
    GetHttpMonitorController,
    UpdateHttpMonitorController,
    CheckHttpMonitorController,
  ],
  providers: [HttpMonitorService, UpdateHttpMonitorService],
  exports: [HttpMonitorService],
})
export class HttpMonitorModule {}
