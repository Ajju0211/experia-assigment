import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthedRequest, Merchant } from '../interfaces/merchant.interface';

export const CurrentMerchant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Merchant => ctx.switchToHttp().getRequest<AuthedRequest>().merchant,
);
