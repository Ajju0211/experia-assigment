import { Logger } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { maskTail, redact } from '../src/common/redact';
import { DbService } from '../src/db/db.service';
import { A, createApp, inr, pay, resetAndSeed } from './helpers';

describe('Sensitive data masking', () => {
  it('maskTail keeps only the last 4 characters', () => {
    expect(maskTail('ACCT_1234567890')).toBe('***********7890');
    expect(maskTail('abc')).toBe('***');
  });

  it('redact hides secrets and masks beneficiary references, including nested values', () => {
    const out = redact({ 'x-api-key': 'secret-key', beneficiary_ref: 'ACCT_1234567890', amount_paise: 100, nested: [{ Signature: 'abc', beneficiary_ref: 'XYZ98765' }] });
    expect(out).toEqual({ 'x-api-key': '[REDACTED]', beneficiary_ref: '***********7890', amount_paise: 100, nested: [{ Signature: '[REDACTED]', beneficiary_ref: '****8765' }] });
  });

  describe('application logs', () => {
    let app: INestApplication;
    let db: DbService;
    beforeAll(async () => { app = await createApp(); db = app.get(DbService); await resetAndSeed(db); });
    afterAll(async () => { await app.close(); });

    it('never contain the API key or the raw beneficiary reference', async () => {
      const lines: string[] = [];
      const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation((m: any) => { lines.push(String(m)); });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: any) => { lines.push(String(m)); });
      try {
        await pay(app, A.key, 'idem-logs-00001', 'ACCT_1234567890', inr(1_000));
        await pay(app, A.key, 'idem-logs-00002', 'ACCT_TIMEOUT_99887766', inr(1_000));   // exercises the warn path too
      } finally { spy.mockRestore(); warn.mockRestore(); }

      const all = lines.join('\n');
      expect(lines.length).toBeGreaterThan(0);
      expect(all).not.toContain(A.key);
      expect(all).not.toContain('ACCT_1234567890');
      expect(all).not.toContain('ACCT_TIMEOUT_99887766');
      expect(all).toContain('[REDACTED]');
      expect(all).toContain('***********7890');
    });
  });
});
