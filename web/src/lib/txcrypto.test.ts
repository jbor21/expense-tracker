import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { decryptTxRows, decryptReviewRows, decryptBudgetRows, sealTxPayload, sealBudgetPayload } from './txcrypto';
import { newRecovery, storeEntropy } from './keys';
import { seal } from '../../../Worker/src/crypto';

describe('txcrypto', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) || null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    
    const { entropy } = newRecovery();
    storeEntropy(entropy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decrypts valid payload_enc for tx', async () => {
    const payload = { merchant: 'Test Store', amountCents: 1234, kind: 'purchase' as const, accountLast4: '4321' };
    const enc = await sealTxPayload(payload);
    
    const row = { id: '1', payload_enc: enc };
    const decrypted = await decryptTxRows([row]);
    
    expect(decrypted[0]).toEqual({
      id: '1',
      payload_enc: enc,
      merchant_raw: 'Test Store',
      amount_cents: 1234,
      kind: 'purchase',
      account_last4: '4321',
    });
  });

  it('handles corrupted payload_enc for tx', async () => {
    const row = { id: '1', payload_enc: 'bad_data' };
    const decrypted = await decryptTxRows([row]);
    
    expect(decrypted[0]).toEqual({
      id: '1',
      payload_enc: 'bad_data',
      merchant_raw: 'Unable to decrypt',
      amount_cents: 0,
      kind: 'purchase',
      account_last4: null,
    });
  });

  it('passes through legacy plaintext tx row', async () => {
    const row = { id: '1', merchant_raw: 'Old Store', amount_cents: 500, kind: 'purchase', account_last4: '1111' };
    const decrypted = await decryptTxRows([row]);
    
    expect(decrypted[0]).toEqual(row);
  });

  it('decrypts valid payload_enc for review', async () => {
    // using raw seal since there is no sealReviewPayload yet
    // we need to get publicKeyB64 from local storage
    const { loadKeys } = await import('./keys');
    const keys = loadKeys()!;
    const payload = { sender: 'bank@bank.com', subject: 'Alert', excerpt: 'You spent money' };
    const enc = await seal(keys.publicKeyB64, payload);
    
    const row = { id: '1', payload_enc: enc };
    const decrypted = await decryptReviewRows([row]);
    
    expect(decrypted[0]).toEqual({
      id: '1',
      payload_enc: enc,
      sender: 'bank@bank.com',
      subject: 'Alert',
      excerpt: 'You spent money',
    });
  });

  it('round-trips budget payload_enc', async () => {
    const enc = await sealBudgetPayload({ amountCents: 25000 });

    const row = { category_id: 'c1', payload_enc: enc };
    const decrypted = await decryptBudgetRows([row]);

    expect(decrypted[0]).toEqual({
      category_id: 'c1',
      payload_enc: enc,
      amount_cents: 25000,
    });
  });

  it('handles corrupted budget payload_enc', async () => {
    const row = { category_id: 'c1', payload_enc: 'bad_data' };
    const decrypted = await decryptBudgetRows([row]);

    expect(decrypted[0]).toEqual({
      category_id: 'c1',
      payload_enc: 'bad_data',
      amount_cents: 0,
    });
  });

  it('passes through legacy plaintext budget row', async () => {
    const row = { category_id: 'c1', amount_cents: 10000 };
    const decrypted = await decryptBudgetRows([row]);

    expect(decrypted[0]).toEqual(row);
  });
});
