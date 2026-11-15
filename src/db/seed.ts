import 'dotenv/config';
import { Client } from 'pg';
import { config } from '../config';
import { sha256 } from '../common/hash';

// Synthetic demo merchants. These API keys are fake and for local use only.
export const SEED_MERCHANTS = [
  { name: 'Acme Test Merchant',   apiKey: 'test_key_acme_00000000000001',   openingPaise: 10_000_000 }, // INR 1,00,000
  { name: 'Globex Test Merchant', apiKey: 'test_key_globex_0000000000001',  openingPaise: 5_000_000 },  // INR 50,000
];

/** Creates a merchant + wallet + opening-balance CREDIT ledger entry in one transaction. Idempotent. */
type Queryable = { query: (text: string, params?: any[]) => Promise<any> };
export async function seedMerchant(client: Queryable, m: { name: string; apiKey: string; openingPaise: number }) {
  await client.query('BEGIN');
  try {
    const ins = await client.query(
      'INSERT INTO merchants (name, api_key_hash) VALUES ($1,$2) ON CONFLICT (api_key_hash) DO NOTHING RETURNING id',
      [m.name, sha256(m.apiKey)]);
    let id: string;
    if (ins.rows[0]) {
      id = ins.rows[0].id;
      await client.query('INSERT INTO wallets (merchant_id, available_paise) VALUES ($1,$2)', [id, m.openingPaise]);
      await client.query(
        `INSERT INTO ledger_entries (merchant_id, type, amount_paise, available_after_paise, reserved_after_paise, description)
         VALUES ($1,'CREDIT',$2,$2,0,'Opening balance')`, [id, m.openingPaise]);
    } else {
      id = (await client.query('SELECT id FROM merchants WHERE api_key_hash = $1', [sha256(m.apiKey)])).rows[0].id;
    }
    await client.query('COMMIT');
    return { id, created: !!ins.rows[0] };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

if (require.main === module) {
  (async () => {
    const client = new Client({ connectionString: config.databaseUrl });
    await client.connect();
    if (process.argv.includes('--reset')) {
      if (process.env.NODE_ENV === 'production') {
        console.error('Refusing to run --reset with NODE_ENV=production.');
        await client.end();
        process.exit(1);
      }
      // Demo helper: wipes ALL data in the database named by DATABASE_URL, then re-seeds.
      await client.query('TRUNCATE webhook_events, mock_bank_transfers, payout_status_history, ledger_entries, payouts, wallets, merchants RESTART IDENTITY CASCADE');
      console.log('Database wiped.');
    }
    for (const m of SEED_MERCHANTS) {
      const r = await seedMerchant(client, m);
      console.log(`${r.created ? 'Created' : 'Exists '} ${m.name}  id=${r.id}  api_key=${m.apiKey}  balance=INR ${(m.openingPaise / 100).toLocaleString('en-IN')}`);
    }
    await client.end();
  })().catch((e) => { console.error(e); process.exit(1); });
}
