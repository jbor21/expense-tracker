---
name: new-bank
description: Add a new bank's parsing template + tests to the Cloudflare Worker from a pasted transaction-alert email. Use when the user runs /new-bank, pastes a bank alert email, or asks to add parsing support for a new bank/sender. Adds the template to Worker/src/parsing/templates.ts, registers it in the routeAndParse list, and writes vitest cases from the pasted email as a scrubbed fixture (real cardholder values never committed) — following the existing chase/fidelity templates exactly.
---

# /new-bank — add a bank from a real alert email

Turn one pasted bank transaction-alert email into a working template + tests in
the **Cloudflare Worker**, following the existing `chase` / `fidelity` templates.
A whole bank is ~25 lines.

> **Where the parsing lives.** All templates are in
> `Worker/src/parsing/templates.ts` and run **server-side in the Worker** as mail
> arrives. The PWA never parses email. (`legacy-ios/` contains a dormant Swift
> copy of this parser — it is not built or deployed. Do not add banks there.)

## Three rules that matter

**1. Derive every regex from the REAL pasted email's *format*. Never invent it.**

Read the amount, merchant, last-4 and date regexes off the *actual* lines in the
pasted email. Do not assume labels like `Amount:` or `Merchant:` exist — confirm
them in the pasted text. Guessing is how this parser once shipped `$0.00` charges
and `"TRADER JOE'S exceeded $0.00"` merchants.

**2. Never commit the real *values*.** The template and tests ship to every user.
The pasted email reveals the *schema*, not data to store. Scrub before writing
anything (see Scrubbing) — in fixtures **and** in code comments, which leak just
as easily. Regexes match format, not values, so a scrubbed fixture tests exactly
the same thing.

**3. `occurredAt` must be a real instant — never a date at UTC midnight.**
See Dates below. This one shipped a live bug; don't repeat it.

If the user pastes nothing, ask for one real alert email (sender, subject, body)
before proceeding.

## Dates — the trap that already bit us

A date-only string parsed as UTC midnight reads as the **previous day** in every
US timezone, so a charge on the 1st landed in the *previous month's* budget and
vanished. `web/src/lib/months.ts` buckets months by the household timezone; the
Worker must hand it a genuine instant.

- **If the alert carries a time and zone** (`"Date Sep 1, 2026 at 7:50 PM ET"`) —
  use `parseAlertInstant()`, already in `templates.ts`. It resolves the exact
  instant and is DST-safe. Extend its `ZONES` map if the bank uses a zone not
  listed.
- **If the alert has only a date, or no date at all** — use `email.receivedAt`.
  Alerts arrive within minutes of the charge, so it is far more accurate than
  midnight anything. **Never** construct `Date.UTC(y, m, d)`.

## Scrubbing — keep the shape, drop the data

Replace each real value with a placeholder preserving every character class the
regex depends on. (Examples below are invented — don't paste the user's real
values into this table either; this file is committed too.)

| Real-shaped (illustrative) | Placeholder | Shape preserved |
|---|---|---|
| `$73.21` | `$19.99` | `$X.XX` |
| last-4 `8842` | `1234` | 4 digits after `ending in` / `(...` |
| `WIDGETSRUS.IO` | `SHOP.COM` | internal dot |
| `GROCER/DELI #55012` | `STORE/MARKET #00000` | `/`, ` #`, store digits |
| cardholder name / email | `Jane Doe` / drop it | — |
| date / time | `Jun 18, 2026` / `3:30 PM ET` | `MMM d, yyyy` + time + zone |

Keep the bank's legal boilerplate and mailing address — public, and useful for
proving no false refund-keyword trips. After scrubbing, `grep` to prove nothing
real remains (step 5).

## Inputs to extract

| Field | Source | Notes |
|---|---|---|
| `senders` | the `From:` address | Fragments are fine (matched with `from.includes(s)`), e.g. `'americanexpress.com'`. List every alert sender the bank uses — a bank may relay through several systems. |
| amount | the **authoritative** amount line | Beware decoys: alert *thresholds* in the subject (`"exceeded $0.00"`), payment/balance figures. Prefer a labeled line. |
| merchant | wherever the name actually sits | Subject framing or a body line; strip to just the name. |
| last4 | `"ending in 1234"` / `"(...1234)"` | Optional → `null`. |
| date | a date line | Optional. See **Dates** above. |
| refund? | `refund` / `return` / `credited` | Refunds are **negative** `amountCents`. |

## Invariants (non-negotiable)

- **Money is integer cents.** Use `centsFrom()` from `./money` — the only
  string→cents path. Never floats.
- **Never guess.** No authoritative amount ⇒ `return []`. The Worker turns `[]`
  into a `review_queue` row. A `0`-amount or `"Unknown"` row defeats the review
  queue.
- **Only purchase / refund.** Drop balance / statement / payment notices.
- **Extraction only.** Categorization happens later, on `merchantRaw`.
- **Identify senders by the `From:` address, never by Message-ID.** Chase relays
  through at least two mail systems (`iaasn*`, `final-delivery-engine-prod-*`);
  message-id infrastructure is not stable.

