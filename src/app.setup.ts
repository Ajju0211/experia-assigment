import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Request, Response, NextFunction } from 'express';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';
import { ResponseTransformInterceptor } from './shared/interceptors/response-transform.interceptor';

export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Merchant Payout Service API')
    .setDescription(
      'Mini merchant payout backend: wallet & ledger, idempotent payout initiation, mock bank integration, signed webhooks, and reconciliation.',
    )
    .setVersion('1.0.0')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: 'Merchant API Key (e.g. test_key_acme_00000000000001)',
      },
      'X-API-Key',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Admin-Token',
        in: 'header',
        description: 'Admin Token for Operator reconciliation endpoints',
      },
      'X-Admin-Token',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Bank-Signature',
        in: 'header',
        description: 'HMAC-SHA256 signature for bank callbacks (sha256=<hex_digest>)',
      },
      'X-Bank-Signature',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const options = {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'method',
    },
    customSiteTitle: 'Merchant Payout Service - Swagger UI',
  };

  // Support both /api/docs and /api/doc aliases
  SwaggerModule.setup('api/docs', app, document, options);
  SwaggerModule.setup('api/doc', app, document, options);
  SwaggerModule.setup('docs', app, document, options);

  // Friendly browser redirect from /api/doc or /docs to /api/docs
  app.use((req: Request, res: Response, next: NextFunction) => {
    const rawUrl = req.originalUrl || req.url;
    const cleanPath = rawUrl.split('?')[0].replace(/\/+$/, '');
    if (cleanPath === '/doc' || cleanPath === '/docs') {
      return res.redirect('/api/docs');
    }
    next();
  });
}

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new ResponseTransformInterceptor(),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const details = errors.map((err) => ({
          field: err.property,
          issues: Object.values(err.constraints ?? {}),
        }));
        return new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Input validation failed',
          details,
        });
      },
    }),
  );
  setupSwagger(app);
}
