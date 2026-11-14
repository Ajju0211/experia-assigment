import { IsInt, Matches, Max, Min } from 'class-validator';

export class CreatePayoutDto {
  @Matches(/^[A-Za-z0-9_-]{3,64}$/, { message: 'beneficiary_ref must be 3-64 chars: letters, digits, "_" or "-"' })
  beneficiary_ref: string;

  @IsInt({ message: 'amount_paise must be an integer number of paise' })
  @Min(100, { message: 'amount_paise must be at least 100 (INR 1)' })
  @Max(1_000_000_000, { message: 'amount_paise must be at most 1000000000 (INR 1 crore)' })
  amount_paise: number;
}
