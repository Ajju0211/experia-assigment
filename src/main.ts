import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfigService } from './shared/config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks();
  configureApp(app);
  const config = app.get(AppConfigService);
  await app.listen(config.port);
  console.log(`Payout service listening on http://localhost:${config.port}/api`);
  console.log(`Swagger API docs & testing UI available at http://localhost:${config.port}/api/docs`);
}
bootstrap();
