import 'dotenv/config';
import { Client } from 'pg';
import { runMigrations } from '../src/db/migrate';

/** Once per test run: create the test database if it doesn't exist, then apply migrations. */
export default async function globalSetup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/payouts_test');
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point at a database whose name ends with _test');

  const admin = new URL(url.toString());
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!exists.rowCount) await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  await runMigrations(url.toString());
}
