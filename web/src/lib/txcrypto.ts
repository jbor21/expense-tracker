import { open, seal } from '../../../Worker/src/crypto';
import type { TxPayload, ReviewPayload } from '../../../Worker/src/crypto';
import { loadKeys } from './keys';

export async function decryptTxRows(rows: any[]): Promise<any[]> {
  const keys = loadKeys();
  return Promise.all(
    rows.map(async (row) => {
      if (row.payload_enc) {
        try {
          if (!keys) throw new Error('No keys');
          const p = await open<TxPayload>(keys.privateKey, row.payload_enc);
          return {
            ...row,
            merchant_raw: p.merchant,
            amount_cents: p.amountCents,
            kind: p.kind,
            account_last4: p.accountLast4,
          };
        } catch {
          return {
            ...row,
            merchant_raw: 'Unable to decrypt',
            amount_cents: 0,
            kind: 'purchase',
            account_last4: null,
          };
        }
      }
      return row;
    })
  );
}

export async function decryptReviewRows(rows: any[]): Promise<any[]> {
  const keys = loadKeys();
  return Promise.all(
    rows.map(async (row) => {
      if (row.payload_enc) {
        try {
          if (!keys) throw new Error('No keys');
          const p = await open<ReviewPayload>(keys.privateKey, row.payload_enc);
          return {
            ...row,
            sender: p.sender,
            subject: p.subject,
            excerpt: p.excerpt,
          };
        } catch {
          return {
            ...row,
            sender: 'Unable to decrypt',
            subject: 'Unable to decrypt',
            excerpt: '',
          };
        }
      }
      return row;
    })
  );
}

export async function sealTxPayload(payload: TxPayload): Promise<string> {
  const keys = loadKeys();
  if (!keys) throw new Error('No keys to seal payload');
  return seal(keys.publicKeyB64, payload);
}

// Budgets never pass through the Worker — the app both writes and reads them —
// so the payload type lives here rather than in the shared crypto module.
export interface BudgetPayload {
  amountCents: number;
}

export async function decryptBudgetRows(rows: any[]): Promise<any[]> {
  const keys = loadKeys();
  return Promise.all(
    rows.map(async (row) => {
      if (row.payload_enc) {
        try {
          if (!keys) throw new Error('No keys');
          const p = await open<BudgetPayload>(keys.privateKey, row.payload_enc);
          return { ...row, amount_cents: p.amountCents };
        } catch {
          return { ...row, amount_cents: 0 };
        }
      }
      return row;
    })
  );
}

export async function sealBudgetPayload(payload: BudgetPayload): Promise<string> {
  const keys = loadKeys();
  if (!keys) throw new Error('No keys to seal payload');
  return seal(keys.publicKeyB64, payload);
}
