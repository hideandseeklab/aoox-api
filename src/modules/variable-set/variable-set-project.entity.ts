import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Project } from '../project/project.entity';
import { VariableSet } from './variable-set.entity';

/** A project a variable set is shared with (besides `shared_with_all`). */
@Entity({ name: 'variable_set_projects' })
export class VariableSetProject {
  @PrimaryColumn({
    name: 'variable_set_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_variable_set_projects',
  })
  variableSetId: string;

  @PrimaryColumn({
    name: 'project_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_variable_set_projects',
  })
  projectId: string;

  @ManyToOne(() => VariableSet, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'variable_set_id',
    foreignKeyConstraintName: 'FK_variable_set_projects_set',
  })
  variableSet: VariableSet;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'project_id',
    foreignKeyConstraintName: 'FK_variable_set_projects_project',
  })
  project: Project;
}
