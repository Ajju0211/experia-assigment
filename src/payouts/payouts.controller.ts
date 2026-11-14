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
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentMerchant } from '../shared/decorators/current-merchant.decorator';
import { ApiKeyGuard } from '../shared/guards/api-key.guard';
import { Merchant } from '../shared/interfaces/merchant.interface';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { toPayoutResponse } from './dto/payout-response.dto';
import { PayoutsService } from './payouts.service';

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

@ApiTags('Payouts')
@ApiSecurity('X-API-Key')
@Controller('payouts')
@UseGuards(ApiKeyGuard)
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post()
  @ApiOperation({ summary: 'Initiate a payout to a beneficiary' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique key for safe retries (8-64 alphanumeric chars, "_" or "-")',
    example: 'idem-payout-0001',
  })
  @ApiResponse({ status: 201, description: 'Payout created successfully' })
  @ApiResponse({ status: 200, description: 'Idempotent replay of existing payout' })
  @ApiResponse({ status: 400, description: 'Validation error or missing idempotency key' })
  @ApiResponse({ status: 409, description: 'Idempotency key reused with different payload' })
  @ApiResponse({ status: 422, description: 'Insufficient funds' })
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
  @ApiOperation({ summary: 'Get payout by ID (merchant-scoped)' })
  @ApiParam({ name: 'id', description: 'Payout UUID', example: 'c7193789-6d8a-4385-be23-d23ab361c3fa' })
  @ApiResponse({ status: 200, description: 'Payout found' })
  @ApiResponse({ status: 404, description: 'Payout not found' })
  async getOne(@CurrentMerchant() merchant: Merchant, @Param('id', new ParseUUIDPipe()) id: string) {
    return toPayoutResponse(await this.payouts.findForMerchant(merchant.id, id));
  }
}
