import { Module } from '@nestjs/common';
import { BankModule } from '../bank/bank.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [PayoutsModule, BankModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
