import 'dotenv/config';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { signWebhook } from '../src/common/auth';
import { config } from '../src/config';

/**
 * Pretends to be the bank settling a payout later.
 *   npm run bank:simulate -- <bank_reference> <SUCCESS|FAILED> [--event-id <id>] [--no-webhook]
 * 1. updates the mock bank's own record   2. sends a SIGNED webhook to the running API
 * Re-running with the same --event-id demonstrates duplicate-webhook protection.
 */
async function main() {
  const [ref, status] = process.argv.slice(2);
  if (!ref || !['SUCCESS', 'FAILED'].includes(status)) {
    console.error('usage: npm run bank:simulate -- <bank_reference> <SUCCESS|FAILED> [--event-id <id>] [--no-webhook]');
    process.exit(1);
  }
  const idx = process.argv.indexOf('--event-id');
  const eventId = idx > -1 ? process.argv[idx + 1] : `evt-${randomUUID()}`;

  const db = new Client({ connectionString: config.databaseUrl });
  await db.connect();
  const upd = await db.query('UPDATE mock_bank_transfers SET status = $2, updated_at = now() WHERE bank_reference = $1', [ref, status]);
  await db.end();
  console.log(upd.rowCount ? `Mock bank record for ${ref} set to ${status}` : `(no mock bank record for ${ref})`);
  if (process.argv.includes('--no-webhook')) return;

  const body = JSON.stringify({ event_id: eventId, bank_reference: ref, status });
  const res = await fetch(`http://localhost:${config.port}/api/webhooks/bank`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bank-Signature': signWebhook(body) },
    body,
  });
  console.log(`Webhook ${eventId} -> HTTP ${res.status} ${await res.text()}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
