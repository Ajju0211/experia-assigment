import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { config } from './config';

async function bootstrap() {
  // rawBody: true keeps the exact bytes of each request so the webhook HMAC signature can be verified.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  await app.listen(config.port);
  console.log(`Payout service listening on http://localhost:${config.port}/api`);
}
bootstrap();
