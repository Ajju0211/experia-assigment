import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { PayoutsService } from '../payouts/payouts.service';
import { BankWebhookDto } from './dto/bank-webhook.dto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly db: DbService,
    private readonly payouts: PayoutsService,
  ) {}

  process(dto: BankWebhookDto): Promise<{ result: string }> {
    return this.db.tx(async (c) => {
      const ins = await c.query(
        `INSERT INTO webhook_events (event_id, bank_reference, status, result) VALUES ($1,$2,$3,'RECEIVED')
         ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [dto.event_id, dto.bank_reference, dto.status],
      );
      if (!ins.rowCount) return { result: 'DUPLICATE' };

      const found = await c.query<{ id: string }>('SELECT id FROM payouts WHERE bank_reference = $1', [dto.bank_reference]);
      let result: string;
      if (!found.rows[0]) {
        this.logger.warn('Webhook for unknown bank reference ignored');
        result = 'UNKNOWN_REFERENCE';
      } else {
        const t = await this.payouts.transition(c, found.rows[0].id, dto.status, 'WEBHOOK', `event ${dto.event_id}`);
        result = t.reason;
      }
      await c.query('UPDATE webhook_events SET result = $2 WHERE event_id = $1', [dto.event_id, result]);
      return { result };
    });
  }
}
