import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { safeEqual, signWebhook } from '../utils/crypto.util';

@Injectable()
export class BankSignatureGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const sig = req.headers['x-bank-signature'];
    if (
      typeof sig !== 'string' ||
      !req.rawBody ||
      !safeEqual(sig, signWebhook(req.rawBody, this.config.bankWebhookSecret))
    ) {
      throw new UnauthorizedException({ code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' });
    }
    return true;
  }
}
