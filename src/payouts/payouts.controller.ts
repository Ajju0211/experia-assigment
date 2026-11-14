import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentMerchant } from '../shared/decorators/current-merchant.decorator';
import { ApiKeyGuard } from '../shared/guards/api-key.guard';
import { Merchant } from '../shared/interfaces/merchant.interface';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { toPayoutResponse } from './dto/payout-response.dto';
import { PayoutsService } from './payouts.service';

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

@Controller('payouts')
@UseGuards(ApiKeyGuard)
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post()
  async create(
    @CurrentMerchant() merchant: Merchant,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreatePayoutDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required (8-64 chars: letters, digits, "_" or "-")',
      });
    }
    const { payout, replayed } = await this.payouts.create(merchant.id, idempotencyKey, dto);
    res.status(replayed ? 200 : 201);
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return toPayoutResponse(payout);
  }

  @Get(':id')
  async getOne(@CurrentMerchant() merchant: Merchant, @Param('id', new ParseUUIDPipe()) id: string) {
    return toPayoutResponse(await this.payouts.findForMerchant(merchant.id, id));
  }
}
