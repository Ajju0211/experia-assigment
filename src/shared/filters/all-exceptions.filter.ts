import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiResponse } from '../interfaces/response.interface';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: any = null;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'object' && response !== null) {
        const body = response as Record<string, any>;
        code = body.code ?? (statusCode === 400 ? 'VALIDATION_ERROR' : 'HTTP_ERROR');
        message = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? exception.message);
        details = body.details ?? null;
      } else if (typeof response === 'string') {
        message = response;
      }
    } else {
      this.logger.error(
        exception instanceof Error ? exception.message : 'Unknown error',
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const payload: ApiResponse<null> = {
      success: false,
      statusCode,
      message,
      data: null,
      error: {
        code,
        message,
        details,
      },
      path: req.originalUrl?.split('?')[0] || req.url,
      timestamp: new Date().toISOString(),
    };

    return res.status(statusCode).json(payload);
  }
}
