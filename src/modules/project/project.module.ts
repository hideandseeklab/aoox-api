import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerModule } from '../docker/docker.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { CreateProjectController } from './create-project/create-project.controller';
import { CreateProjectService } from './create-project/create-project.service';
import { DeleteProjectController } from './delete-project/delete-project.controller';
import { DeleteProjectService } from './delete-project/delete-project.service';
import { GetProjectController } from './get-project/get-project.controller';
import { GetProjectService } from './get-project/get-project.service';
import { ListProjectsController } from './list-projects/list-projects.controller';
import { ListProjectsService } from './list-projects/list-projects.service';
import { AddMemberController } from './add-member/add-member.controller';
import { AddMemberService } from './add-member/add-member.service';
import { ListMembersController } from './list-members/list-members.controller';
import { ListMembersService } from './list-members/list-members.service';
import { RemoveMemberController } from './remove-member/remove-member.controller';
import { UpdateMemberController } from './update-member/update-member.controller';
import { CreateEnvironmentController } from './create-environment/create-environment.controller';
import { DeleteEnvironmentController } from './delete-environment/delete-environment.controller';
import { ListEnvironmentsController } from './list-environments/list-environments.controller';
import { RevealEnvironmentController } from './reveal-environment/reveal-environment.controller';
import { UpdateEnvironmentController } from './update-environment/update-environment.controller';
import { ListEnvironmentVersionsController } from './list-environment-versions/list-environment-versions.controller';
import { RevealEnvironmentVersionController } from './reveal-environment-version/reveal-environment-version.controller';
import { RestoreEnvironmentVersionController } from './restore-environment-version/restore-environment-version.controller';
import { DiffEnvironmentsController } from './diff-environments/diff-environments.controller';
import { PromoteEnvironmentController } from './promote-environment/promote-environment.controller';
import { ProjectEnvironmentVersion } from './environment-version.entity';
import { ProjectEnvironment } from './project-environment.entity';
import { ProjectEnvironmentService } from './project-environment.service';
import { ProjectAccessService } from './project-access.service';
import { ProjectMember } from './project-member.entity';
import { Project } from './project.entity';
import { ProjectResourceUsageController } from './project-resource-usage/project-resource-usage.controller';
import { ProjectResourceUsageService } from './project-resource-usage/project-resource-usage.service';
import { ProjectSummaryController } from './project-summary/project-summary.controller';
import { ProjectService } from './project.service';
import { UpdateProjectController } from './update-project/update-project.controller';
import { UpdateProjectService } from './update-project/update-project.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      ProjectMember,
      ProjectEnvironment,
      ProjectEnvironmentVersion,
    ]),
    DockerModule,
    MonitoringModule,
  ],
  controllers: [
    CreateProjectController,
    ListMembersController,
    AddMemberController,
    UpdateMemberController,
    RemoveMemberController,
    ListProjectsController,
    ProjectSummaryController,
    GetProjectController,
    UpdateProjectController,
    DeleteProjectController,
    ProjectResourceUsageController,
    ListEnvironmentsController,
    RevealEnvironmentController,
    UpdateEnvironmentController,
    CreateEnvironmentController,
    DeleteEnvironmentController,
    ListEnvironmentVersionsController,
    RevealEnvironmentVersionController,
    RestoreEnvironmentVersionController,
    DiffEnvironmentsController,
    PromoteEnvironmentController,
  ],
  providers: [
    ProjectService,
    ProjectAccessService,
    ListMembersService,
    AddMemberService,
    CreateProjectService,
    ListProjectsService,
    GetProjectService,
    UpdateProjectService,
    DeleteProjectService,
    ProjectResourceUsageService,
    ProjectEnvironmentService,
  ],
  exports: [ProjectService, ProjectAccessService, ProjectEnvironmentService],
})
export class ProjectModule {}
