import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { AuditLogService } from './audit-log.service';
import { ListAuditLogsController } from './list-audit-logs/list-audit-logs.controller';

/** Global: the sign-in service logs attempts itself, so it needs the service too. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), ScheduleModule.forRoot()],
  controllers: [ListAuditLogsController],
  providers: [
    AuditLogService,
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
  exports: [AuditLogService],
})
export class AuditLogModule {}
