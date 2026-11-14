import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ReconciliationService } from './reconciliation.service';

/** npm run reconcile [-- --dry-run] */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const report = await app.get(ReconciliationService).run({ dryRun: process.argv.includes('--dry-run') });
  console.log(JSON.stringify(report, null, 2));
  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
