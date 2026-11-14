import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config';

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function signWebhook(rawBody: string | Buffer, secret = config.bankWebhookSecret): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}
