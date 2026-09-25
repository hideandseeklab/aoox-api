import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ImportReport } from '../project-export.types';
import { ProjectImportService } from '../project-import.service';
import { ImportProjectDto } from './import-project.dto';

@Injectable()
export class ImportProjectService {
  constructor(private readonly importer: ProjectImportService) {}

  execute(user: JwtPayload, dto: ImportProjectDto): Promise<ImportReport> {
    return this.importer.import(dto.file, {
      name: dto.name,
      role: user.role,
      ownerId: user.sub,
    });
  }
}
