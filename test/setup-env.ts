// Runs before each test file: point the app at the TEST database with fixed demo secrets.
import 'dotenv/config';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/payouts_test';
process.env.BANK_WEBHOOK_SECRET = 'test_webhook_secret';
process.env.ADMIN_TOKEN = 'test_admin_token';
