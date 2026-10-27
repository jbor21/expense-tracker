import { centsFrom } from './money';
import type { ParsedCharge, RawEmail } from './types';

export type { ParsedCharge, RawEmail } from './types';

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** IANA zone per the abbreviations the alerts actually use. */
const ZONES: Record<string, string> = {
  ET: 'America/New_York', EST: 'America/New_York', EDT: 'America/New_York',
  CT: 'America/Chicago', CST: 'America/Chicago', CDT: 'America/Chicago',
  MT: 'America/Denver', MST: 'America/Denver', MDT: 'America/Denver',
  PT: 'America/Los_Angeles', PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
};

/** UTC offset (ms) of `tz` at instant `d`. */
function tzOffsetMs(d: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUTC - d.getTime();
}

/** Wall-clock time in `tz` → the UTC instant it names. One correction pass
 *  handles DST boundaries (same fixed-point trick as web/src/lib/months.ts). */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const wall = Date.UTC(y, mo, d, h, mi);
  let inst = new Date(wall - tzOffsetMs(new Date(wall), tz));
  inst = new Date(wall - tzOffsetMs(inst, tz));
  return inst;
}

/**
 * "Date  Sep 1, 2026 at 7:50 PM ET" → the exact instant that names.
 *
 * Returns null when the alert carries only a date ("Made on Jun 18, 2026") or
 * an unrecognized zone; the caller then falls back to the email's own
 * `receivedAt`, which lands within minutes of the charge.
 *
 * Deliberately never returns UTC midnight. Midnight UTC reads as the *previous*
 * day in every US timezone, so a charge made on the 1st was bucketed into the
 * previous month and vanished from the current month's budget — the whole point
 * of `monthRange` keying off the household timezone (SPEC: month bucketing uses
 * the household timezone, never UTC).
 */
function parseAlertInstant(text: string): Date | null {
  const m = /(?:Made on|Date):?\s*([A-Za-z]{3}) (\d{1,2}), (\d{4})(?:\s+at\s+(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?\s*([A-Za-z]{2,3}))?/.exec(text);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return null;

  const [, , dayS, yearS, hourS, minS, ampm, zoneAbbr] = m;
  if (!hourS || !zoneAbbr) return null;              // date-only → use receivedAt
  const tz = ZONES[zoneAbbr.toUpperCase()];
  if (!tz) return null;                              // unknown zone → never guess

  const hour = (Number(hourS) % 12) + (ampm.toLowerCase() === 'p' ? 12 : 0);
  return zonedToUtc(Number(yearS), month, Number(dayS), hour, Number(minS), tz);
}

const isRefund = (text: string) => /refund|return|credited/i.test(text);

interface Template {
  /** lowercase sender fragments this template claims */
  senders: string[];
  parse(email: RawEmail): ParsedCharge[];
}

/** Chase — both alert layouts. The labeled "Amount:" line is the one
 *  authoritative field; subjects and prose carry decoys ("exceeded $0.00",
 *  payment notices) so there is deliberately NO bare-$ fallback:
 *  no labeled line ⇒ [] ⇒ review. */
const chase: Template = {
  senders: ['alerts@chase.com', 'no.reply.alerts@chase.com'],
  parse(email) {
    const text = `${email.subject}\n${email.text}`;
    const amount = /Amount:?\s*\$([\d,]+\.\d{2})/.exec(text)?.[1];
    const cents = amount ? centsFrom(amount) : null;
    if (cents === null) return [];

    const last4 = /(?:ending in|\.\.\.)\s*\(?(\d{4})\)?/.exec(text)?.[1] ?? null;

    // Merchant is in the subject: "…transaction with X exceeded $Y" (strip the
    // threshold suffix) or "…transaction with X" to end of line.
    const merchant =
      /transaction with\s+(.+?)\s+exceeded\s+\$[\d,]+\.\d{2}/.exec(text)?.[1] ??
      /transaction with\s+(.+?)(?:\n|$)/.exec(text)?.[1] ?? null;

    const refund = isRefund(text);

    return [{
      kind: refund ? 'refund' : 'purchase',
      merchantRaw: merchant?.trim() ?? 'Unknown',
      amountCents: refund ? -cents : cents,
      currency: 'USD',
      occurredAt: parseAlertInstant(text) ?? email.receivedAt,
      accountLast4: last4,
    }];
  },
};

/** Fidelity® Rewards Visa (Elan). Anchored line: "charged $X.XX at <merchant>."
 *  Statements/payment notices from the same domain carry stray $ figures →
 *  no anchored line ⇒ [] ⇒ review. */
const fidelity: Template = {
  senders: ['fidelityrewards.com'],
  parse(email) {
    const text = `${email.subject}\n${email.text}`;
    const amount = /charged\s+\$([\d,]+\.\d{2})/.exec(text)?.[1];
    const cents = amount ? centsFrom(amount) : null;
    if (cents === null) return [];

    const last4 = /ending in\s+(\d{4})/.exec(text)?.[1] ?? null;
    // Merchant may contain dots (SHOP.COM) — greedy to the sentence-ending
    // period at end of the line, not the first period.
    const merchant = /charged\s+\$[\d,]+\.\d{2}\s+at\s+(.+)\./.exec(text)?.[1] ?? null;
    const refund = isRefund(text);

    return [{
      kind: refund ? 'refund' : 'purchase',
      merchantRaw: merchant?.trim() ?? 'Unknown',
      amountCents: refund ? -cents : cents,
      currency: 'USD',
      occurredAt: email.receivedAt, // no date line in the body ("today" only)
      accountLast4: last4,
    }];
  },
};

/** TestBank — end-to-end test pseudo-bank. Trusted ONLY when the email comes
 *  from the account owner's own address (checked by the router, not here).
 *  Format: "You made a (purchase|refund) of $X.XX at MERCHANT." */
const testBank: Template = {
  senders: [], // sender check is dynamic (user's own email) — router-only
  parse(email) {
    const text = `${email.subject}\n${email.text}`;
    const m = /You made a (purchase|refund) of \$([\d,]+\.\d{2}) at (.+)\./.exec(text);
    const cents = m ? centsFrom(m[2]) : null;
    if (!m || cents === null) return [];
    const refund = m[1] === 'refund';
    return [{
      kind: refund ? 'refund' : 'purchase',
      merchantRaw: m[3].trim(),
      amountCents: refund ? -cents : cents,
      currency: 'USD',
      occurredAt: email.receivedAt,
      accountLast4: null,
    }];
  },
};

const templates: Template[] = [chase, fidelity];

/** Pick the template for the sender and parse.
 *  Returns null when no template claims the sender (→ review row);
 *  returns [] when a template matched but found no anchored amount (→ review row). */
export function routeAndParse(email: RawEmail, userEmail: string): ParsedCharge[] | null {
  const from = email.from.toLowerCase();
  for (const t of templates) {
    if (t.senders.some((s) => from.includes(s))) return t.parse(email);
  }
  // TestBank: the user's own account email acting as a bank (extract the bare
  // address from a possible "Name <addr>" form before comparing).
  const bare = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim();
  if (userEmail && bare === userEmail.toLowerCase()) return testBank.parse(email);
  return null;
}
