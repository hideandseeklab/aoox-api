import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DockerModule } from '../docker/docker.module';
import { GitCredentialModule } from '../git-credential/git-credential.module';
import { ManagedDatabaseModule } from '../managed-database/managed-database.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { NotificationModule } from '../notification/notification.module';
import { ProjectModule } from '../project/project.module';
import { ProxyModule } from '../proxy/proxy.module';
import { ServerModule } from '../server/server.module';
import { RegistryModule } from '../registry/registry.module';
import { AddDomainController } from './add-domain/add-domain.controller';
import { AddMountController } from './add-mount/add-mount.controller';
import { AddMountService } from './add-mount/add-mount.service';
import { DeleteMountController } from './delete-mount/delete-mount.controller';
import { ListMountsController } from './list-mounts/list-mounts.controller';
import { UpdateMountController } from './update-mount/update-mount.controller';
import { AddDomainService } from './add-domain/add-domain.service';
import { CheckDomainDnsController } from './check-domain-dns/check-domain-dns.controller';
import { CheckDomainDnsService } from './check-domain-dns/check-domain-dns.service';
import { DeleteDomainController } from './delete-domain/delete-domain.controller';
import { ListDomainsController } from './list-domains/list-domains.controller';
import { Domain } from './domain.entity';
import { Mount } from './mount.entity';
import { ApplicationLogsController } from './application-logs/application-logs.controller';
import { ApplicationLogsService } from './application-logs/application-logs.service';
import { Application } from './application.entity';
import { ApplicationMetricsController } from './application-metrics/application-metrics.controller';
import { ApplicationService } from './application.service';
import { CreateLogTicketController } from './create-log-ticket/create-log-ticket.controller';
import { CreateLogTicketService } from './create-log-ticket/create-log-ticket.service';
import { NixpacksBuilderService } from './nixpacks-builder.service';
import { RailpackBuilderService } from './railpack-builder.service';
import { StaticSiteBuilderService } from './static-site-builder.service';
import { ImageDigestService } from './image-digest.service';
import { SwarmDeployService } from './swarm-deploy.service';
import { ServiceHealthWatcherService } from './service-health-watcher.service';
import { SwarmModule } from '../swarm/swarm.module';
import { ImageUpdateWatcherService } from './image-update-watcher.service';
import { CheckImageUpdateService } from './check-image-update/check-image-update.service';
import { CheckImageUpdateController } from './check-image-update/check-image-update.controller';
import { EnvResolverService } from './env-resolver.service';
import { ContainerDownNotifierService } from './container-down-notifier.service';
import { DnsWatcherService } from './dns-watcher.service';
import { DeletePreviewController } from './delete-preview/delete-preview.controller';
import { ListPreviewsController } from './list-previews/list-previews.controller';
import { PreviewDeployment } from './preview-deployment.entity';
import { PreviewService } from './preview.service';
import { DeploymentNotifierService } from './deployment-notifier.service';
import { DeploymentEventsService } from './deployment-events.service';
import { LogsGateway } from './logs.gateway';
import { GetWebhookController } from './get-webhook/get-webhook.controller';
import { GetWebhookService } from './get-webhook/get-webhook.service';
import { RegenerateWebhookController } from './regenerate-webhook/regenerate-webhook.controller';
import { WebhookSecretController } from './webhook-secret/webhook-secret.controller';
import { WebhookDeployController } from './webhook-deploy/webhook-deploy.controller';
import { WebhookDeployService } from './webhook-deploy/webhook-deploy.service';
import { CreateApplicationController } from './create-application/create-application.controller';
import { CreateApplicationService } from './create-application/create-application.service';
import { DeleteApplicationController } from './delete-application/delete-application.controller';
import { DeleteApplicationService } from './delete-application/delete-application.service';
import { DeployApplicationController } from './deploy-application/deploy-application.controller';
import { DeployApplicationService } from './deploy-application/deploy-application.service';
import { Deployment } from './deployment.entity';
import { DeploymentRunnerService } from './deployment-runner.service';
import { GetApplicationController } from './get-application/get-application.controller';
import { GetApplicationService } from './get-application/get-application.service';
import { GetDeploymentController } from './get-deployment/get-deployment.controller';
import { GetDeploymentService } from './get-deployment/get-deployment.service';
import { ListApplicationsController } from './list-applications/list-applications.controller';
import { ListApplicationsService } from './list-applications/list-applications.service';
import { ListDeploymentsController } from './list-deployments/list-deployments.controller';
import { ListDeploymentsService } from './list-deployments/list-deployments.service';
import { RollbackApplicationController } from './rollback-application/rollback-application.controller';
import { RollbackApplicationService } from './rollback-application/rollback-application.service';
import { StartApplicationController } from './start-application/start-application.controller';
import { StartApplicationService } from './start-application/start-application.service';
import { StopApplicationController } from './stop-application/stop-application.controller';
import { StopApplicationService } from './stop-application/stop-application.service';
import { UpdateApplicationController } from './update-application/update-application.controller';
import { UpdateApplicationService } from './update-application/update-application.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Application,
      Deployment,
      Domain,
      Mount,
      PreviewDeployment,
    ]),
    ScheduleModule.forRoot(),
    AuthModule,
    DockerModule,
    GitCredentialModule,
    ProjectModule,
    RegistryModule,
    ProxyModule,
    NotificationModule,
    ManagedDatabaseModule,
    MonitoringModule,
    ServerModule,
    SwarmModule,
  ],
  controllers: [
    CreateApplicationController,
    CheckImageUpdateController,
    ListApplicationsController,
    GetApplicationController,
    UpdateApplicationController,
    DeleteApplicationController,
    DeployApplicationController,
    RollbackApplicationController,
    ListDeploymentsController,
    GetDeploymentController,
    StopApplicationController,
    StartApplicationController,
    ApplicationLogsController,
    AddDomainController,
    AddMountController,
    ListMountsController,
    UpdateMountController,
    DeleteMountController,
    ListDomainsController,
    DeleteDomainController,
    CheckDomainDnsController,
    CreateLogTicketController,
    GetWebhookController,
    RegenerateWebhookController,
    WebhookSecretController,
    WebhookDeployController,
    ApplicationMetricsController,
    ListPreviewsController,
    DeletePreviewController,
  ],
  providers: [
    ApplicationService,
    DeploymentRunnerService,
    CreateApplicationService,
    ListApplicationsService,
    GetApplicationService,
    UpdateApplicationService,
    DeleteApplicationService,
    DeployApplicationService,
    RollbackApplicationService,
    ListDeploymentsService,
    GetDeploymentService,
    StopApplicationService,
    StartApplicationService,
    ApplicationLogsService,
    AddDomainService,
    AddMountService,
    CreateLogTicketService,
    GetWebhookService,
    CheckDomainDnsService,
    WebhookDeployService,
    DeploymentEventsService,
    DeploymentNotifierService,
    PreviewService,
    ContainerDownNotifierService,
    DnsWatcherService,
    EnvResolverService,
    NixpacksBuilderService,
    RailpackBuilderService,
    StaticSiteBuilderService,
    ImageDigestService,
    SwarmDeployService,
    ServiceHealthWatcherService,
    ImageUpdateWatcherService,
    CheckImageUpdateService,
    LogsGateway,
  ],
  exports: [
    EnvResolverService,
    ApplicationService,
    SwarmDeployService,
    RailpackBuilderService,
  ],
})
export class ApplicationModule {}
