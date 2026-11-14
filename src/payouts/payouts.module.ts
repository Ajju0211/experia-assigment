import { Module } from '@nestjs/common';
import { BankModule } from '../bank/bank.module';
import { WalletModule } from '../wallet/wallet.module';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [WalletModule, BankModule],
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
