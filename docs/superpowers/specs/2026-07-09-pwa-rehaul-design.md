# PWA Rehaul — Design

**Date:** 2026-07-09
**Status:** Approved (brainstormed with Jacob)
**App name:** **Tally** (chosen 2026-07-09) — used in the PWA manifest,
Apple home-screen title, and UI. Served at `tally.expense-app.uk`.
**Decision:** Rebuild the expense tracker as a Progressive Web App (the Boda/BoDay
approach — see `PWA-APPROACH.md`), replacing the native iOS app. Cloudflare hosts
everything web-facing; Supabase holds the data. Everything stays on free tiers
(the only paid item is the Cloudflare domain, already owned).

The Swift code (`App/`, `Packages/ExpenseKit/`) is **not deleted** — it stays in
the repo as reference (parser regexes, test fixtures, data-model shape) until
Jacob decides to remove it.

## Why

Boda (a PWA: React + TS + Vite + Tailwind, Cloudflare hosting, Supabase backend)
proved far easier to build, update, and install than the Xcode path: no $99/year
developer account, no 7-day re-signing, updates deploy instantly to a URL,
install via Safari → Add to Home Screen.

## Decisions made during brainstorming

1. **Multi-user with invite keys.** One deployment serves Jacob + a few friends
   and family. Signup requires an invite code. Jacob's account is the **master
   account** and has a "Generate key" button (Boda pattern). Codes are
   **6 characters** (Boda used 4; slightly longer per Jacob).
2. **Parsing happens in the Worker**, at email-arrival time. Transactions are
   ready in the database before the app is ever opened.
3. **Supabase** for app data (Postgres + Auth). Same as Boda.
4. **Core-first scope** for v1 (see Screens below); charts/trends/filters follow
   as instant PWA updates.

## Architecture

```
Gmail filter (per user, auto-forward bank alerts)
        │
        ▼
Cloudflare Email Routing ──► Worker email() handler
                                │  parse with TS templates (Chase, Fidelity)
                                │  dedup on (message_id, line_idx)
                                ▼
                         Supabase Postgres  ◄──── PWA (supabase-js + RLS)
                         (service-role key         │
                          as Worker secret)        ▼
                                            Cloudflare static hosting
                                            (Jacob's domain, wrangler deploy)
```

- **`web/`** (new): the PWA. React + TypeScript + Vite + Tailwind +
  `vite-plugin-pwa` (manifest + service worker) + Apple meta tags in
  `index.html`, per the recipe in `PWA-APPROACH.md`. Talks only to Supabase.
- **`Worker/`** (evolves in place): keeps Email Routing entry point and the
  per-user address provisioning; gains the TypeScript parser templates and a
  Supabase writer. The store-and-forward D1 buffer and `/messages`+`/ack`
  polling API are removed once the new flow is verified (the phone no longer
  polls).
- **`supabase/`** (new): SQL migrations for the schema below, checked in.

**Approaches considered:** (A) evolve the existing Worker and write to Supabase
— chosen; (B) Worker as dumb relay → Supabase Edge Function parses — extra hop,
logic split across two backends, rejected; (C) parse in the browser — rejected
(transactions should land while the app is closed).

## Auth + invites

- Supabase Auth, email/password.
- `invite_codes` table. Signup form sends the code in `signUp` metadata; a
  Postgres trigger on `auth.users` insert validates it (exists, unused) and
  **rejects the signup server-side** if invalid, then marks the code used.
- `profiles` row per user: `is_master` flag, forwarding address once
  provisioned. Master sees a "Generate key" button in Settings → inserts a new
  6-char code and shows it for copy/share.
- Row-level security on every data table: `user_id = auth.uid()`.

## Email ingestion (Worker)

- Per-user forwarding address: keep the existing `/provision` mechanism, but
  triggered from the PWA after login (the Worker validates the caller's
  Supabase JWT) — no more typing the operator key on a phone. The
  address→user mapping is stored in Supabase (`profiles.forward_address`),
  which is also what the `email()` handler looks up on arrival — D1 is no
  longer involved.
- `email()` handler: identify the user from the destination address → run
  `TemplateRouter` (TS ports of `ChaseTemplate` + `FidelityTemplate`, plus the
  HTML-stripping and money-parsing helpers) → insert `transactions` rows, or a
  `review_queue` row when no template matches or the amount can't be parsed.
  **Never guess, never drop silently.**
