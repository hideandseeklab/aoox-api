import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { ProjectAccessService } from './project-access.service';
import { ProjectMember } from './project-member.entity';
import { Project } from './project.entity';
import { ProjectSummaryController } from './project-summary/project-summary.controller';
import { ProjectService } from './project.service';
import { UpdateProjectController } from './update-project/update-project.controller';
import { UpdateProjectService } from './update-project/update-project.service';

@Module({
  imports: [TypeOrmModule.forFeature([Project, ProjectMember])],
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
  ],
  exports: [ProjectService, ProjectAccessService],
})
export class ProjectModule {}
