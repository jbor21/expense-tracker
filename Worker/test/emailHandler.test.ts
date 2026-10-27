import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleInboundEmail } from '../src/index';
import * as writer from '../src/supabaseWriter';

vi.mock('../src/supabaseWriter', () => ({
  lookupProfileByAddress: vi.fn(),
  insertTransactions: vi.fn(),
  insertReviewRow: vi.fn(),
  setForwardAddress: vi.fn(),
  getUserFromJwt: vi.fn(),
}));

const env = { SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k', INBOX_DOMAIN: 'expense-app.uk' } as never;
const base = {
  to: 'u_abc@expense-app.uk', from: 'alerts@chase.com',
  subject: "Your $42.10 transaction with TRADER JOE'S",
  messageId: '<mid-1@chase.com>', date: new Date('2026-06-18T12:00:00Z'),
  text: 'Account ending in 4321\nAmount: $42.10', html: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(writer.lookupProfileByAddress).mockResolvedValue({ id: 'u1', email: 'jacob@example.com', public_key: 'PUBKEY' });
});

describe('handleInboundEmail', () => {
  it('rejects unknown recipients so Gmail shows a visible bounce', async () => {
    vi.mocked(writer.lookupProfileByAddress).mockResolvedValue(null);
    expect(await handleInboundEmail(env, base)).toBe('rejected');
    expect(writer.insertTransactions).not.toHaveBeenCalled();
  });

  it('parses a matched email and stores transactions sealed to the profile key', async () => {
    expect(await handleInboundEmail(env, base)).toBe('stored');
    expect(writer.insertTransactions).toHaveBeenCalledWith(env, 'u1', '<mid-1@chase.com>',
      [expect.objectContaining({ amountCents: 4210 })], 'PUBKEY');
    expect(writer.insertReviewRow).not.toHaveBeenCalled();
  });

  it('sends unrouted senders to review with a 500-char excerpt', async () => {
    const r = await handleInboundEmail(env, {
      ...base, from: 'noreply@unknownbank.com', text: 'x'.repeat(2000),
    });
    expect(r).toBe('review');
    const row = vi.mocked(writer.insertReviewRow).mock.calls[0][2];
    expect(row.excerpt.length).toBe(500);
    expect(row.sender).toBe('noreply@unknownbank.com');
  });

  it('sends matched-but-unparseable emails (no anchored amount) to review', async () => {
    const r = await handleInboundEmail(env, {
      ...base, subject: 'Your payment has been received',
      text: 'Your payment of $500.00 was received. Thank you.',
    });
    expect(r).toBe('review');
  });

  it('strips HTML when there is no text body', async () => {
    const r = await handleInboundEmail(env, {
      ...base, text: '', html: '<tr><td>Amount</td><td>$<span>42.10</span></td></tr><tr><td>Account ending in 4321</td></tr>',
    });
    expect(r).toBe('stored');
    expect(writer.insertTransactions).toHaveBeenCalledWith(env, 'u1', '<mid-1@chase.com>',
      [expect.objectContaining({ amountCents: 4210 })], 'PUBKEY');
  });

  it('falls back to a synthetic message id when the header is missing', async () => {
    await handleInboundEmail(env, { ...base, messageId: null });
    const mid = vi.mocked(writer.insertTransactions).mock.calls[0][2];
    expect(mid).toBe('u_abc@expense-app.uk:2026-06-18T12:00:00.000Z:Your $42.10 transaction with TRADER JOE\'S');
  });
});
