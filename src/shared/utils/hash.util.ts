import { createHash } from 'crypto';

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
