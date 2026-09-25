import { BadRequestException, Injectable } from '@nestjs/common';
import { ApplicationService } from '../application.service';
import {
  ImageCheckResult,
  ImageUpdateWatcherService,
} from '../image-update-watcher.service';

@Injectable()
export class CheckImageUpdateService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly watcher: ImageUpdateWatcherService,
  ) {}

  async execute(
    ownerId: string,
    applicationId: string,
    deploy: boolean,
  ): Promise<ImageCheckResult> {
    const app = await this.applications.findOwnedOrFail(applicationId, ownerId);
    if (app.sourceType !== 'image' || !app.imageRef) {
      throw new BadRequestException(
        'Only applications deployed from an image can be checked',
      );
    }
    try {
      return await this.watcher.check(app, deploy);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
