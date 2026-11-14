import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { redact } from '../utils/redact.util';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const start = Date.now();
    const method = req.method;
    const path = req.originalUrl?.split('?')[0] || req.url;

    return next.handle().pipe(
      tap((responseBody) => {
        const duration = Date.now() - start;
        const status = res.statusCode;

        this.logger.log(
          JSON.stringify(
            redact({
              type: 'HTTP_RESPONSE',
              method,
              path,
              status,
              ms: duration,
              merchant_id: (req as any).merchant?.id,
              'x-api-key': req.headers['x-api-key'],
              body: req.body,
              response: responseBody,
            }),
          ),
        );
      }),
      catchError((error) => {
        const duration = Date.now() - start;
        const status =
          error.status || (typeof error.getStatus === 'function' ? error.getStatus() : 500);

        this.logger.error(
          JSON.stringify(
            redact({
              type: 'HTTP_ERROR',
              method,
              path,
              status,
              ms: duration,
              merchant_id: (req as any).merchant?.id,
              'x-api-key': req.headers['x-api-key'],
              body: req.body,
              error: error.message || 'Internal server error',
            }),
          ),
        );

        return throwError(() => error);
      }),
    );
  }
}
