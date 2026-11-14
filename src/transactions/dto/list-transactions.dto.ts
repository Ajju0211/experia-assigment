import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PAYOUT_STATUSES, PayoutStatus } from '../../payouts/state-machine';

export const LEDGER_TYPES = ['CREDIT', 'PAYOUT_RESERVE', 'PAYOUT_SETTLE', 'PAYOUT_REVERSAL'];

export class ListTransactionsQuery {
  @ApiPropertyOptional({
    description: 'Filter by related payout status',
    enum: PAYOUT_STATUSES,
  })
  @IsOptional()
  @IsIn(PAYOUT_STATUSES)
  status?: PayoutStatus;

  @ApiPropertyOptional({
    description: 'Filter by ledger transaction type',
    enum: LEDGER_TYPES,
  })
  @IsOptional()
  @IsIn(LEDGER_TYPES)
  type?: string;

  @ApiPropertyOptional({
    description: 'Page number for pagination',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Maximum items per page',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
