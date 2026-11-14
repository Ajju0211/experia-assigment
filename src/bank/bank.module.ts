import { Module } from '@nestjs/common';
import { BankAdapter } from './bank.adapter';
import { MockBankAdapter } from './mock-bank.adapter';

@Module({
  providers: [{ provide: BankAdapter, useClass: MockBankAdapter }],
  exports: [BankAdapter],
})
export class BankModule {}
