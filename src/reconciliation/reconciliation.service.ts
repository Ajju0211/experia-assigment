import { Injectable, Logger } from '@nestjs/common';
import { BankAdapter } from '../bank/bank.adapter';
import { DbService } from '../db/db.service';
import { PayoutsService } from '../payouts/payouts.service';
import { isTerminal, PayoutStatus } from '../payouts/state-machine';
import { ReconciliationReport } from './interfaces/reconciliation-report.interface';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly db: DbService,
    private readonly payouts: PayoutsService,
    private readonly bank: BankAdapter,
  ) {}

  async run(opts: { dryRun?: boolean } = {}): Promise<ReconciliationReport> {
    const dryRun = !!opts.dryRun;
    const report: ReconciliationReport = { dry_run: dryRun, checked: 0, matched: 0, resolved: [], manual_review: [], errors: [] };
    const { rows } = await this.db.query<{ id: string; status: PayoutStatus; bank_reference: string }>(
      'SELECT id, status, bank_reference FROM payouts ORDER BY created_at');

    for (const p of rows) {
      report.checked++;
      try {
        const bank = (await this.bank.getStatus(p.bank_reference)).status;
        if (bank === p.status) { report.matched++; continue; }

        if (isTerminal(p.status)) {
          report.manual_review.push({ payout_id: p.id, local_status: p.status, bank_status: bank, reason: 'Local status is final but bank disagrees' });
        } else if (bank === 'NOT_FOUND') {
          report.manual_review.push({ payout_id: p.id, local_status: p.status, bank_status: bank, reason: 'Bank has no record of this transfer' });
        } else if (dryRun) {
          report.resolved.push({ payout_id: p.id, from: p.status, to: bank, applied: false });
        } else {
          const t = await this.db.tx((c) => this.payouts.transition(c, p.id, bank, 'RECONCILIATION', 'bank status lookup'));
          report.resolved.push({ payout_id: p.id, from: p.status, to: bank, applied: t.applied });
        }
      } catch (err) {
        report.errors.push({ payout_id: p.id, message: err instanceof Error ? err.message : 'unknown error' });
      }
    }
    this.logger.log(`Reconciliation done: checked=${report.checked} matched=${report.matched} resolved=${report.resolved.length} review=${report.manual_review.length} errors=${report.errors.length}`);
    return report;
  }
}

export { ReconciliationReport } from './interfaces/reconciliation-report.interface';
export { ReconciliationController } from './reconciliation.controller';
export { ReconciliationModule } from './reconciliation.module';
