import { Injectable } from '@nestjs/common';
import { appVersion } from './modules/auth/me/app-version';

/** Body of `GET /`: tells a visitor (or a script) what is answering here. */
export interface ApiInfo {
  description: string;
  version: string;
}

@Injectable()
export class AppService {
  info(): ApiInfo {
    return { description: 'aoox api', version: appVersion() };
  }
}
