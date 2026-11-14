import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentMerchant } from '../shared/decorators/current-merchant.decorator';
import { ApiKeyGuard } from '../shared/guards/api-key.guard';
import { Merchant } from '../shared/interfaces/merchant.interface';
import { ListTransactionsQuery } from './dto/list-transactions.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('Transactions')
@ApiSecurity('X-API-Key')
@Controller('transactions')
@UseGuards(ApiKeyGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'List transactions & ledger entries with pagination' })
  @ApiResponse({ status: 200, description: 'Paginated transactions list' })
  @ApiResponse({ status: 401, description: 'Unauthenticated - missing or invalid API key' })
  list(@CurrentMerchant() merchant: Merchant, @Query() q: ListTransactionsQuery) {
    return this.transactionsService.list(merchant.id, q);
  }
}

export { ListTransactionsQuery } from './dto/list-transactions.dto';
export { TransactionsModule } from './transactions.module';
