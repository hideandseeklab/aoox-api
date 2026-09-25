import { IsEmail, IsIn, IsUUID } from 'class-validator';
import { PROJECT_ROLES, type ProjectRole } from './project-member.entity';

export class ProjectMemberParamsDto {
  @IsUUID()
  id: string;
}

export class ProjectMemberUserParamsDto extends ProjectMemberParamsDto {
  @IsUUID()
  userId: string;
}

/** What the members list returns: user summary + project role. */
export class ProjectMemberDto {
  userId: string;
  email: string;
  name: string;
  /** Platform role, for the UI (owners/admins cannot be removed from a project). */
  platformRole: string;
  role: ProjectRole;
  /** Implicit membership (creator or platform owner/admin) has no row to edit. */
  implicit: boolean;
}

export class ProjectMembersResponseDto {
  /** The acting user's role in this project. */
  myRole: ProjectRole;
  members: ProjectMemberDto[];
}

export class AddProjectMemberDto {
  @IsEmail()
  email: string;

  @IsIn(PROJECT_ROLES)
  role: ProjectRole;
}

export class UpdateProjectMemberDto {
  @IsIn(PROJECT_ROLES)
  role: ProjectRole;
}
