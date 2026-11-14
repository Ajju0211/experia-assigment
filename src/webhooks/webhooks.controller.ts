import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { BankSignatureGuard } from '../shared/guards/bank-signature.guard';
import { BankWebhookDto } from './dto/bank-webhook.dto';
import { WebhooksService } from './webhooks.service';

@ApiTags('Webhooks')
@ApiSecurity('X-Bank-Signature')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Post('bank')
  @HttpCode(200)
  @UseGuards(BankSignatureGuard)
  @ApiOperation({ summary: 'Inbound mock bank webhook notification' })
  @ApiHeader({
    name: 'X-Bank-Signature',
    required: true,
    description: 'HMAC-SHA256 signature of request raw body: sha256=<hex_digest>',
    example: 'sha256=1234567890abcdef...',
  })
  @ApiResponse({ status: 200, description: 'Webhook acknowledged and processed' })
  @ApiResponse({ status: 401, description: 'Invalid or missing signature' })
  handle(@Body() dto: BankWebhookDto) {
    return this.service.process(dto);
  }
}

export { BankWebhookDto } from './dto/bank-webhook.dto';
export { WebhooksService } from './webhooks.service';
export { WebhooksModule } from './webhooks.module';
