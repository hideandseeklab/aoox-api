import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectModule } from '../project/project.module';
import { CreateEnvironmentController } from './create-environment/create-environment.controller';
import { CreateVariableSetController } from './create-variable-set/create-variable-set.controller';
import { DeleteEnvironmentController } from './delete-environment/delete-environment.controller';
import { DeleteVariableSetController } from './delete-variable-set/delete-variable-set.controller';
import { DiffEnvironmentsController } from './diff-environments/diff-environments.controller';
import { GetVariableSetController } from './get-variable-set/get-variable-set.controller';
import { ListEnvironmentVersionsController } from './list-environment-versions/list-environment-versions.controller';
import { ListProjectVariableSetsController } from './list-project-variable-sets/list-project-variable-sets.controller';
import { ListVariableSetsController } from './list-variable-sets/list-variable-sets.controller';
import { PromoteEnvironmentController } from './promote-environment/promote-environment.controller';
import { RestoreEnvironmentVersionController } from './restore-environment-version/restore-environment-version.controller';
import { RevealEnvironmentVersionController } from './reveal-environment-version/reveal-environment-version.controller';
import { RevealEnvironmentController } from './reveal-environment/reveal-environment.controller';
import { ShareVariableSetController } from './share-variable-set/share-variable-set.controller';
import { UpdateEnvironmentController } from './update-environment/update-environment.controller';
import { UpdateVariableSetController } from './update-variable-set/update-variable-set.controller';
import { VariableSetAccessService } from './variable-set-access.service';
import { VariableSetEnvironmentVersion } from './variable-set-environment-version.entity';
import { VariableSetEnvironment } from './variable-set-environment.entity';
import { VariableSetEnvironmentService } from './variable-set-environment.service';
import { VariableSetLink } from './variable-set-link.entity';
import { VariableSetLinkService } from './variable-set-link.service';
import { VariableSetProject } from './variable-set-project.entity';
import { VariableSet } from './variable-set.entity';
import { VariableSetService } from './variable-set.service';
import { VariableSetTransferService } from './variable-set-transfer.service';

/**
 * Variable sets ("Variables" in the web). Imports ProjectModule only; the
 * application, compose and project-transfer modules import this one.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      VariableSet,
      VariableSetProject,
      VariableSetEnvironment,
      VariableSetEnvironmentVersion,
      VariableSetLink,
    ]),
    ProjectModule,
  ],
  controllers: [
    ListVariableSetsController,
    CreateVariableSetController,
    GetVariableSetController,
    UpdateVariableSetController,
    DeleteVariableSetController,
    ShareVariableSetController,
    DiffEnvironmentsController,
    CreateEnvironmentController,
    DeleteEnvironmentController,
    RevealEnvironmentController,
    UpdateEnvironmentController,
    ListEnvironmentVersionsController,
    RevealEnvironmentVersionController,
    RestoreEnvironmentVersionController,
    PromoteEnvironmentController,
    ListProjectVariableSetsController,
  ],
  providers: [
    VariableSetAccessService,
    VariableSetEnvironmentService,
    VariableSetLinkService,
    VariableSetService,
    VariableSetTransferService,
  ],
  exports: [
    VariableSetAccessService,
    VariableSetEnvironmentService,
    VariableSetLinkService,
    VariableSetService,
    VariableSetTransferService,
  ],
})
export class VariableSetModule {}
