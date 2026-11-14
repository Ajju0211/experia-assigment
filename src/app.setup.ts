import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';
import { ResponseTransformInterceptor } from './shared/interceptors/response-transform.interceptor';

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
}
