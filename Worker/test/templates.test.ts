import { describe, it, expect } from 'vitest';
import { routeAndParse, type RawEmail } from '../src/parsing/templates';

const USER = 'jacob@example.com';
const at = new Date(1_700_000_000_000);
const email = (over: Partial<RawEmail>): RawEmail => ({
  messageId: 'm1', from: 'alerts@chase.com', subject: '', receivedAt: at, text: '', ...over,
});

describe('Chase', () => {
  it('parses a purchase from the labeled Amount line', () => {
    const c = routeAndParse(email({
      subject: "Your $42.10 transaction with TRADER JOE'S #123",
      text: 'Account ending in 4321\nMade on Jun 18, 2026\nAmount: $42.10',
    }), USER)!;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      kind: 'purchase', amountCents: 4210, currency: 'USD',
      accountLast4: '4321', merchantRaw: "TRADER JOE'S #123",
    });
  });

  it('parses refunds as negative', () => {
    const c = routeAndParse(email({
      subject: 'Refund of $20.00 to your account',
      text: "A refund was credited.\nAccount ending in 4321\nMade on Jun 19, 2026\nMerchant: TRADER JOE'S #123\nAmount: $20.00",
    }), USER)!;
    expect(c[0].kind).toBe('refund');
    expect(c[0].amountCents).toBe(-2000);
  });

  it('falls back to receivedAt for a date-only alert (never UTC midnight)', () => {
    // "Made on Jun 18, 2026" carries no time, so there is no instant to derive.
    // receivedAt is within minutes of the charge; UTC midnight would read as the
    // *previous* day in every US timezone.
    const c = routeAndParse(email({
      subject: 'Your $5.00 transaction with CORNER CAFE',
      text: 'Made on Jun 18, 2026\nAccount ending in 0001\nAmount: $5.00',
    }), USER)!;
    expect(c[0].occurredAt).toEqual(at);
    expect(c[0].occurredAt.toISOString()).not.toBe('2026-06-18T00:00:00.000Z');
  });

  it('falls back to receivedAt when no date in body', () => {
    const c = routeAndParse(email({
      subject: 'Your $5.00 transaction with CORNER CAFE',
      text: 'Account ending in 0001\nAmount: $5.00',
    }), USER)!;
    expect(c[0].occurredAt).toEqual(at);
  });

  it('ignores the $0.00 threshold decoy; takes the labeled Amount', () => {
    const c = routeAndParse(email({
      subject: "Your credit card transaction with TRADER JOE'S exceeded $0.00",
      text: "You asked us to alert you when a transaction exceeds $0.00.\nAccount ending in 4321\nMade on Jun 18, 2026\nMerchant: TRADER JOE'S #456\nAmount: $42.10",
    }), USER)!;
    expect(c[0].amountCents).toBe(4210);
  });

  it('extracts the merchant from the threshold subject', () => {
    const c = routeAndParse(email({
      subject: "Your credit card transaction with TRADER JOE'S exceeded $0.00",
      text: 'Account ending in 4321\nMade on Jun 18, 2026\nAmount: $42.10',
    }), USER)!;
    expect(c[0].merchantRaw).toBe("TRADER JOE'S");
  });

  it('parses the labeled Transaction-alert layout', () => {
    const c = routeAndParse(email({
      from: 'no.reply.alerts@chase.com',
      subject: 'You made a $24.50 transaction with STORE/MARKET #00000',
      text: [
        'Chase Logo', 'Transaction alert', 'You made a $24.50 transaction', '',
        'Account    Chase Visa Card (...5678)',
        'Date    Jun 18, 2026 at 3:30 PM ET',
        'Merchant    STORE/MARKET #00000',
        'Amount    $24.50',
        'You are receiving this alert because your transaction was more than the $0.01 level you set. You can visit our Resource Center anytime to help answer your questions or manage your account.',
        'Review account',
      ].join('\n'),
    }), USER)!;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      kind: 'purchase', amountCents: 2450,
      merchantRaw: 'STORE/MARKET #00000', accountLast4: '5678',
    });
    // Jun 18 is EDT (UTC-4): 3:30 PM ET === 19:30Z, same calendar day.
    expect(c[0].occurredAt.toISOString()).toBe('2026-06-18T19:30:00.000Z');
  });

  // Regression: the charge that started this. Chase said "Sep 1, 2026 at 7:50 PM
  // ET"; the old parser kept only the date and stored midnight UTC, which is
  // Aug 31 8:00 PM Eastern — so a Sep 1 charge fell outside September's range
  // (local midnight Sep 1 ET === 2026-09-01T04:00:00Z) and vanished from the
  // month's budget.
  it('keeps an evening ET charge on its own local day and month', () => {
    const c = routeAndParse(email({
      from: 'no.reply.alerts@chase.com',
      subject: 'You made a $9.99 transaction with CORNER MARKET #0000',
      text: [
        'Transaction alert', 'You made a $9.99 transaction', '',
        'Account Chase Visa Card (...9876)',
        'Date Sep 1, 2026 at 7:50 PM ET',
        'Merchant CORNER MARKET #0000',
        'Amount $9.99',
        'You are receiving this alert because your transaction was more than the $0.01 level you set.',
      ].join('\n'),
    }), USER)!;

    expect(c[0]).toMatchObject({
      kind: 'purchase', amountCents: 999,
      merchantRaw: 'CORNER MARKET #0000', accountLast4: '9876',
    });
    expect(c[0].occurredAt.toISOString()).toBe('2026-09-01T23:50:00.000Z');

    // The actual failure: inside September, not before it.
    const septStartET = new Date('2026-09-01T04:00:00.000Z');
    expect(c[0].occurredAt.getTime()).toBeGreaterThanOrEqual(septStartET.getTime());
    expect(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
        .format(c[0].occurredAt),
    ).toBe('2026-09-01');
  });

  it('handles EST (winter, UTC-5) as well as EDT', () => {
    const c = routeAndParse(email({
      from: 'no.reply.alerts@chase.com',
      subject: 'You made a $5.00 transaction with CORNER CAFE',
      text: 'Date Jan 15, 2026 at 7:50 PM ET\nMerchant CORNER CAFE\nAmount $5.00',
    }), USER)!;
    // EST is UTC-5, so 7:50 PM ET crosses midnight into the next UTC day.
    expect(c[0].occurredAt.toISOString()).toBe('2026-01-16T00:50:00.000Z');
  });

  it('ignores an unrecognized timezone rather than guessing', () => {
    const c = routeAndParse(email({
      from: 'no.reply.alerts@chase.com',
      subject: 'You made a $5.00 transaction with CORNER CAFE',
      text: 'Date Jun 18, 2026 at 3:30 PM XYZ\nMerchant CORNER CAFE\nAmount $5.00',
    }), USER)!;
    expect(c[0].occurredAt).toEqual(at);
  });

  it('returns [] when there is no amount (statement)', () => {
    expect(routeAndParse(email({
      subject: 'Your account statement is ready',
      text: 'Log in to view your balance.',
    }), USER)).toEqual([]);
  });

  it('routes payment notices with stray $ figures to review ([])', () => {
    expect(routeAndParse(email({
      subject: 'Your payment has been received',
      text: 'Your payment of $500.00 was received on Jun 18, 2026. Thank you.\nAccount ending in 4321',
    }), USER)).toEqual([]);
  });
});

