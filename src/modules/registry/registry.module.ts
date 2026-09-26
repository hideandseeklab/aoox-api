import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerModule } from '../docker/docker.module';
import { ProxyModule } from '../proxy/proxy.module';
import { CreateRegistryController } from './create-registry/create-registry.controller';
import { CreateRegistryService } from './create-registry/create-registry.service';
import { DeleteRegistryController } from './delete-registry/delete-registry.controller';
import { DeleteRegistryService } from './delete-registry/delete-registry.service';
import { DeleteTagController } from './delete-tag/delete-tag.controller';
import { DeleteTagService } from './delete-tag/delete-tag.service';
import { GarbageCollectController } from './garbage-collect/garbage-collect.controller';
import { GarbageCollectService } from './garbage-collect/garbage-collect.service';
import { GetRegistryCredentialsController } from './get-registry-credentials/get-registry-credentials.controller';
import { GetRegistryCredentialsService } from './get-registry-credentials/get-registry-credentials.service';
import { ListRegistriesController } from './list-registries/list-registries.controller';
import { ListRegistriesService } from './list-registries/list-registries.service';
import { ListRepositoriesController } from './list-repositories/list-repositories.controller';
import { ListRepositoriesService } from './list-repositories/list-repositories.service';
import { ListTagsController } from './list-tags/list-tags.controller';
import { ListTagsService } from './list-tags/list-tags.service';
import { ProvisionSelfHostedController } from './provision-self-hosted/provision-self-hosted.controller';
import { ProvisionSelfHostedService } from './provision-self-hosted/provision-self-hosted.service';
import { Registry } from './registry.entity';
import { RegistryService } from './registry.service';
import { RemoveSelfHostedController } from './remove-self-hosted/remove-self-hosted.controller';
import { RemoveSelfHostedService } from './remove-self-hosted/remove-self-hosted.service';
import { SelfHostedRegistryService } from './self-hosted-registry.service';
import { SelfHostedStatusController } from './self-hosted-status/self-hosted-status.controller';
import { SelfHostedStatusService } from './self-hosted-status/self-hosted-status.service';
import { SetRegistryDomainController } from './set-registry-domain/set-registry-domain.controller';
import { SetRegistryDomainService } from './set-registry-domain/set-registry-domain.service';
import { TestRegistryController } from './test-registry/test-registry.controller';
import { TestRegistryService } from './test-registry/test-registry.service';

@Module({
  imports: [TypeOrmModule.forFeature([Registry]), DockerModule, ProxyModule],
  controllers: [
    // Static routes before ':id' routes so "self-hosted" is not read as an id.
    SelfHostedStatusController,
    ProvisionSelfHostedController,
    RemoveSelfHostedController,
    GarbageCollectController,
    CreateRegistryController,
    ListRegistriesController,
    DeleteRegistryController,
    TestRegistryController,
    ListRepositoriesController,
    ListTagsController,
    DeleteTagController,
    GetRegistryCredentialsController,
    SetRegistryDomainController,
  ],
  providers: [
    RegistryService,
    SelfHostedRegistryService,
    CreateRegistryService,
    ListRegistriesService,
    DeleteRegistryService,
    TestRegistryService,
    SelfHostedStatusService,
    ProvisionSelfHostedService,
    RemoveSelfHostedService,
    GarbageCollectService,
    ListRepositoriesService,
    ListTagsService,
    DeleteTagService,
    GetRegistryCredentialsService,
    SetRegistryDomainService,
  ],
  exports: [RegistryService, SelfHostedRegistryService],
})
export class RegistryModule {}
