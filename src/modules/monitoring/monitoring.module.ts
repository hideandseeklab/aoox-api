import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerModule } from '../docker/docker.module';
import { HostLiveController } from './host-live/host-live.controller';
import { HostMetricsService } from './host-metrics.service';
import { HostOverviewController } from './host-overview/host-overview.controller';
import { MetricRetentionService } from './metric-retention.service';
import { MetricSample } from './metric-sample.entity';
import { MonitoringService } from './monitoring.service';

/** Background sampler + host overview; per-resource metrics flows live in their modules. */
@Module({
  imports: [
    TypeOrmModule.forFeature([MetricSample]),
    ScheduleModule.forRoot(),
    DockerModule,
  ],
  controllers: [HostOverviewController, HostLiveController],
  providers: [MonitoringService, HostMetricsService, MetricRetentionService],
  exports: [MonitoringService, MetricRetentionService],
})
export class MonitoringModule {}
