import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Application } from '../application/application.entity';
import { ComposeApp } from '../compose/compose-app.entity';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import { PanelDomainSettings } from '../panel-domain/panel-domain-settings.entity';
import { Project } from '../project/project.entity';
import { ProxyModule } from '../proxy/proxy.module';
import { Registry } from '../registry/registry.entity';
import { DismissOnboardingController } from './dismiss-onboarding/dismiss-onboarding.controller';
import { GetOnboardingController } from './get-onboarding/get-onboarding.controller';
import { OnboardingService } from './onboarding.service';

/** Entities only (plus the proxy status), so this module sits on no cycle. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Registry,
      Project,
      Application,
      ManagedDatabase,
      ComposeApp,
      PanelDomainSettings,
    ]),
    ProxyModule,
  ],
  controllers: [GetOnboardingController, DismissOnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
