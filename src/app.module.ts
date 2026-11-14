import { Module } from '@nestjs/common';
import { BankModule } from './bank/bank.module';
import { DbModule } from './db/db.module';
import { PayoutsModule } from './payouts/payouts.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { SharedModule } from './shared/shared.module';
import { TransactionsModule } from './transactions/transactions.module';
import { WalletModule } from './wallet/wallet.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    DbModule,
    SharedModule,
    BankModule,
    WalletModule,
    PayoutsModule,
    TransactionsModule,
    WebhooksModule,
    ReconciliationModule,
  ],
})
export class AppModule {}