## Procedure

1. **Read the pasted email.** Quote, in your reply, the exact lines you'll match
   for amount / merchant / last4 / date. Pick a lowercase const name (`amex`,
   `citi`, `capitalOne`).

2. **Write the test first (TDD).** Add a `describe('<Bank>', ...)` block to
   `Worker/test/templates.test.ts` using the pasted email's *format*, every real
   value scrubbed. Assert the scrubbed values. Run
   `cd Worker && npx vitest run test/templates.test.ts` and watch it **fail**.

3. **Add the template** to `Worker/src/parsing/templates.ts`, beside `chase` and
   `fidelity` (see skeleton below).

4. **Register it** in the router list in the same file:
   ```ts
   const templates: Template[] = [chase, fidelity, <bank>];
   ```
   Easy to forget — the template is dead code until it's in this array.

5. **Verify green, then verify clean.**
   ```bash
   cd Worker && npx tsc --noEmit && npm test
   ```
   All existing tests must stay green. Then `grep -ri` the repo for every real
   value (amount, last-4, merchant, name, email) across `Worker/src/` **and**
   `Worker/test/` — comments leak too — and confirm none remain.

6. **Report**: the senders registered, the test count, and that fixtures and
   comments are scrubbed. Open a PR — CI runs the Worker + web suites, and
   merging to `main` auto-deploys the Worker.

## Template skeleton

```ts
/** <Bank> transaction alerts. Regexes derived from a real sample email (see
 *  templates.test.ts). Extraction only — categorization is separate. */
const <bank>: Template = {
  senders: ['alerts@<bank>.com'],          // real alert senders / fragments
  parse(email) {
    const text = `${email.subject}\n${email.text}`;

    // Amount — the AUTHORITATIVE line from the real email, not the first $
    // found (avoid threshold/prose decoys). No match ⇒ [] ⇒ review row.
    const amount = /<derive from sample>\$([\d,]+\.\d{2})/.exec(text)?.[1];
    const cents = amount ? centsFrom(amount) : null;
    if (cents === null) return [];

    const last4 = /(?:ending in|\.\.\.)\s*\(?(\d{4})\)?/.exec(text)?.[1] ?? null;

    // Merchant — read off the real email; strip framing down to the name.
    const merchant = /<derive from sample>/.exec(text)?.[1] ?? null;

    const refund = isRefund(text);

    return [{
      kind: refund ? 'refund' : 'purchase',
      merchantRaw: merchant?.trim() ?? 'Unknown',
      amountCents: refund ? -cents : cents,
      currency: 'USD',
      // Real instant only. parseAlertInstant() when the alert states a time and
      // zone; receivedAt otherwise. Never Date.UTC(y, m, d) — see Dates.
      occurredAt: parseAlertInstant(text) ?? email.receivedAt,
      accountLast4: last4,
    }];
  },
};
```

## Test skeleton

```ts
describe('<Bank>', () => {
  // Fixture mirrors the real email's FORMAT; every real value is scrubbed.
  it('parses the sample layout', () => {
    const c = routeAndParse(email({
      from: 'alerts@<bank>.com',
      subject: '<scrubbed subject>',
      text: ['<scrubbed body line>', '<...>'].join('\n'),
    }), USER)!;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      kind: 'purchase',
      amountCents: <scrubbed cents>,
      merchantRaw: '<scrubbed merchant>',
      accountLast4: '<scrubbed last4>',
    });
  });

  it('returns [] when there is no amount', () => {
    expect(routeAndParse(email({
      from: 'alerts@<bank>.com',
      subject: 'Statement ready', text: 'Log in to view.',
    }), USER)).toEqual([]);   // → review row, never a $0 transaction
  });
});
```

`email()` and `USER` are the existing helpers at the top of the test file.

## Common pitfalls (all seen in this repo)

- **UTC-midnight dates.** Shipped a real bug: Chase charges on the 1st fell into
  the previous month. See **Dates**.
- **Decoy amount.** The subject may carry an alert *threshold* (`"exceeded
  $0.00"`) while the body has the real charge.
- **Merchant framing.** Names arrive wrapped (`"transaction with X exceeded $Y"`).
- **HTML-flattened bodies.** The Worker uses `msg.text` when present, else
  `stripHtml(msg.html)` (`Worker/src/parsing/htmlStripper.ts`). A label and its
  value may end up on separate lines, or the label may vanish. Match what the
  stripper actually produces, not the Gmail web view — check by pasting the body
  through `stripHtml` if unsure.
- **Forwarded vs filter-forwarded.** A Gmail *filter* forward preserves the
  bank's original `From:`. A manual "Fwd:" replaces it with the forwarder's
  address and nests the original in the body — so a manually forwarded sample
  shows the wrong sender. Read the nested `From:` for the real one.
- **Forgetting the router array** (step 4) — the template silently never runs.
- **Refund sign.** Refunds must be negative.
- **Real data hiding in comments.** Scrub comments too, and grep to confirm.
