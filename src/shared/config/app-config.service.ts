import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from './env.validation';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  get port(): number {
    return this.config.get('PORT', { infer: true }) ?? 3000;
  }

  get databaseUrl(): string {
    return this.config.get('DATABASE_URL', { infer: true });
  }

  get testDatabaseUrl(): string | undefined {
    return this.config.get('TEST_DATABASE_URL', { infer: true });
  }

  get bankWebhookSecret(): string {
    return this.config.get('BANK_WEBHOOK_SECRET', { infer: true });
  }

  get adminToken(): string {
    return this.config.get('ADMIN_TOKEN', { infer: true });
  }
}
