import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApiTokenModule } from './modules/api-token/api-token.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { ApplicationModule } from './modules/application/application.module';
import { AuthModule } from './modules/auth/auth.module';
import { RequestContextMiddleware } from './modules/auth/request-context';
import { BackupDestinationModule } from './modules/backup-destination/backup-destination.module';
import { DatabaseBackupModule } from './modules/database-backup/database-backup.module';
import { ComposeModule } from './modules/compose/compose.module';
import { ComposeMountModule } from './modules/compose-mount/compose-mount.module';
import { InstanceBackupModule } from './modules/instance-backup/instance-backup.module';
import { InvitationModule } from './modules/invitation/invitation.module';
import { DatabaseMountModule } from './modules/database-mount/database-mount.module';
import { DatabaseModule } from './modules/database/database.module';
import { GitCredentialModule } from './modules/git-credential/git-credential.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { NotificationModule } from './modules/notification/notification.module';
import { JobModule } from './modules/job/job.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { ManagedDatabaseModule } from './modules/managed-database/managed-database.module';
import { PanelDomainModule } from './modules/panel-domain/panel-domain.module';
import { ProjectModule } from './modules/project/project.module';
import { ProjectTransferModule } from './modules/project-transfer/project-transfer.module';
import { ProxyModule } from './modules/proxy/proxy.module';
import { RegistryModule } from './modules/registry/registry.module';
import { ServerModule } from './modules/server/server.module';
import { SwarmModule } from './modules/swarm/swarm.module';
import { TemplateModule } from './modules/template/template.module';
import { TerminalModule } from './modules/terminal/terminal.module';
import { UserModule } from './modules/user/user.module';
import { VolumeBackupModule } from './modules/volume-backup/volume-backup.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global baseline; auth endpoints tighten this with @Throttle().
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }] }),
    DatabaseModule,
    UserModule,
    AuthModule,
    ApiTokenModule,
    AuditLogModule,
    ProjectModule,
    ProjectTransferModule,
    TerminalModule,
    ServerModule,
    SwarmModule,
    NotificationModule,
    MonitoringModule,
    ComposeModule,
    TemplateModule,
    JobModule,
    VolumeBackupModule,
    MaintenanceModule,
    DatabaseMountModule,
    ComposeMountModule,
    InvitationModule,
    InstanceBackupModule,
    RegistryModule,
    ApplicationModule,
    ProxyModule,
    PanelDomainModule,
    GitCredentialModule,
    ManagedDatabaseModule,
    BackupDestinationModule,
    DatabaseBackupModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  /** Every request runs inside an AsyncLocalStorage store (see request-context.ts). */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
