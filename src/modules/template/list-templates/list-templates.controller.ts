import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TemplateService } from '../template.service';
import { Template } from '../template.types';

/** Static catalog; the compose text is included so the web can preview it. */
@Controller('templates')
@UseGuards(JwtAuthGuard)
export class ListTemplatesController {
  constructor(private readonly templates: TemplateService) {}

  @Get()
  list(): readonly Template[] {
    return this.templates.list();
  }
}
