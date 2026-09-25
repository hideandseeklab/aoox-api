import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import { Project } from './project.entity';

/**
 * `admin` manages members and may delete the project; `developer` deploys
 * and edits; `viewer` reads. (Only membership itself is enforced for now —
 * see ProjectAccessService; levels arrive with the next pass.)
 */
export type ProjectRole = 'admin' | 'developer' | 'viewer';
export const PROJECT_ROLES: ProjectRole[] = ['admin', 'developer', 'viewer'];

/** Who may see a project. Platform owners/admins and the project's creator need no row. */
@Entity({ name: 'project_members' })
@Index(['projectId', 'userId'], { unique: true })
export class ProjectMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', default: 'developer' })
  role: ProjectRole;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
