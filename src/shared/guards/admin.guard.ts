import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { config } from '../../config';
import { safeEqual } from '../utils/crypto.util';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const token = ctx.switchToHttp().getRequest<Request>().headers['x-admin-token'];
    if (typeof token !== 'string' || !safeEqual(token, config.adminToken)) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Invalid admin token' });
    }
    return true;
  }
}
