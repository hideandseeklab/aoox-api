import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('describes the API and its running version', () => {
      const info = appController.info();
      expect(info.description).toBe('aoox api');
      expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('favicon', () => {
    it('serves the inline SVG mark', () => {
      expect(appController.favicon()).toMatch(/^<svg[\s\S]*<\/svg>$/);
    });
  });
});
