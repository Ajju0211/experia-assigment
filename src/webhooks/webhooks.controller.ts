import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { BankSignatureGuard } from '../shared/guards/bank-signature.guard';
import { BankWebhookDto } from './dto/bank-webhook.dto';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Post('bank')
  @HttpCode(200)
  @UseGuards(BankSignatureGuard)
  handle(@Body() dto: BankWebhookDto) {
    return this.service.process(dto);
  }
}

export { BankWebhookDto } from './dto/bank-webhook.dto';
export { WebhooksService } from './webhooks.service';
export { WebhooksModule } from './webhooks.module';
