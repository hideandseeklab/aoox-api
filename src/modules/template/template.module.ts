import { Module } from '@nestjs/common';
import { ListTemplatesController } from './list-templates/list-templates.controller';
import { TemplateService } from './template.service';

@Module({
  controllers: [ListTemplatesController],
  providers: [TemplateService],
  exports: [TemplateService],
})
export class TemplateModule {}
