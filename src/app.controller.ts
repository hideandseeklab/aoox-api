import { Controller, Get, Header } from '@nestjs/common';
import { ApiInfo, AppService } from './app.service';
import { FAVICON_SVG } from './favicon';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Direct access to the API base URL: name and running version as JSON. */
  @Get()
  info(): ApiInfo {
    return this.appService.info();
  }

  /** Same icon as the web app; `/favicon.ico` is what browsers request by default. */
  @Get(['favicon.svg', 'favicon.ico'])
  @Header('Content-Type', 'image/svg+xml')
  @Header('Cache-Control', 'public, max-age=86400')
  favicon(): string {
    return FAVICON_SVG;
  }
}
