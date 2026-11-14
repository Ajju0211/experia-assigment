import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentMerchant } from '../shared/decorators/current-merchant.decorator';
import { ApiKeyGuard } from '../shared/guards/api-key.guard';
import { Merchant } from '../shared/interfaces/merchant.interface';
import { WalletService } from './wallet.service';

@Controller('wallet')
@UseGuards(ApiKeyGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  async getWallet(@CurrentMerchant() merchant: Merchant) {
    const w = await this.wallet.getWallet(merchant.id);
    return { available_paise: w.available_paise, reserved_paise: w.reserved_paise, currency: 'INR' };
  }
}
