import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Application } from '../application/application.entity';
import { Domain } from '../application/domain.entity';
import { DockerModule } from '../docker/docker.module';
import { ProxyModule } from '../proxy/proxy.module';
import { MaintenanceModeService } from './maintenance-mode.service';

/**
 * Only reads the Application/Domain entities. Imported by ApplicationModule
 * (the same direction as CertificateModule), never the other way round.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Application, Domain]),
    DockerModule,
    ProxyModule,
  ],
  providers: [MaintenanceModeService],
  exports: [MaintenanceModeService],
})
export class MaintenanceModeModule {}
