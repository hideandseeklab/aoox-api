// Load .env before decorators evaluate (gateway CORS reads process.env at import time).
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: webhook signatures (X-Hub-Signature-256) are computed over the exact bytes.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Browser-side clients (e.g. the terminal socket) connect directly.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? true });
  // OpenAPI at /docs (UI) and /docs-json; DTO shapes come from the swagger CLI plugin (nest-cli.json).
  const openapi = new DocumentBuilder()
    .setTitle('aoox API')
    .setDescription(
      'Self-hosted PaaS API. Authenticate with `Authorization: Bearer <jwt>` (from `POST /auth/sign-in`) or a personal access token `aoox_…` (Settings → API tokens).',
    )
    .setVersion(process.env.npm_package_version ?? '0.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    () => SwaggerModule.createDocument(app, openapi),
    { customSiteTitle: 'aoox API', customfavIcon: '/favicon.svg' },
  );
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
