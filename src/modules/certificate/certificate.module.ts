import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Domain } from '../application/domain.entity';
import { NotificationModule } from '../notification/notification.module';
import { ProxyModule } from '../proxy/proxy.module';
import { ServerModule } from '../server/server.module';
import { CertificateExpiryWatcherService } from './certificate-expiry-watcher.service';
import { CertificateSyncService } from './certificate-sync.service';
import { CustomCertificate } from './certificate.entity';
import { CertificateService } from './certificate.service';
import { CreateCertificateController } from './create-certificate/create-certificate.controller';
import { CreateCertificateService } from './create-certificate/create-certificate.service';
import { DeleteCertificateController } from './delete-certificate/delete-certificate.controller';
import { ListCertificatesController } from './list-certificates/list-certificates.controller';
import { UpdateCertificateController } from './update-certificate/update-certificate.controller';
import { UpdateCertificateService } from './update-certificate/update-certificate.service';

/**
 * Uploaded TLS certificates for application domains. Imported by the
 * application module (assignment + sync); it only reads the `Domain` and
 * `Application` entities and must never import the application module back
 * (cycle).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CustomCertificate, Domain]),
    ProxyModule,
    ServerModule,
    NotificationModule,
  ],
  controllers: [
    CreateCertificateController,
    ListCertificatesController,
    UpdateCertificateController,
    DeleteCertificateController,
  ],
  providers: [
    CertificateService,
    CertificateSyncService,
    CertificateExpiryWatcherService,
    CreateCertificateService,
    UpdateCertificateService,
  ],
  exports: [CertificateService, CertificateSyncService],
})
export class CertificateModule {}
