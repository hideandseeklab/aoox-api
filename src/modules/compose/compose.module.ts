import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationModule } from '../application/application.module';
import { Mount } from '../application/mount.entity';
import { DockerModule } from '../docker/docker.module';
import { GitCredentialModule } from '../git-credential/git-credential.module';
import { ManagedDatabaseModule } from '../managed-database/managed-database.module';
import { NotificationModule } from '../notification/notification.module';
import { ProjectModule } from '../project/project.module';
import { ProxyModule } from '../proxy/proxy.module';
import { TemplateModule } from '../template/template.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { ComposeApp } from './compose-app.entity';
import { ComposeDeployment } from './compose-deployment.entity';
import { ComposeDownNotifierService } from './compose-down-notifier.service';
import { ComposeMetricsController } from './compose-metrics/compose-metrics.controller';
import { ComposeRunnerService } from './compose-runner.service';
import { ComposeService } from './compose.service';
import { ComposeWebhookController } from './compose-webhook/compose-webhook.controller';
import { ComposeWebhookService } from './compose-webhook/compose-webhook.service';
import { GetComposeDeploymentController } from './get-compose-deployment/get-compose-deployment.controller';
import { ListComposeDeploymentsController } from './list-compose-deployments/list-compose-deployments.controller';
import { WebhookDeployComposeController } from './webhook-deploy-compose/webhook-deploy-compose.controller';
import { WebhookDeployComposeService } from './webhook-deploy-compose/webhook-deploy-compose.service';
import { CreateComposeAppController } from './create-compose-app/create-compose-app.controller';
import { CreateComposeAppService } from './create-compose-app/create-compose-app.service';
import { CreateFromTemplateController } from './create-from-template/create-from-template.controller';
import { CreateFromTemplateService } from './create-from-template/create-from-template.service';
import { DeleteComposeAppController } from './delete-compose-app/delete-compose-app.controller';
import { DeployComposeAppController } from './deploy-compose-app/deploy-compose-app.controller';
import { GetComposeAppController } from './get-compose-app/get-compose-app.controller';
import { ListComposeAppsController } from './list-compose-apps/list-compose-apps.controller';
import { StartComposeAppController } from './start-compose-app/start-compose-app.controller';
import { StopComposeAppController } from './stop-compose-app/stop-compose-app.controller';
import { UpdateComposeAppController } from './update-compose-app/update-compose-app.controller';
import { UpdateComposeAppService } from './update-compose-app/update-compose-app.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ComposeApp, ComposeDeployment, Mount]),
    DockerModule,
    // Live per-service metrics read from the background sampler.
    MonitoringModule,
    ProjectModule,
    GitCredentialModule,
    NotificationModule,
    ProxyModule,
    TemplateModule,
    // For EnvResolverService (shared env + database references) and the
    // host-port conflict check in update-compose-app.
    ApplicationModule,
    ManagedDatabaseModule,
  ],
  controllers: [
    CreateComposeAppController,
    CreateFromTemplateController,
    ListComposeAppsController,
    GetComposeAppController,
    UpdateComposeAppController,
    DeleteComposeAppController,
    DeployComposeAppController,
    StopComposeAppController,
    StartComposeAppController,
    ListComposeDeploymentsController,
    GetComposeDeploymentController,
    ComposeMetricsController,
    ComposeWebhookController,
    WebhookDeployComposeController,
  ],
  providers: [
    ComposeService,
    ComposeRunnerService,
    CreateComposeAppService,
    CreateFromTemplateService,
    UpdateComposeAppService,
    ComposeWebhookService,
    WebhookDeployComposeService,
    ComposeDownNotifierService,
  ],
  exports: [ComposeService],
})
export class ComposeModule {}
