import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PAYOUT_STATUSES, PayoutStatus } from '../../payouts/state-machine';

export const LEDGER_TYPES = ['CREDIT', 'PAYOUT_RESERVE', 'PAYOUT_SETTLE', 'PAYOUT_REVERSAL'];

export class ListTransactionsQuery {
  @IsOptional()
  @IsIn(PAYOUT_STATUSES)
  status?: PayoutStatus;

  @IsOptional()
  @IsIn(LEDGER_TYPES)
  type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
