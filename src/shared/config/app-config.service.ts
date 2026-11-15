import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from './env.validation';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  get port(): number {
    const raw = this.config.get('PORT', 3000, { infer: true });
    return Number(raw ?? 3000);
  }

  get databaseUrl(): string {
    return this.config.getOrThrow<string>('DATABASE_URL', { infer: true });
  }

  get testDatabaseUrl(): string | undefined {
    return this.config.get<string>('TEST_DATABASE_URL', { infer: true });
  }

  get bankWebhookSecret(): string {
    return this.config.getOrThrow<string>('BANK_WEBHOOK_SECRET', { infer: true });
  }

  get adminToken(): string {
    return this.config.getOrThrow<string>('ADMIN_TOKEN', { infer: true });
  }

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development', { infer: true }) ?? 'development';
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  toJSON() {
    return {
      port: this.port,
      nodeEnv: this.nodeEnv,
      databaseUrl: '[REDACTED]',
      bankWebhookSecret: '[REDACTED]',
      adminToken: '[REDACTED]',
    };
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return this.toJSON();
  }
}
