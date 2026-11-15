import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfigModule } from '../src/shared/config/app-config.module';
import { AppConfigService } from '../src/shared/config/app-config.service';
import { EnvironmentVariables, validateEnvironment } from '../src/shared/config/env.validation';

describe('Configuration System', () => {
  describe('validateEnvironment', () => {
    const validBaseConfig = {
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/test_db',
      BANK_WEBHOOK_SECRET: 'super_secret_webhook_key',
      ADMIN_TOKEN: 'super_secret_admin_token',
    };

    it('should validate and parse valid environment configuration with defaults', () => {
      const result = validateEnvironment(validBaseConfig);
      expect(result).toBeInstanceOf(EnvironmentVariables);
      expect(result.PORT).toBe(3000);
      expect(result.NODE_ENV).toBe('development');
      expect(result.DATABASE_URL).toBe(validBaseConfig.DATABASE_URL);
      expect(result.BANK_WEBHOOK_SECRET).toBe(validBaseConfig.BANK_WEBHOOK_SECRET);
      expect(result.ADMIN_TOKEN).toBe(validBaseConfig.ADMIN_TOKEN);
      expect(result.TEST_DATABASE_URL).toBeUndefined();
    });

    it('should coerce string PORT into an integer', () => {
      const result = validateEnvironment({
        ...validBaseConfig,
        PORT: '8080',
      });
      expect(typeof result.PORT).toBe('number');
      expect(result.PORT).toBe(8080);
    });

    it('should accept custom NODE_ENV and TEST_DATABASE_URL', () => {
      const result = validateEnvironment({
        ...validBaseConfig,
        NODE_ENV: 'test',
        TEST_DATABASE_URL: 'postgres://localhost/test_override',
      });
      expect(result.NODE_ENV).toBe('test');
      expect(result.TEST_DATABASE_URL).toBe('postgres://localhost/test_override');
    });

    it('should throw when mandatory DATABASE_URL is missing', () => {
      const config = { ...validBaseConfig };
      delete (config as any).DATABASE_URL;

      expect(() => validateEnvironment(config)).toThrow(
        /DATABASE_URL is required and cannot be empty/,
      );
    });

    it('should throw when mandatory BANK_WEBHOOK_SECRET is missing', () => {
      const config = { ...validBaseConfig };
      delete (config as any).BANK_WEBHOOK_SECRET;

      expect(() => validateEnvironment(config)).toThrow(
        /BANK_WEBHOOK_SECRET is required and cannot be empty/,
      );
    });

    it('should throw when mandatory ADMIN_TOKEN is missing', () => {
      const config = { ...validBaseConfig };
      delete (config as any).ADMIN_TOKEN;

      expect(() => validateEnvironment(config)).toThrow(
        /ADMIN_TOKEN is required and cannot be empty/,
      );
    });

    it('should throw when PORT is out of range or not an integer', () => {
      expect(() =>
        validateEnvironment({
          ...validBaseConfig,
          PORT: '70000',
        }),
      ).toThrow(/PORT must not be greater than 65535/);

      expect(() =>
        validateEnvironment({
          ...validBaseConfig,
          PORT: 'invalid_port',
        }),
      ).toThrow(/PORT must be an integer number/);

      expect(() =>
        validateEnvironment({
          ...validBaseConfig,
          PORT: '0',
        }),
      ).toThrow(/PORT must not be less than 1/);
    });
  });

  describe('AppConfigService', () => {
    it('should return strongly-typed config values and environment helpers', () => {
      const mockConfigService = new ConfigService<EnvironmentVariables, true>({
        PORT: 4000,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://prod_db:5432/payouts',
        TEST_DATABASE_URL: 'postgres://test_db:5432/payouts_test',
        BANK_WEBHOOK_SECRET: 'prod_wh_secret',
        ADMIN_TOKEN: 'prod_admin_secret',
      });

      const service = new AppConfigService(mockConfigService);

      expect(service.port).toBe(4000);
      expect(service.databaseUrl).toBe('postgres://prod_db:5432/payouts');
      expect(service.testDatabaseUrl).toBe('postgres://test_db:5432/payouts_test');
      expect(service.bankWebhookSecret).toBe('prod_wh_secret');
      expect(service.adminToken).toBe('prod_admin_secret');
      expect(service.nodeEnv).toBe('production');
      expect(service.isProduction).toBe(true);
      expect(service.isDevelopment).toBe(false);
      expect(service.isTest).toBe(false);
    });

    it('should fall back to default port 3000 if PORT is not set in config or env', () => {
      const originalPort = process.env.PORT;
      const originalNodeEnv = process.env.NODE_ENV;
      delete process.env.PORT;
      delete process.env.NODE_ENV;
      try {
        const mockConfigService = new ConfigService<EnvironmentVariables, true>({
          DATABASE_URL: 'postgres://localhost:5432/payouts',
          BANK_WEBHOOK_SECRET: 'secret',
          ADMIN_TOKEN: 'token',
        });

        const service = new AppConfigService(mockConfigService);
        expect(service.port).toBe(3000);
        expect(service.nodeEnv).toBe('development');
        expect(service.isDevelopment).toBe(true);
      } finally {
        if (originalPort !== undefined) {
          process.env.PORT = originalPort;
        }
        if (originalNodeEnv !== undefined) {
          process.env.NODE_ENV = originalNodeEnv;
        }
      }
    });

    it('should throw via getOrThrow when mandatory values are missing', () => {
      const originalEnv = {
        db: process.env.DATABASE_URL,
        secret: process.env.BANK_WEBHOOK_SECRET,
        admin: process.env.ADMIN_TOKEN,
      };
      delete process.env.DATABASE_URL;
      delete process.env.BANK_WEBHOOK_SECRET;
      delete process.env.ADMIN_TOKEN;

      try {
        const mockConfigService = new ConfigService<EnvironmentVariables, true>({});
        const service = new AppConfigService(mockConfigService);

        expect(() => service.databaseUrl).toThrow(/DATABASE_URL/);
        expect(() => service.bankWebhookSecret).toThrow(/BANK_WEBHOOK_SECRET/);
        expect(() => service.adminToken).toThrow(/ADMIN_TOKEN/);
      } finally {
        if (originalEnv.db) process.env.DATABASE_URL = originalEnv.db;
        if (originalEnv.secret) process.env.BANK_WEBHOOK_SECRET = originalEnv.secret;
        if (originalEnv.admin) process.env.ADMIN_TOKEN = originalEnv.admin;
      }
    });

    it('should redact secrets in toJSON and util.inspect', () => {
      const mockConfigService = new ConfigService<EnvironmentVariables, true>({
        PORT: 3000,
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://secret_user:secret_pass@localhost/db',
        BANK_WEBHOOK_SECRET: 'top_secret_bank_key',
        ADMIN_TOKEN: 'top_secret_admin_key',
      });

      const service = new AppConfigService(mockConfigService);
      const json = service.toJSON();

      expect(json.port).toBe(3000);
      expect(json.nodeEnv).toBe('test');
      expect(json.databaseUrl).toBe('[REDACTED]');
      expect(json.bankWebhookSecret).toBe('[REDACTED]');
      expect(json.adminToken).toBe('[REDACTED]');
      expect(JSON.stringify(json)).not.toContain('secret_user');
      expect(JSON.stringify(json)).not.toContain('top_secret_bank_key');
      expect(JSON.stringify(json)).not.toContain('top_secret_admin_key');
    });
  });

  describe('AppConfigModule NestJS Integration', () => {
    let moduleRef: TestingModule;

    afterEach(async () => {
      if (moduleRef) {
        await moduleRef.close();
      }
    });

    it('should compile AppConfigModule and inject AppConfigService', async () => {
      moduleRef = await Test.createTestingModule({
        imports: [AppConfigModule],
      }).compile();

      const configService = moduleRef.get(AppConfigService);
      expect(configService).toBeDefined();
      expect(configService.databaseUrl).toBeDefined();
      expect(configService.bankWebhookSecret).toBeDefined();
      expect(configService.adminToken).toBeDefined();
    });
  });
});
