import { Controller, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../shared/guards/admin.guard';
import { ReconciliationService } from './reconciliation.service';

@Controller('admin')
@UseGuards(AdminGuard)
export class ReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Post('reconcile')
  @HttpCode(200)
  run(@Query('dry_run') dryRun?: string) {
    return this.service.run({ dryRun: dryRun === 'true' });
  }
}
