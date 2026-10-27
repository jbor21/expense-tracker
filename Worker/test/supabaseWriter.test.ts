import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  lookupProfileByAddress, insertTransactions, insertReviewRow, getUserFromJwt,
} from '../src/supabaseWriter';
import { deriveKeypair, open, type ReviewPayload, type TxPayload } from '../src/crypto';

const env = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sk' };
const userKeys = deriveKeypair(new Uint8Array(16).fill(7));
let calls: { url: string; init: RequestInit }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.includes('/rest/v1/profiles') && init.method === undefined)
      return new Response(JSON.stringify([{ id: 'u1', email: 'jacob@example.com', public_key: null }]), { status: 200 });
    if (url.includes('/auth/v1/user'))
      return new Response(JSON.stringify({ id: 'u1' }), { status: 200 });
    return new Response('', { status: 201 });
  }));
});

describe('lookupProfileByAddress', () => {
  it('queries profiles by forward_address with the service key', async () => {
    const p = await lookupProfileByAddress(env, 'u_abc@expense-app.uk');
    expect(p).toEqual({ id: 'u1', email: 'jacob@example.com', public_key: null });
    expect(calls[0].url).toContain('select=id,email,public_key');
    expect(calls[0].url).toContain('forward_address=eq.u_abc%40expense-app.uk');
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe('sk');
  });
});

describe('insertTransactions', () => {
  it('POSTs plaintext rows with line_idx = index when the profile has no key', async () => {
    await insertTransactions(env, 'u1', 'mid-1', [{
      kind: 'purchase', merchantRaw: 'CAFE', amountCents: 500,
      currency: 'USD', occurredAt: new Date('2026-06-18T00:00:00Z'), accountLast4: null,
    }], null);
    const call = calls[0];
    expect(call.url).toContain('/rest/v1/transactions');
    expect(call.url).toContain('on_conflict=user_id%2Cmessage_id%2Cline_idx');
    expect((call.init.headers as Record<string, string>).Prefer).toContain('resolution=ignore-duplicates');
    const body = JSON.parse(call.init.body as string);
    expect(body[0]).toMatchObject({
      user_id: 'u1', message_id: 'mid-1', line_idx: 0,
      amount_cents: 500, kind: 'purchase', merchant_raw: 'CAFE',
    });
    expect(body[0].payload_enc).toBeUndefined();
  });

  it('seals sensitive fields into payload_enc when the profile has a key', async () => {
    await insertTransactions(env, 'u1', 'mid-1', [{
      kind: 'refund', merchantRaw: 'CAFE', amountCents: -500,
      currency: 'USD', occurredAt: new Date('2026-06-18T00:00:00Z'), accountLast4: '4321',
    }], userKeys.publicKeyB64);
    const body = JSON.parse(calls[0].init.body as string);
    expect(body[0]).toMatchObject({
      user_id: 'u1', message_id: 'mid-1', line_idx: 0,
      occurred_at: '2026-06-18T00:00:00.000Z',
    });
    // No plaintext leaves the Worker …
    expect(body[0].merchant_raw).toBeUndefined();
    expect(body[0].amount_cents).toBeUndefined();
    expect(body[0].kind).toBeUndefined();
    expect(body[0].account_last4).toBeUndefined();
    expect(calls[0].init.body as string).not.toContain('CAFE');
    // … and the user's private key opens the blob.
    const payload = await open<TxPayload>(userKeys.privateKey, body[0].payload_enc);
    expect(payload).toEqual({ merchant: 'CAFE', amountCents: -500, kind: 'refund', accountLast4: '4321' });
  });

  it('is a no-op for empty batches and throws on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(insertTransactions(env, 'u1', 'm', [], null)).resolves.toBeUndefined();
    await expect(insertTransactions(env, 'u1', 'm', [{
      kind: 'purchase', merchantRaw: 'X', amountCents: 1, currency: 'USD',
      occurredAt: new Date(), accountLast4: null,
    }], null)).rejects.toThrow();
  });
});

describe('insertReviewRow', () => {
  it('POSTs the review row in plaintext when the profile has no key', async () => {
    await insertReviewRow(env, 'u1', {
      sender: 'x@y.com', subject: 's', excerpt: 'e', receivedAt: new Date('2026-06-18T00:00:00Z'),
    }, null);
    expect(calls[0].url).toContain('/rest/v1/review_queue');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toMatchObject({ user_id: 'u1', sender: 'x@y.com', subject: 's', excerpt: 'e' });
  });

  it('seals sender/subject/excerpt when the profile has a key', async () => {
    await insertReviewRow(env, 'u1', {
      sender: 'x@y.com', subject: 'secret subject', excerpt: 'secret body', receivedAt: new Date('2026-06-18T00:00:00Z'),
    }, userKeys.publicKeyB64);
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.sender).toBeUndefined();
    expect(body.subject).toBeUndefined();
    expect(body.excerpt).toBeUndefined();
    expect(calls[0].init.body as string).not.toContain('secret');
    const payload = await open<ReviewPayload>(userKeys.privateKey, body.payload_enc);
    expect(payload).toEqual({ sender: 'x@y.com', subject: 'secret subject', excerpt: 'secret body' });
  });
});

describe('getUserFromJwt', () => {
  it('resolves the user id from the access token', async () => {
    expect(await getUserFromJwt(env, 'jwt')).toEqual({ id: 'u1' });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });
  it('returns null on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    expect(await getUserFromJwt(env, 'bad')).toBeNull();
  });
});
