import { Request } from 'express';

export interface Merchant {
  id: string;
  name: string;
}

export type AuthedRequest = Request & { merchant: Merchant };
