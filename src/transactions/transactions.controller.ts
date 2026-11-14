import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentMerchant } from '../shared/decorators/current-merchant.decorator';
import { ApiKeyGuard } from '../shared/guards/api-key.guard';
import { Merchant } from '../shared/interfaces/merchant.interface';
import { ListTransactionsQuery } from './dto/list-transactions.dto';
import { TransactionsService } from './transactions.service';

@Controller('transactions')
@UseGuards(ApiKeyGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  list(@CurrentMerchant() merchant: Merchant, @Query() q: ListTransactionsQuery) {
    return this.transactionsService.list(merchant.id, q);
  }
}

export { ListTransactionsQuery } from './dto/list-transactions.dto';
export { TransactionsModule } from './transactions.module';
