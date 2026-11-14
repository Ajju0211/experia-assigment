import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentMerchant } from '../shared/decorators/current-merchant.decorator';
import { ApiKeyGuard } from '../shared/guards/api-key.guard';
import { Merchant } from '../shared/interfaces/merchant.interface';
import { WalletService } from './wallet.service';

@ApiTags('Wallet')
@ApiSecurity('X-API-Key')
@Controller('wallet')
@UseGuards(ApiKeyGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Get current merchant wallet balance' })
  @ApiResponse({ status: 200, description: 'Available and reserved balance in paise' })
  @ApiResponse({ status: 401, description: 'Unauthenticated - missing or invalid API key' })
  async getWallet(@CurrentMerchant() merchant: Merchant) {
    const w = await this.wallet.getWallet(merchant.id);
    return { available_paise: w.available_paise, reserved_paise: w.reserved_paise, currency: 'INR' };
  }
}
