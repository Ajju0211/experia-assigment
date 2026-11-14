const FULLY_HIDDEN = [
  'x-api-key',
  'authorization',
  'api_key',
  'apikey',
  'secret',
  'signature',
  'x-bank-signature',
  'x-admin-token',
  'password',
  'token',
];
const PARTIALLY_MASKED = ['beneficiary_ref', 'beneficiaryref'];

export function maskTail(value: string, visible = 4): string {
  if (value.length <= visible) return '*'.repeat(value.length);
  return '*'.repeat(value.length - visible) + value.slice(-visible);
}

export function redact(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(redact);
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (FULLY_HIDDEN.includes(key)) out[k] = '[REDACTED]';
      else if (PARTIALLY_MASKED.includes(key) && typeof v === 'string') out[k] = maskTail(v);
      else out[k] = redact(v);
    }
    return out;
  }
  return input;
}
