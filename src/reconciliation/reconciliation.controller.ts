import { Controller, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../shared/guards/admin.guard';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('Admin Reconciliation')
@ApiSecurity('X-Admin-Token')
@Controller('admin')
@UseGuards(AdminGuard)
export class ReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Post('reconcile')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run reconciliation against mock bank records' })
  @ApiHeader({
    name: 'X-Admin-Token',
    required: true,
    description: 'Admin authorization token',
    example: 'demo_admin_token_change_me',
  })
  @ApiQuery({
    name: 'dry_run',
    required: false,
    type: Boolean,
    description: 'When true, reports matches without applying transitions to payouts',
  })
  @ApiResponse({ status: 200, description: 'Reconciliation report' })
  @ApiResponse({ status: 401, description: 'Invalid or missing admin token' })
  run(@Query('dry_run') dryRun?: string) {
    return this.service.run({ dryRun: dryRun === 'true' });
  }
}
