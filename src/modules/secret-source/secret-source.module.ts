import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreateSecretConnectionController } from './create-secret-connection/create-secret-connection.controller';
import { CreateSecretConnectionService } from './create-secret-connection/create-secret-connection.service';
import { DeleteSecretConnectionController } from './delete-secret-connection/delete-secret-connection.controller';
import { ListSecretConnectionsController } from './list-secret-connections/list-secret-connections.controller';
import { SecretConnection } from './secret-connection.entity';
import { SecretSourceService } from './secret-source.service';
import { TestSecretConnectionController } from './test-secret-connection/test-secret-connection.controller';

/**
 * Connections to an external secret manager (Infisical). Imported by the
 * application module (resolver + `secret-source` flows); it must never
 * import the application module back (cycle) — it only owns its own entity.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SecretConnection])],
  controllers: [
    CreateSecretConnectionController,
    ListSecretConnectionsController,
    DeleteSecretConnectionController,
    TestSecretConnectionController,
  ],
  providers: [SecretSourceService, CreateSecretConnectionService],
  exports: [SecretSourceService],
})
export class SecretSourceModule {}
