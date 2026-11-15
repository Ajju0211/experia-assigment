import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { safeEqual } from '../utils/crypto.util';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const token = ctx.switchToHttp().getRequest<Request>().headers['x-admin-token'];
    if (typeof token !== 'string' || !safeEqual(token, this.config.adminToken)) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Invalid admin token' });
    }
    return true;
  }
}
