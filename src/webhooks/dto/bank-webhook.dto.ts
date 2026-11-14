import { IsIn, IsString, Length } from 'class-validator';
import { PayoutStatus } from '../../payouts/state-machine';

export class BankWebhookDto {
  @IsString()
  @Length(1, 100)
  event_id: string;

  @IsString()
  @Length(1, 100)
  bank_reference: string;

  @IsIn(['SUCCESS', 'FAILED', 'PENDING'])
  status: PayoutStatus;
}
