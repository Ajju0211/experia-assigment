import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length } from 'class-validator';
import { PayoutStatus } from '../../payouts/state-machine';

export class BankWebhookDto {
  @ApiProperty({
    description: 'Unique event ID assigned by the bank',
    example: 'evt-2026-0001',
  })
  @IsString()
  @Length(1, 100)
  event_id: string;

  @ApiProperty({
    description: 'Bank reference corresponding to the payout',
    example: 'BNK-c7193789-6d8a-4385-be23-d23ab361c3fa',
  })
  @IsString()
  @Length(1, 100)
  bank_reference: string;

  @ApiProperty({
    description: 'Updated payout status from the bank',
    enum: ['SUCCESS', 'FAILED', 'PENDING'],
    example: 'SUCCESS',
  })
  @IsIn(['SUCCESS', 'FAILED', 'PENDING'])
  status: PayoutStatus;
}
