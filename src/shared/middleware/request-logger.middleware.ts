import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { redact } from '../utils/redact.util';

const logger = new Logger('HTTP');

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on('finish', () => {
    logger.log(
      JSON.stringify(
        redact({
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          ms: Date.now() - start,
          merchant_id: (req as any).merchant?.id,
          'x-api-key': req.headers['x-api-key'],
          body: req.body,
        }),
      ),
    );
  });
  next();
}
