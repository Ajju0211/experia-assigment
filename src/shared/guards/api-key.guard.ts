import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { AuthedRequest, Merchant } from '../interfaces/merchant.interface';
import { sha256 } from '../utils/hash.util';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly db: DbService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const key = req.headers['x-api-key'];
    if (typeof key !== 'string' || key.length === 0) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Missing X-API-Key' });
    }
    const { rows } = await this.db.query<Merchant>(
      'SELECT id, name FROM merchants WHERE api_key_hash = $1',
      [sha256(key)],
    );
    if (!rows[0]) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Invalid API key' });
    }
    req.merchant = rows[0];
    return true;
  }
}
