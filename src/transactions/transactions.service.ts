import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { ListTransactionsQuery } from './dto/list-transactions.dto';

@Injectable()
export class TransactionsService {
  constructor(private readonly db: DbService) {}

  async list(merchantId: string, q: ListTransactionsQuery) {
    const where = ['l.merchant_id = $1'];
    const params: any[] = [merchantId];
    if (q.status) {
      params.push(q.status);
      where.push(`p.status = $${params.length}`);
    }
    if (q.type) {
      params.push(q.type);
      where.push(`l.type = $${params.length}`);
    }
    const clause = where.join(' AND ');
    const from = 'FROM ledger_entries l LEFT JOIN payouts p ON p.id = l.payout_id';

    const total = await this.db.query<{ n: string }>(`SELECT count(*) AS n ${from} WHERE ${clause}`, params);
    const { rows } = await this.db.query(
      `SELECT l.id, l.type, l.amount_paise, l.available_after_paise, l.reserved_after_paise,
              l.payout_id, p.status AS payout_status, l.description, l.created_at
       ${from} WHERE ${clause}
       ORDER BY l.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.limit, (q.page - 1) * q.limit],
    );
    return { data: rows, page: q.page, limit: q.limit, total: Number(total.rows[0].n) };
  }
}
