import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerModule } from '../docker/docker.module';
import { GetPanelDomainController } from './get-panel-domain.controller';
import { PanelDomainSettings } from './panel-domain-settings.entity';
import { PanelDomainService } from './panel-domain.service';
import { UpdatePanelDomainController } from './update-panel-domain.controller';

/** Custom domain for the panel's own web/api containers (owner only). */
@Module({
  imports: [TypeOrmModule.forFeature([PanelDomainSettings]), DockerModule],
  controllers: [GetPanelDomainController, UpdatePanelDomainController],
  providers: [PanelDomainService],
})
export class PanelDomainModule {}
