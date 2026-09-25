import { IsIn, IsObject, IsOptional, IsString, Matches } from 'class-validator';

export class NodeParamsDto {
  @IsString()
  @Matches(/^[a-z0-9]{10,64}$/, { message: 'invalid node id' })
  id: string;
}

export class UpdateNodeDto {
  @IsOptional()
  @IsIn(['active', 'pause', 'drain'])
  availability?: 'active' | 'pause' | 'drain';

  @IsOptional()
  @IsIn(['manager', 'worker'])
  role?: 'manager' | 'worker';

  /** Replaces the node's label set (`node.labels.<key>` in constraints). */
  @IsOptional()
  @IsObject()
  labels?: Record<string, string>;
}
