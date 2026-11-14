// Values come from environment variables (.env). Defaults are DEMO-ONLY synthetic values.
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/payouts',
  bankWebhookSecret: process.env.BANK_WEBHOOK_SECRET ?? 'demo_webhook_secret_change_me',
  adminToken: process.env.ADMIN_TOKEN ?? 'demo_admin_token_change_me',
};
