import { plainToInstance } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

export class EnvironmentVariables {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsNotEmpty({ message: 'DATABASE_URL is required and cannot be empty' })
  @IsString()
  DATABASE_URL: string;

  @IsOptional()
  @IsString()
  TEST_DATABASE_URL?: string;

  @IsNotEmpty({ message: 'BANK_WEBHOOK_SECRET is required and cannot be empty' })
  @IsString()
  BANK_WEBHOOK_SECRET: string;

  @IsNotEmpty({ message: 'ADMIN_TOKEN is required and cannot be empty' })
  @IsString()
  ADMIN_TOKEN: string;
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`[ConfigModule] Environment validation failed: ${errorMessages}`);
  }

  return validatedConfig;
}
