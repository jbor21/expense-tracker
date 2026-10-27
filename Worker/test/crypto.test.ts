import { describe, it, expect } from 'vitest';
import { deriveKeypair, seal, open, toB64, fromB64, type TxPayload } from '../src/crypto';

const entropy = new Uint8Array(16).fill(7);

describe('deriveKeypair', () => {
  it('is deterministic — same entropy, same keys', () => {
    const a = deriveKeypair(entropy);
    const b = deriveKeypair(new Uint8Array(16).fill(7));
    expect(a.publicKeyB64).toBe(b.publicKeyB64);
    expect(toB64(a.privateKey)).toBe(toB64(b.privateKey));
  });

  it('different entropy gives different keys', () => {
    const other = deriveKeypair(new Uint8Array(16).fill(8));
    expect(other.publicKeyB64).not.toBe(deriveKeypair(entropy).publicKeyB64);
  });
});

describe('seal/open', () => {
  const payload: TxPayload = { merchant: 'CAFE', amountCents: 500, kind: 'purchase', accountLast4: '4321' };

  it('round-trips a payload', async () => {
    const { privateKey, publicKeyB64 } = deriveKeypair(entropy);
    const blob = await seal(publicKeyB64, payload);
    expect(await open<TxPayload>(privateKey, blob)).toEqual(payload);
  });

  it('produces ciphertext that leaks no plaintext fields', async () => {
    const { publicKeyB64 } = deriveKeypair(entropy);
    const blob = await seal(publicKeyB64, payload);
    expect(atob(blob)).not.toContain('CAFE');
    expect(atob(blob)).not.toContain('4321');
  });

  it('fails to open with the wrong private key', async () => {
    const { publicKeyB64 } = deriveKeypair(entropy);
    const wrong = deriveKeypair(new Uint8Array(16).fill(9));
    const blob = await seal(publicKeyB64, payload);
    await expect(open(wrong.privateKey, blob)).rejects.toThrow();
  });

  it('fails on tampered ciphertext', async () => {
    const { privateKey, publicKeyB64 } = deriveKeypair(entropy);
    const parsed = JSON.parse(atob(await seal(publicKeyB64, payload)));
    const ct = fromB64(parsed.ct);
    ct[0] ^= 0xff;
    parsed.ct = toB64(ct);
    await expect(open(privateKey, btoa(JSON.stringify(parsed)))).rejects.toThrow();
  });

  it('two seals of the same payload differ (ephemeral keys)', async () => {
    const { publicKeyB64 } = deriveKeypair(entropy);
    expect(await seal(publicKeyB64, payload)).not.toBe(await seal(publicKeyB64, payload));
  });
});
