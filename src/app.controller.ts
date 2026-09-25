import { Controller, Get, Header } from '@nestjs/common';
import { AppService } from './app.service';
import { FAVICON_SVG } from './favicon';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** Same icon as the web app; `/favicon.ico` is what browsers request by default. */
  @Get(['favicon.svg', 'favicon.ico'])
  @Header('Content-Type', 'image/svg+xml')
  @Header('Cache-Control', 'public, max-age=86400')
  favicon(): string {
    return FAVICON_SVG;
  }
}