describe('Fidelity', () => {
  const fid = (over: Partial<RawEmail>) =>
    email({ from: 'fidelityealerts@alert.fidelityrewards.com', ...over });

  it('parses the real sample layout', () => {
    const c = routeAndParse(fid({
      subject: 'A charge was authorized for your Fidelity® card',
      text: 'Logo\nYour card was charged $19.99 at SHOP.COM.\nYour Fidelity® card ending in 1234 was used to make a $19.99 purchase at SHOP.COM today.\nIf you’d like to view this transaction, log in to your account.',
    }), USER)!;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      kind: 'purchase', amountCents: 1999, merchantRaw: 'SHOP.COM', accountLast4: '1234',
    });
  });

  it('falls back to receivedAt (no date line in body)', () => {
    const c = routeAndParse(fid({
      subject: 'A charge was authorized for your Fidelity® card',
      text: 'Your card was charged $19.99 at SHOP.COM.\nYour Fidelity® card ending in 1234 was used to make a $19.99 purchase at SHOP.COM today.',
    }), USER)!;
    expect(c[0].occurredAt).toEqual(at);
  });

  it('routes statements with stray $ figures to review ([])', () => {
    expect(routeAndParse(fid({
      subject: 'Your statement is ready',
      text: 'Your statement balance is $543.21. Log in to view your Fidelity® card statement.',
    }), USER)).toEqual([]);
  });
});

describe('TestBank (user’s own email as pseudo-bank)', () => {
  it('parses a purchase sent from the user’s own address', () => {
    const c = routeAndParse(email({
      from: USER,
      subject: 'TestBank alert',
      text: 'You made a purchase of $12.34 at COFFEE SHOP.',
    }), USER)!;
    expect(c[0]).toMatchObject({ kind: 'purchase', amountCents: 1234, merchantRaw: 'COFFEE SHOP' });
  });

  it('parses a refund as negative', () => {
    const c = routeAndParse(email({
      from: USER,
      subject: 'TestBank alert',
      text: 'You made a refund of $5.00 at COFFEE SHOP.',
    }), USER)!;
    expect(c[0].amountCents).toBe(-500);
  });

  it('does NOT trust that format from other senders', () => {
    expect(routeAndParse(email({
      from: 'stranger@evil.com',
      subject: 'TestBank alert',
      text: 'You made a purchase of $999.99 at EVIL CORP.',
    }), USER)).toBeNull();
  });
});

describe('router', () => {
  it('returns null for unknown senders (→ review)', () => {
    expect(routeAndParse(email({ from: 'noreply@unknownbank.com', subject: 'x', text: 'y' }), USER)).toBeNull();
  });
  it('matches senders case-insensitively and inside display names', () => {
    const c = routeAndParse(email({
      from: 'Chase <No.Reply.Alerts@CHASE.com>',
      subject: 'Your $5.00 transaction with CAFE',
      text: 'Amount: $5.00',
    }), USER);
    expect(c).toHaveLength(1);
  });
});