- Invariants carried over verbatim from the iOS spec:
  - Money is **integer cents** (`amount_cents bigint`). No floats anywhere.
    One string→cents function, ported with its tests.
  - Idempotent: dedup on `(message_id, line_idx)` unique constraint; refunds
    are negative `amount_cents`; two identical legit charges = two emails =
    two rows, never merged.
  - Only `purchase` and `refund` stored; balance/statement/payment notices
    land in review (templates parse only their anchored amount line).
  - Month bucketing uses the household timezone, not UTC.
  - Store only a trimmed excerpt of the email, never full bodies.

## Data model (Supabase Postgres, RLS on all)

| table | key columns |
|---|---|
| `profiles` | `id (auth.users)`, `is_master`, `forward_address`, `timezone` |
| `invite_codes` | `code (6 chars)`, `created_by`, `used_by`, `used_at` |
| `categories` | `user_id`, `name`, `archived` |
| `budgets` | `user_id`, `category_id`, `month (date, first of month)`, `amount_cents` |
| `transactions` | `user_id`, `amount_cents (signed)`, `kind (purchase\|refund)`, `merchant_raw`, `category_id (nullable → Uncategorized)`, `occurred_at`, `account_last4`, `message_id`, `line_idx`, unique `(user_id, message_id, line_idx)` |
| `review_queue` | `user_id`, `sender`, `subject`, `excerpt`, `received_at`, `resolved` |

## v1 screens (core first)

- **Login / Signup** (signup asks for invite key).
- **Budget tab**: per-category spent/remaining for the viewed month, progress
  bars, month switcher.
- **Transactions tab**: list for the month, manual add (purchase/refund,
  amount, merchant, category), tap to assign/fix category.
- **Settings tab**: manage categories; email-forwarding setup (provision
  address + numbered Gmail-filter steps with copy buttons + confirmation-link
  surfacing); master-only "Generate invite key".

Deferred to follow-up deploys: charts, spending trends, search/filter, review
queue UI (rows still accumulate in `review_queue` from day one), account
auto-naming, merchant→category memory, push notifications.

## Testing & verification

### End-to-end testability (added per Jacob, 2026-07-09)

- **TestBank template**: each user's own email address (the one on their
  account) is treated as a trusted pseudo-bank with a fixed format —
  subject `TestBank alert`, body line `You made a purchase of $X.XX at
  MERCHANT` (and `refund` variant). Sending yourself an email in that format
  and letting the Gmail filter forward it exercises the entire real pipe
  (forwarding → Worker → parse → Supabase → app) on demand. Same invariants
  as real templates: anchored amount line only, no guessing.
- **New banks from real emails**: unmatched emails keep sender/subject/excerpt
  in `review_queue`, so a real alert from a new bank is the fixture for its
  template + Vitest test (the `/new-bank` scaffold workflow, ported to the
  TypeScript parser).
- **Gmail forwarding setup** is the known-fiddly step (Jacob hit trouble
  2026-07-07wk): the Settings flow must walk through it numbered-step by
  step with copy buttons and auto-surface Google's forwarding-confirmation
  link when it arrives at the Worker.

- **Parser templates, money parsing, dedup** are the correctness-critical path:
  ported to TS with **Vitest**, reusing the existing Swift test fixtures
  (sample emails) so behavior provably matches.
- Worker logic testable via `wrangler dev --local` as before; the `email()`
  handler gets unit tests around parse→insert with a mocked Supabase client.
- Web app: Vitest for money formatting/budget math; UI verified by Jacob on
  the phone (Claude can't see it) — deploys are instant so iteration is cheap.

## Deployment

- Worker: `npx wrangler deploy` (existing setup; add `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` secrets).
- PWA: `npm run build && npx wrangler deploy` static assets, served on Jacob's
  paid Cloudflare domain. HTTPS included (required for PWA).
- Supabase: free-tier project; schema applied via checked-in migrations.
- Install: Safari → Share → Add to Home Screen.

## Implementation notes

- Bulk work (Vite scaffold, template/test porting, migrations) is delegated to
  Antigravity (agy/Gemini) with Claude verifying every gate — never trusting a
  self-reported pass.
- Start fresh on data — no backfill from the iOS app (it was never in real
  daily use).
