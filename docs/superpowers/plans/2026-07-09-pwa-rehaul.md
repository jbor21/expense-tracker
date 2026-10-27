# PWA Rehaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the expense tracker as a multi-user PWA (React/Vite on Cloudflare, Supabase data+auth) with email parsing moved into the existing Cloudflare Worker, per `docs/superpowers/specs/2026-07-09-pwa-rehaul-design.md`.

**Architecture:** Gmail filters forward bank alerts to per-user addresses on the existing `Worker/` (Cloudflare Email Routing). The Worker parses each email with TypeScript ports of the Swift templates and writes rows straight into Supabase Postgres. The new `web/` PWA talks only to Supabase (`supabase-js` + RLS) and is deployed as Cloudflare static assets on Jacob's domain (`expense-app.uk`).

**Tech Stack:** TypeScript everywhere. Worker: Cloudflare Workers + `postal-mime` + Vitest. Web: React 18 + Vite + Tailwind + `vite-plugin-pwa` + `@supabase/supabase-js` + `react-router-dom` + Vitest. Database: Supabase (Postgres + Auth), migrations as checked-in SQL.

## Global Constraints

- **Money is integer cents** (`amount_cents: number` in TS, `bigint` in Postgres). Never floats. `centsFrom()` in `Worker/src/parsing/money.ts` is the only string→cents path server-side; `centsFromInput()` in `web/src/lib/money.ts` is the only manual-entry path.
- **Never guess, never drop silently:** a template that can't find its anchored amount line returns `[]`; unrouted/unparsed emails become `review_queue` rows.
- **Idempotent ingestion:** unique constraint `(user_id, message_id, line_idx)` on `transactions`; inserts use `on_conflict` ignore. Refunds are **negative** `amount_cents`. Two identical legit charges = two emails = two rows — never merged.
- Only `purchase` and `refund` are stored. Templates parse only their anchored amount line (Chase `Amount:`, Fidelity `charged $X at`, TestBank `You made a (purchase|refund) of $X at`) — no bare-`$` fallback.
- Store only a trimmed excerpt (500 chars) in `review_queue`, never full bodies.
- Swift code (`App/`, `Packages/`) is **never modified or deleted** by this plan.
- Free tiers only. Worker secrets via `wrangler secret put`, never committed. Supabase service-role key lives ONLY in the Worker; the web app uses the anon key + RLS.
- All new code TypeScript `strict: true`. Tests via Vitest, run with `npm test` in the package being changed.
- Commits: present tense `feat:` / `fix:` / `chore:` / `docs:`.
- **Delegation:** tasks marked **[DELEGATE-OK]** are bulk scaffolding suitable for Antigravity (`agy`) via the antigravity-delegate subagent; the executor MUST still run every verify step personally (never trust a self-reported pass). Unmarked tasks are judgement-heavy — do them directly.

---

## Task 1: Supabase project + schema migration

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `supabase/README.md`

**Interfaces:**
- Produces: tables `profiles`, `invite_codes`, `categories`, `budgets`, `transactions`, `review_queue`; trigger `handle_new_user` (validates `invite_code` from signup metadata, first-ever user becomes master, seeds default categories); RPC `generate_invite_code() returns text` (master-only). All later tasks depend on these exact names/columns.

- [ ] **Step 1: Ask Jacob to create the Supabase project** (or do it via dashboard if he's driving): project name `expense-tracker`, region closest to US East. Collect and have him store: `SUPABASE_URL` (`https://<ref>.supabase.co`), `anon` key, `service_role` key. These go in: Worker secrets (Task 6) and `web/.env.local` (Task 8). **Do not commit keys.**

- [ ] **Step 2: Write the migration**

`supabase/migrations/0001_init.sql`:

```sql
-- Expense Tracker PWA — initial schema. Apply in the Supabase SQL editor
-- (or `supabase db push`). See supabase/README.md.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  is_master boolean not null default false,
  forward_address text unique,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

create table public.invite_codes (
  code text primary key,
  created_by uuid not null references public.profiles (id),
  used_by uuid references public.profiles (id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  archived boolean not null default false,
  unique (user_id, name)
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  month date not null, -- always the first of the month
  amount_cents bigint not null check (amount_cents >= 0),
  unique (user_id, category_id, month)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents bigint not null, -- signed: refunds negative
  kind text not null check (kind in ('purchase', 'refund')),
  merchant_raw text not null,
  category_id uuid references public.categories (id) on delete set null,
  occurred_at timestamptz not null,
  account_last4 text,
  message_id text not null,
  line_idx integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, message_id, line_idx)
);

create table public.review_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  sender text not null,
  subject text not null,
  excerpt text not null, -- trimmed to 500 chars by the Worker, never full bodies
  received_at timestamptz not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- Signup gate: validate invite code from signUp metadata; first-ever user is
-- master and needs no code. Seeds default categories for every new user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  code text := upper(coalesce(new.raw_user_meta_data->>'invite_code', ''));
  is_first boolean;
  cat text;
begin
  select not exists (select 1 from public.profiles) into is_first;

  insert into public.profiles (id, email, is_master)
  values (new.id, new.email, is_first);

  if not is_first then
    update public.invite_codes
       set used_by = new.id, used_at = now()
     where invite_codes.code = code and used_by is null;
    if not found then
      raise exception 'invalid or already-used invite code';
    end if;
  end if;

  foreach cat in array array['Groceries','Dining','Gas','Shopping','Bills','Fun','Other'] loop
    insert into public.categories (user_id, name) values (new.id, cat);
  end loop;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Master-only invite generation: 6 chars from an unambiguous alphabet
-- (no 0/O/1/I/L), per the spec's "longer than Boda's 4".
create or replace function public.generate_invite_code()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  new_code text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_master) then
    raise exception 'only the master account can generate invite codes';
  end if;
  loop
    select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '')
      from generate_series(1, 6) into new_code;
    begin
      insert into public.invite_codes (code, created_by) values (new_code, auth.uid());
      return new_code;
    exception when unique_violation then
      -- collision: loop and try again
    end;
  end loop;
end;
$$;

-- Row-level security: every user sees only their own rows.
alter table public.profiles enable row level security;
alter table public.invite_codes enable row level security;
alter table public.categories enable row level security;
alter table public.budgets enable row level security;
alter table public.transactions enable row level security;
alter table public.review_queue enable row level security;

create policy "own profile read"   on public.profiles  for select using (id = auth.uid());
create policy "own profile update" on public.profiles  for update using (id = auth.uid());
-- invite_codes: no direct policies — access only via generate_invite_code() (security definer)

create policy "own categories" on public.categories  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own budgets"    on public.budgets     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own txns"       on public.transactions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own review"     on public.review_queue for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 3: Write `supabase/README.md`** — how to apply the migration (SQL editor paste, or `npx supabase db push` if the CLI gets linked later), where the three keys go (Worker secrets / `web/.env.local`), and a warning that `service_role` never leaves the Worker.

- [ ] **Step 4: Apply the migration** in the Supabase SQL editor. Verify: in the dashboard Table Editor, all 6 tables exist; run `select public.generate_invite_code();` as the SQL editor (will fail with "only the master account…" — expected, proves the guard works).

- [ ] **Step 5: Verify signup gate manually**: in the dashboard → Authentication, confirm email confirmations are OFF (friends-and-family app; can revisit). Sign up a test user via the dashboard "Add user" → confirm a `profiles` row with `is_master = true` appeared (first user) and 7 default categories.

- [ ] **Step 6: Commit**

```bash
git add supabase/
git commit -m "feat: Supabase schema — profiles, invites, budgets, transactions, RLS, signup trigger"
```

---

## Task 2: Worker test scaffolding + money port

**Files:**
- Create: `Worker/src/parsing/money.ts`
- Create: `Worker/test/money.test.ts`
- Create: `Worker/tsconfig.json`
- Modify: `Worker/package.json` (add `vitest`, `typescript`, `test` script)

**Interfaces:**
- Produces: `centsFrom(s: string): number | null` — parses the bare numeric group a template captured (`[\d,]+\.\d{2}` — no `$`); `"1,234.56"` → `123456`; `null` for anything not a clean 2-decimal amount.

- [ ] **Step 1: Add tooling.** In `Worker/`: `npm i -D vitest typescript`. Add to `package.json` scripts: `"test": "vitest run"`. Create `Worker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["@cloudflare/workers-types"],
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

Also `npm i -D @cloudflare/workers-types`.

- [ ] **Step 2: Write the failing test** — `Worker/test/money.test.ts` (ports `MoneyTests` behavior):

```ts
import { describe, it, expect } from 'vitest';
import { centsFrom } from '../src/parsing/money';

describe('centsFrom', () => {
  it('parses a plain 2-decimal amount', () => expect(centsFrom('42.10')).toBe(4210));
  it('parses thousands commas', () => expect(centsFrom('1,234.56')).toBe(123456));
  it('rejects missing decimals', () => expect(centsFrom('42')).toBeNull());
  it('rejects 1-decimal amounts', () => expect(centsFrom('42.1')).toBeNull());
  it('rejects 3-decimal amounts', () => expect(centsFrom('42.105')).toBeNull());
  it('rejects garbage', () => expect(centsFrom('abc')).toBeNull());
  it('rejects empty', () => expect(centsFrom('')).toBeNull());
  it('never produces floats', () => expect(centsFrom('0.10')).toBe(10));
});
```

- [ ] **Step 3: Run to verify it fails**: `cd Worker && npm test` → FAIL (module not found).

- [ ] **Step 4: Implement** `Worker/src/parsing/money.ts` (direct port of `Money.cents(from:)`):

```ts
/** Money is integer cents everywhere. This is the only string→cents path in
 *  the Worker. Expects the bare numeric group a template captured
 *  (`[\d,]+\.\d{2}` — no currency symbol). Returns null for anything that
 *  isn't a clean 2-decimal amount, so the caller routes to review rather
 *  than guessing. "1,234.56" → 123456. */
export function centsFrom(s: string): number | null {
  const parts = s.replace(/,/g, '').split('.');
  if (parts.length !== 2) return null;
  if (!/^\d+$/.test(parts[0]) || !/^\d{2}$/.test(parts[1])) return null;
  return parseInt(parts[0], 10) * 100 + parseInt(parts[1], 10);
}
```

- [ ] **Step 5: Run tests**: `npm test` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add Worker/src/parsing/money.ts Worker/test/money.test.ts Worker/tsconfig.json Worker/package.json Worker/package-lock.json
git commit -m "feat: Worker money.centsFrom — integer-cents port of Money.cents with tests"
```

---

## Task 3: HTML stripper port **[DELEGATE-OK]**

**Files:**
- Create: `Worker/src/parsing/htmlStripper.ts`
- Create: `Worker/test/htmlStripper.test.ts`

**Interfaces:**
- Produces: `stripHtml(html: string): string` — same 5-stage behavior as Swift `HTMLStripper.stripHTML`: (1) drop comments + `script/style/head/title` blocks whole, (2) `<br>` and closing block tags → `\n`, (3) remaining tags → `""` (NOT a space — so `$<span>42.31</span>` rejoins as `$42.31`), (4) decode named + numeric entities (incl. `&#36;` → `$`), (5) collapse spaces, cap blank runs, trim.

- [ ] **Step 1: Write the failing tests** — `Worker/test/htmlStripper.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stripHtml } from '../src/parsing/htmlStripper';

describe('stripHtml', () => {
  it('rejoins a tag-split amount with no space', () =>
    expect(stripHtml('$<span>42.31</span>')).toBe('$42.31'));
  it('drops style/script/head content entirely', () =>
    expect(stripHtml('<style>.x{font-size:12px}</style>hello')).toBe('hello'));
  it('turns block boundaries into newlines', () =>
    expect(stripHtml('<tr><td>Amount</td><td>$5.00</td></tr>')).toBe('Amount\n$5.00'));
  it('decodes numeric-entity dollar signs', () =>
    expect(stripHtml('&#36;42.10')).toBe('$42.10'));
  it('decodes hex entities and named entities', () =>
    expect(stripHtml('&#x24;5.00&nbsp;at&nbsp;caf&#233;')).toBe('$5.00 at café'));
  it('caps blank-line runs at two', () =>
    expect(stripHtml('a<br><br><br><br>b')).toBe('a\n\nb'));
});
```

- [ ] **Step 2: Run to verify FAIL**: `cd Worker && npm test`.

- [ ] **Step 3: Implement** `Worker/src/parsing/htmlStripper.ts`:

```ts
/** Turn an HTML email body into clean, regex-friendly text (port of Swift
 *  HTMLStripper). Order matters — see each stage. */
export function stripHtml(html: string): string {
  let text = html;

  // 1. Comments + non-content blocks (content AND tags) — their inner text
  //    would otherwise pollute the output with stray numbers.
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of ['script', 'style', 'head', 'title']) {
    text = text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ');
  }

  // 2. Block-level boundaries → newlines (keeps lines/cells separate).
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(?:p|div|tr|td|th|li|h[1-6]|table|ul|ol|section|header|footer)>/gi, '\n');

  // 3. Remaining tags → "" so a tag-split amount stays contiguous.
  text = text.replace(/<[^>]+>/g, '');

  // 4. Entities: named, then numeric decimal (&#36;) and hex (&#x24;).
  const named: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–',
  };
  for (const [entity, ch] of Object.entries(named)) text = text.split(entity).join(ch);
  text = text.replace(/&#(\d+);/g, (m, d) => {
    const cp = Number(d);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
  text = text.replace(/&#[xX]([0-9a-fA-F]+);/g, (m, h) => {
    const cp = parseInt(h, 16);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });

  // 5. Tidy whitespace.
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/ *\n/g, '\n');
  text = text.replace(/\n */g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}
```

(Note: stage 5 also strips leading spaces after newlines — the Swift version's
tables produced leading-space lines that its tests didn't pin down; the TS
tests above define the contract here.)

- [ ] **Step 4: Run tests**: `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add Worker/src/parsing/htmlStripper.ts Worker/test/htmlStripper.test.ts
git commit -m "feat: Worker stripHtml — port of HTMLStripper with tests"
```

---

## Task 4: Templates + router (Chase, Fidelity, TestBank)

**Files:**
- Create: `Worker/src/parsing/types.ts`
- Create: `Worker/src/parsing/templates.ts`
- Create: `Worker/test/templates.test.ts`

**Interfaces:**
- Produces:
  - `type ParsedCharge = { kind: 'purchase' | 'refund'; merchantRaw: string; amountCents: number; currency: 'USD'; occurredAt: Date; accountLast4: string | null }`
  - `type RawEmail = { messageId: string; from: string; subject: string; receivedAt: Date; text: string }` (`text` is already HTML-stripped plain text)
  - `routeAndParse(email: RawEmail, userEmail: string): ParsedCharge[] | null` — `null` = no template matched the sender (→ review); `[]` = template matched but found no anchored amount (→ review). `userEmail` enables the TestBank pseudo-bank: emails **from the user's own account email** parse with the TestBank format.

- [ ] **Step 1: Write the failing tests** — `Worker/test/templates.test.ts`. Port every fixture from `ChaseTemplateTests.swift` / `FidelityTemplateTests.swift` (they are the ground truth; amounts/merchants are already scrubbed placeholders):

```ts
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
      text: 'A refund was credited.\nAccount ending in 4321\nMade on Jun 19, 2026\nMerchant: TRADER JOE\'S #123\nAmount: $20.00',
    }), USER)!;
    expect(c[0].kind).toBe('refund');
    expect(c[0].amountCents).toBe(-2000);
  });

  it('extracts the Made on date (UTC)', () => {
    const c = routeAndParse(email({
      subject: 'Your $5.00 transaction with CORNER CAFE',
      text: 'Made on Jun 18, 2026\nAccount ending in 0001\nAmount: $5.00',
    }), USER)!;
    expect(c[0].occurredAt.toISOString()).toBe('2026-06-18T00:00:00.000Z');
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
      subject: 'Your credit card transaction with TRADER JOE\'S exceeded $0.00',
      text: 'You asked us to alert you when a transaction exceeds $0.00.\nAccount ending in 4321\nMade on Jun 18, 2026\nMerchant: TRADER JOE\'S #456\nAmount: $42.10',
    }), USER)!;
    expect(c[0].amountCents).toBe(4210);
  });

  it('extracts the merchant from the threshold subject', () => {
    const c = routeAndParse(email({
      subject: 'Your credit card transaction with TRADER JOE\'S exceeded $0.00',
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
    expect(c[0].occurredAt.toISOString().slice(0, 10)).toBe('2026-06-18');
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
```

- [ ] **Step 2: Run to verify FAIL**: `cd Worker && npm test`.

- [ ] **Step 3: Implement** `Worker/src/parsing/types.ts`:

```ts
export type ChargeKind = 'purchase' | 'refund';

export interface ParsedCharge {
  kind: ChargeKind;
  merchantRaw: string;
  amountCents: number; // signed integer cents; refunds negative
  currency: 'USD';
  occurredAt: Date;
  accountLast4: string | null;
}

export interface RawEmail {
  messageId: string;
  from: string;      // full From header (may include display name)
  subject: string;
  receivedAt: Date;
  text: string;      // plain text (already HTML-stripped if needed)
}
```

- [ ] **Step 4: Implement** `Worker/src/parsing/templates.ts` (regexes are 1:1 ports of the Swift templates — keep the comments, they encode why there is no bare-`$` fallback):

```ts
import { centsFrom } from './money';
import type { ParsedCharge, RawEmail } from './types';

export type { ParsedCharge, RawEmail } from './types';

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** "Jun 18, 2026" → Date at UTC midnight (deterministic; per-household tz is a
 *  display concern). Null if unparseable. */
function parseAlertDate(d: string): Date | null {
  const m = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/.exec(d);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
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

    // Date behind "Made on Jun 18, 2026" or "Date  Jun 18, 2026 at <time> ET".
    const dateStr = /(?:Made on|Date):?\s*([A-Za-z]{3} \d{1,2}, \d{4})/.exec(text)?.[1];
    const refund = isRefund(text);

    return [{
      kind: refund ? 'refund' : 'purchase',
      merchantRaw: merchant?.trim() ?? 'Unknown',
      amountCents: refund ? -cents : cents,
      currency: 'USD',
      occurredAt: (dateStr && parseAlertDate(dateStr)) || email.receivedAt,
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
```

- [ ] **Step 5: Run tests**: `npm test` → all PASS (money + stripper + templates).

- [ ] **Step 6: Commit**

```bash
git add Worker/src/parsing/ Worker/test/templates.test.ts
git commit -m "feat: TS templates — Chase, Fidelity, TestBank pseudo-bank + router, fixtures ported"
```

---

## Task 5: Supabase writer for the Worker

**Files:**
- Create: `Worker/src/supabaseWriter.ts`
- Create: `Worker/test/supabaseWriter.test.ts`

**Interfaces:**
- Consumes: `ParsedCharge` from Task 4.
- Produces (all take `env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string }` and use global `fetch`):
  - `lookupProfileByAddress(env, address: string): Promise<{ id: string; email: string } | null>`
  - `insertTransactions(env, userId: string, messageId: string, charges: ParsedCharge[]): Promise<void>` — one row per charge with `line_idx` = array index; `on_conflict=user_id,message_id,line_idx` + `Prefer: resolution=ignore-duplicates` makes re-forwarded emails a no-op.
  - `insertReviewRow(env, userId: string, row: { sender: string; subject: string; excerpt: string; receivedAt: Date }): Promise<void>` — excerpt pre-trimmed to 500 chars by the caller.
  - `setForwardAddress(env, userId: string, address: string): Promise<void>`
  - `getUserFromJwt(env, jwt: string): Promise<{ id: string } | null>` — `GET {url}/auth/v1/user` with the caller's access token.

- [ ] **Step 1: Write failing tests** — `Worker/test/supabaseWriter.test.ts`, stubbing `fetch` with `vi.stubGlobal`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  lookupProfileByAddress, insertTransactions, insertReviewRow, getUserFromJwt,
} from '../src/supabaseWriter';

const env = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sk' };
let calls: { url: string; init: RequestInit }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.includes('/rest/v1/profiles') && init.method === undefined)
      return new Response(JSON.stringify([{ id: 'u1', email: 'jacob@example.com' }]), { status: 200 });
    if (url.includes('/auth/v1/user'))
      return new Response(JSON.stringify({ id: 'u1' }), { status: 200 });
    return new Response('', { status: 201 });
  }));
});

describe('lookupProfileByAddress', () => {
  it('queries profiles by forward_address with the service key', async () => {
    const p = await lookupProfileByAddress(env, 'u_abc@expense-app.uk');
    expect(p).toEqual({ id: 'u1', email: 'jacob@example.com' });
    expect(calls[0].url).toContain('forward_address=eq.u_abc%40expense-app.uk');
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe('sk');
  });
});

describe('insertTransactions', () => {
  it('POSTs rows with line_idx = index and ignore-duplicates', async () => {
    await insertTransactions(env, 'u1', 'mid-1', [{
      kind: 'purchase', merchantRaw: 'CAFE', amountCents: 500,
      currency: 'USD', occurredAt: new Date('2026-06-18T00:00:00Z'), accountLast4: null,
    }]);
    const call = calls[0];
    expect(call.url).toContain('/rest/v1/transactions');
    expect(call.url).toContain('on_conflict=user_id%2Cmessage_id%2Cline_idx');
    expect((call.init.headers as Record<string, string>).Prefer).toContain('resolution=ignore-duplicates');
    const body = JSON.parse(call.init.body as string);
    expect(body[0]).toMatchObject({
      user_id: 'u1', message_id: 'mid-1', line_idx: 0,
      amount_cents: 500, kind: 'purchase', merchant_raw: 'CAFE',
    });
  });

  it('throws on non-2xx so the caller can reject the email (retry later)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(insertTransactions(env, 'u1', 'm', [])).resolves.toBeUndefined(); // empty = no-op
    await expect(insertTransactions(env, 'u1', 'm', [{
      kind: 'purchase', merchantRaw: 'X', amountCents: 1, currency: 'USD',
      occurredAt: new Date(), accountLast4: null,
    }])).rejects.toThrow();
  });
});

describe('insertReviewRow', () => {
  it('POSTs the review row', async () => {
    await insertReviewRow(env, 'u1', {
      sender: 'x@y.com', subject: 's', excerpt: 'e', receivedAt: new Date('2026-06-18T00:00:00Z'),
    });
    expect(calls[0].url).toContain('/rest/v1/review_queue');
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
```

- [ ] **Step 2: Run to verify FAIL**, then **Step 3: Implement** `Worker/src/supabaseWriter.ts`:

```ts
import type { ParsedCharge } from './parsing/types';

export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function svcHeaders(env: SupabaseEnv): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function must(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
  return res;
}

export async function lookupProfileByAddress(
  env: SupabaseEnv, address: string,
): Promise<{ id: string; email: string } | null> {
  const url = `${env.SUPABASE_URL}/rest/v1/profiles?select=id,email&forward_address=eq.${encodeURIComponent(address)}`;
  const rows = await (await must(await fetch(url, { headers: svcHeaders(env) }), 'profile lookup')).json() as { id: string; email: string }[];
  return rows[0] ?? null;
}

export async function insertTransactions(
  env: SupabaseEnv, userId: string, messageId: string, charges: ParsedCharge[],
): Promise<void> {
  if (charges.length === 0) return;
  const url = `${env.SUPABASE_URL}/rest/v1/transactions?on_conflict=${encodeURIComponent('user_id,message_id,line_idx')}`;
  await must(await fetch(url, {
    method: 'POST',
    headers: { ...svcHeaders(env), Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify(charges.map((c, i) => ({
      user_id: userId,
      amount_cents: c.amountCents,
      kind: c.kind,
      merchant_raw: c.merchantRaw,
      occurred_at: c.occurredAt.toISOString(),
      account_last4: c.accountLast4,
      message_id: messageId,
      line_idx: i,
    }))),
  }), 'transactions insert');
}

export async function insertReviewRow(
  env: SupabaseEnv, userId: string,
  row: { sender: string; subject: string; excerpt: string; receivedAt: Date },
): Promise<void> {
  await must(await fetch(`${env.SUPABASE_URL}/rest/v1/review_queue`, {
    method: 'POST',
    headers: svcHeaders(env),
    body: JSON.stringify({
      user_id: userId,
      sender: row.sender,
      subject: row.subject,
      excerpt: row.excerpt,
      received_at: row.receivedAt.toISOString(),
    }),
  }), 'review insert');
}

export async function setForwardAddress(
  env: SupabaseEnv, userId: string, address: string,
): Promise<void> {
  await must(await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: svcHeaders(env),
    body: JSON.stringify({ forward_address: address }),
  }), 'set forward_address');
}

export async function getUserFromJwt(
  env: SupabaseEnv, jwt: string,
): Promise<{ id: string } | null> {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return null;
  const user = await res.json() as { id?: string };
  return user.id ? { id: user.id } : null;
}
```

- [ ] **Step 4: Run tests**: `npm test` → PASS. **Step 5: Commit**

```bash
git add Worker/src/supabaseWriter.ts Worker/test/supabaseWriter.test.ts
git commit -m "feat: Worker Supabase writer — profile lookup, idempotent txn insert, review rows, JWT check"
```

---

## Task 6: New Worker entry — parse-on-arrival + JWT provision

**Files:**
- Create: `Worker/src/index.ts` (replaces `src/index.js`)
- Delete: `Worker/src/index.js`
- Create: `Worker/test/emailHandler.test.ts`
- Modify: `Worker/wrangler.toml` (main → `src/index.ts`; keep D1 binding until first deploy verifies, then remove in Task 13)

**Interfaces:**
- Consumes: `routeAndParse`, `stripHtml`, writer functions from Tasks 3–5.
- Produces: Worker with `email()` (parse → Supabase) and `POST /provision` (Bearer = Supabase access token → `{ address }`). The old `/messages`, `/ack`, D1 writes, and `PROVISION_KEY` are **gone** — the app no longer polls.

- [ ] **Step 1: Extract the email pipeline as a pure function for testability.** Structure `index.ts` so the handler logic is `handleInboundEmail(env, msg: { to: string; from: string; subject: string; messageId: string | null; date: Date; text: string; html: string }): Promise<'stored' | 'review' | 'rejected'>` and the `email()` export only adapts `ForwardableEmailMessage` + PostalMime into that shape.

- [ ] **Step 2: Write failing tests** — `Worker/test/emailHandler.test.ts` (stub the writer module with `vi.mock`):

```ts
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

const env = { SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k', INBOX_DOMAIN: 'expense-app.uk' } as any;
const base = {
  to: 'u_abc@expense-app.uk', from: 'alerts@chase.com',
  subject: "Your $42.10 transaction with TRADER JOE'S",
  messageId: '<mid-1@chase.com>', date: new Date('2026-06-18T12:00:00Z'),
  text: 'Account ending in 4321\nAmount: $42.10', html: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(writer.lookupProfileByAddress).mockResolvedValue({ id: 'u1', email: 'jacob@example.com' });
});

describe('handleInboundEmail', () => {
  it('rejects unknown recipients so Gmail shows a visible bounce', async () => {
    vi.mocked(writer.lookupProfileByAddress).mockResolvedValue(null);
    expect(await handleInboundEmail(env, base)).toBe('rejected');
    expect(writer.insertTransactions).not.toHaveBeenCalled();
  });

  it('parses a matched email and stores transactions', async () => {
    expect(await handleInboundEmail(env, base)).toBe('stored');
    expect(writer.insertTransactions).toHaveBeenCalledWith(env, 'u1', '<mid-1@chase.com>',
      [expect.objectContaining({ amountCents: 4210 })]);
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
      [expect.objectContaining({ amountCents: 4210 })]);
  });

  it('falls back to a synthetic message id when the header is missing', async () => {
    await handleInboundEmail(env, { ...base, messageId: null });
    const mid = vi.mocked(writer.insertTransactions).mock.calls[0][2];
    expect(mid).toBeTruthy(); // deterministic fallback, e.g. `${to}:${date.toISOString()}:${subject}`
  });
});
```

- [ ] **Step 3: Run to verify FAIL**, then **Step 4: Implement** `Worker/src/index.ts`:

```ts
// expense-inbox — inbound-email parser for the Expense Tracker PWA.
//
// Cloudflare Email Routing delivers mail sent to a per-user address here; the
// Worker parses it with the bank templates and writes rows straight into
// Supabase. The PWA never sees raw email.
//
// Routes:
//   POST /provision   Bearer <supabase access token> → { address }
//
// The old store-and-forward surface (/messages, /ack, D1) is retired — the
// app reads Supabase directly.

import PostalMime from 'postal-mime';
import { stripHtml } from './parsing/htmlStripper';
import { routeAndParse } from './parsing/templates';
import {
  getUserFromJwt, insertReviewRow, insertTransactions,
  lookupProfileByAddress, setForwardAddress, type SupabaseEnv,
} from './supabaseWriter';

export interface Env extends SupabaseEnv {
  INBOX_DOMAIN: string;
}

const EXCERPT_CHARS = 500;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function bearer(request: Request): string | null {
  const h = request.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface InboundMsg {
  to: string;
  from: string;
  subject: string;
  messageId: string | null;
  date: Date;
  text: string;
  html: string;
}

export async function handleInboundEmail(
  env: Env, msg: InboundMsg,
): Promise<'stored' | 'review' | 'rejected'> {
  const profile = await lookupProfileByAddress(env, msg.to.toLowerCase());
  if (!profile) return 'rejected';

  const text = msg.text.trim() !== '' ? msg.text : stripHtml(msg.html);
  const messageId = msg.messageId ?? `${msg.to}:${msg.date.toISOString()}:${msg.subject}`;
  const charges = routeAndParse(
    { messageId, from: msg.from, subject: msg.subject, receivedAt: msg.date, text },
    profile.email,
  );

  if (charges === null || charges.length === 0) {
    // Unknown sender, or a known sender with no anchored amount line —
    // never guess, never drop silently.
    await insertReviewRow(env, profile.id, {
      sender: msg.from,
      subject: msg.subject,
      excerpt: text.slice(0, EXCERPT_CHARS),
      receivedAt: msg.date,
    });
    return 'review';
  }

  await insertTransactions(env, profile.id, messageId, charges);
  return 'stored';
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const parsed = await PostalMime.parse(message.raw);
    const date = parsed.date ? new Date(parsed.date) : new Date();
    const outcome = await handleInboundEmail(env, {
      to: message.to,
      // Gmail filter-forwarding preserves the original From — the sender the
      // templates match on.
      from: parsed.from?.address ?? message.from,
      subject: parsed.subject ?? '',
      messageId: parsed.messageId ?? null,
      date: Number.isNaN(date.getTime()) ? new Date() : date,
      text: parsed.text ?? '',
      html: parsed.html ?? '',
    });
    // Reject unknown recipients so a typo'd forwarding address fails visibly
    // in Gmail instead of silently swallowing mail.
    if (outcome === 'rejected') message.setReject('No such recipient');
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/provision') {
      const jwt = bearer(request);
      const user = jwt ? await getUserFromJwt(env, jwt) : null;
      if (!user) return json({ error: 'unauthorized' }, 401);
      const address = `u_${randomHex(8)}@${env.INBOX_DOMAIN}`;
      await setForwardAddress(env, user.id, address);
      return json({ address });
    }

    return json({ error: 'not found' }, 404);
  },
};
```

- [ ] **Step 5: Update `wrangler.toml`**: `main = "src/index.ts"`; delete the `[triggers]` cron block (no D1 rows to purge anymore); keep the `[[d1_databases]]` binding commented-out until Task 13 confirms nothing needs it. Delete `Worker/src/index.js`.

- [ ] **Step 6: Run all Worker tests**: `cd Worker && npm test` → PASS. Also `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add -A Worker/
git commit -m "feat: Worker parses on arrival and writes Supabase; JWT-gated /provision; retire polling API"
```

---

## Task 7: Deploy Worker + live end-to-end check

**Files:** none new (operational task)

- [ ] **Step 1: Set secrets**: `cd Worker && npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (values from Task 1). Delete the obsolete secret: `npx wrangler secret delete PROVISION_KEY` (after confirming Task 6 removed its use).

- [ ] **Step 2: Deploy**: `npx wrangler deploy`. Expected output ends with the deployed route.

- [ ] **Step 3: Verify /provision rejects anonymous**: `curl -s -X POST https://expense-inbox.<subdomain>.workers.dev/provision | jq` → `{"error":"unauthorized"}`.

- [ ] **Step 4: Live email test** (needs Task 1's test user to have a `forward_address` — set one directly in the Table Editor for now, e.g. `u_test@expense-app.uk`): send an email **from the test user's account email** to `u_test@expense-app.uk` with subject `TestBank alert`, body `You made a purchase of $12.34 at COFFEE SHOP.` → confirm a `transactions` row (`amount_cents = 1234`, `merchant_raw = 'COFFEE SHOP'`) in the Supabase Table Editor. Send it twice → still exactly one row (dedup via Message-ID… note Gmail assigns a new Message-ID per send, so re-send the *same* email via Gmail's "Forward" to test true duplication, or verify the constraint directly in SQL).

- [ ] **Step 5: Verify review path**: send an email from any other address → confirm a `review_queue` row, no transaction.

- [ ] **Step 6: Commit any config tweaks**; note results in the PR/commit body.

---

## Task 8: Scaffold `web/` **[DELEGATE-OK]**

**Files:**
- Create: `web/` — Vite React-TS app: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `tailwind.config.js`, `postcss.config.js`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `.env.example`, `.gitignore`
- Create: `web/src/lib/supabase.ts`

**Interfaces:**
- Produces: `supabase` client singleton (`web/src/lib/supabase.ts`) importing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from env; app shell with `react-router-dom` routes `/login`, `/signup`, and an authenticated layout with bottom-tab routes `/` (Budget), `/transactions`, `/settings`.

- [ ] **Step 1: Scaffold**: `npm create vite@latest web -- --template react-ts`, then in `web/`: `npm i @supabase/supabase-js react-router-dom` and `npm i -D tailwindcss @tailwindcss/vite vite-plugin-pwa vitest`. Wire Tailwind v4 via the Vite plugin (`@tailwindcss/vite` in `vite.config.ts`, `@import "tailwindcss";` at the top of `src/index.css`).

- [ ] **Step 2: `web/src/lib/supabase.ts`**:

```ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
```

`web/.env.example` (committed) documents both vars plus `VITE_WORKER_URL`; real values go in `web/.env.local` (gitignored).

- [ ] **Step 3: App shell** — `src/App.tsx` with `BrowserRouter`; a `RequireAuth` wrapper that subscribes to `supabase.auth.onAuthStateChange`, shows `/login` when signed out; an authenticated `TabLayout` with a fixed bottom tab bar (Budget / Transactions / Settings) using `NavLink`s and Tailwind classes; placeholder page components for the three tabs (real ones land in Tasks 10–12).

- [ ] **Step 4: Verify**: `cd web && npm run build` → clean; `npm run dev` reachable. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "feat: scaffold web/ PWA shell — Vite+React+TS+Tailwind, supabase client, tab routing"
```

---

## Task 9: Auth — login + invite-code signup

**Files:**
- Create: `web/src/pages/Login.tsx`, `web/src/pages/Signup.tsx`
- Modify: `web/src/App.tsx` (routes)

**Interfaces:**
- Consumes: `supabase` from Task 8; the `handle_new_user` trigger from Task 1 (invite code travels as `options.data.invite_code`).
- Produces: working session; signup surfaces the trigger's `invalid or already-used invite code` error verbatim.

- [ ] **Step 1: `Signup.tsx`** — email, password, invite-code fields:

```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { invite_code: inviteCode.trim().toUpperCase() } },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    nav('/');
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-sm p-6 space-y-4">
      <h1 className="text-2xl font-bold">Create account</h1>
      <input className="w-full rounded border p-3" type="email" required placeholder="Email"
        value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="w-full rounded border p-3" type="password" required minLength={8}
        placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <input className="w-full rounded border p-3 uppercase tracking-widest" required
        placeholder="Invite key" value={inviteCode} maxLength={6}
        onChange={(e) => setInviteCode(e.target.value)} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={busy} className="w-full rounded bg-blue-600 p-3 font-semibold text-white disabled:opacity-50">
        Sign up
      </button>
      <p className="text-sm text-gray-500">Have an account? <Link className="text-blue-600" to="/login">Log in</Link></p>
    </form>
  );
}
```

- [ ] **Step 2: `Login.tsx`** — same shape with `supabase.auth.signInWithPassword({ email, password })`, link to `/signup`.

- [ ] **Step 3: Verify against the real Supabase project**: `npm run dev`; sign up WITHOUT a valid code → the trigger error surfaces; generate a code in SQL (`select public.generate_invite_code();` while impersonating the master via the dashboard, or insert a row by hand), sign up WITH it → lands on Budget tab; `profiles` row exists, code marked used, 7 categories seeded.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Login.tsx web/src/pages/Signup.tsx web/src/App.tsx
git commit -m "feat: login + invite-gated signup against Supabase Auth"
```

---

## Task 10: Money/date helpers + Budget tab

**Files:**
- Create: `web/src/lib/money.ts`, `web/src/lib/months.ts`, `web/src/lib/money.test.ts`, `web/src/lib/months.test.ts`
- Create: `web/src/pages/Budget.tsx`, `web/src/components/MonthSwitcher.tsx`

**Interfaces:**
- Produces:
  - `centsFromInput(s: string): number | null` (tolerant manual-entry parse, port of Swift `Money.centsFromInput`: accepts `$`, commas, 0/1/2 decimals; `null` on 3+ decimals or garbage)
  - `formatCents(cents: number): string` (`123456` → `"$1,234.56"`; the ONLY cents→display path)
  - `monthKey(d: Date, tz: string): string` (`"2026-07"` in the household timezone — month bucketing is NOT UTC)
  - `monthRange(key: string, tz: string): { startISO: string; endISO: string }` (UTC instants bounding that local month, for `occurred_at` range queries)

- [ ] **Step 1: Write failing tests** — `web/src/lib/money.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { centsFromInput, formatCents } from './money';

describe('centsFromInput', () => {
  it('parses "12" as 1200', () => expect(centsFromInput('12')).toBe(1200));
  it('parses "12.5" as 1250', () => expect(centsFromInput('12.5')).toBe(1250));
  it('parses "12.50" as 1250', () => expect(centsFromInput('12.50')).toBe(1250));
  it('parses "$1,234.56" as 123456', () => expect(centsFromInput(' $1,234.56 ')).toBe(123456));
  it('parses "12." as 1200', () => expect(centsFromInput('12.')).toBe(1200));
  it('rejects 3+ decimals', () => expect(centsFromInput('12.345')).toBeNull());
  it('rejects garbage', () => expect(centsFromInput('twelve')).toBeNull());
  it('rejects empty', () => expect(centsFromInput('  ')).toBeNull());
});

describe('formatCents', () => {
  it('formats positive', () => expect(formatCents(123456)).toBe('$1,234.56'));
  it('formats negative (refunds)', () => expect(formatCents(-500)).toBe('-$5.00'));
  it('formats zero', () => expect(formatCents(0)).toBe('$0.00'));
});
```

and `web/src/lib/months.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { monthKey, monthRange, addMonths, monthLabel } from './months';

describe('month bucketing in the household timezone', () => {
  // 2026-07-01T03:00Z is still June 30, 11pm in New York.
  it('buckets by local month, not UTC', () =>
    expect(monthKey(new Date('2026-07-01T03:00:00Z'), 'America/New_York')).toBe('2026-06'));
  it('monthRange covers exactly the local month', () => {
    const r = monthRange('2026-06', 'America/New_York');
    expect(r.startISO).toBe('2026-06-01T04:00:00.000Z'); // EDT = UTC-4
    expect(r.endISO).toBe('2026-07-01T04:00:00.000Z');
  });
  it('addMonths wraps years', () => expect(addMonths('2026-12', 1)).toBe('2027-01'));
  it('monthLabel renders human form', () => expect(monthLabel('2026-06')).toBe('June 2026'));
});
```

- [ ] **Step 2: Run to verify FAIL** (`cd web && npx vitest run`), then implement `web/src/lib/money.ts`:

```ts
/** Strict 2-decimal parse — mirror of the Worker's centsFrom. Internal. */
function centsFrom(s: string): number | null {
  const parts = s.replace(/,/g, '').split('.');
  if (parts.length !== 2) return null;
  if (!/^\d+$/.test(parts[0]) || !/^\d{2}$/.test(parts[1])) return null;
  return parseInt(parts[0], 10) * 100 + parseInt(parts[1], 10);
}

/** Tolerant manual-entry path (port of Money.centsFromInput): accepts "$",
 *  commas, whitespace, and 0/1/2-decimal cents; null for anything ambiguous
 *  so the Save button stays disabled rather than guessing. */
export function centsFromInput(s: string): number | null {
  const cleaned = s.replace(/\$/g, '').replace(/,/g, '').trim();
  if (cleaned === '') return null;
  const parts = cleaned.split('.');
  let normalized: string;
  if (parts.length === 1) normalized = `${cleaned}.00`;
  else if (parts.length === 2) {
    if (parts[1].length === 0) normalized = `${parts[0]}.00`;
    else if (parts[1].length === 1) normalized = `${parts[0]}.${parts[1]}0`;
    else if (parts[1].length === 2) normalized = cleaned;
    else return null; // 3+ decimals: ambiguous, refuse to round
  } else return null;
  return centsFrom(normalized);
}

/** The only cents→display path. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${whole}.${String(abs % 100).padStart(2, '0')}`;
}
```

and `web/src/lib/months.ts`:

```ts
/** Month bucketing uses the household timezone, never UTC. */

function localParts(d: Date, tz: string): { y: number; m: number } {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month) };
}

export function monthKey(d: Date, tz: string): string {
  const { y, m } = localParts(d, tz);
  return `${y}-${String(m).padStart(2, '0')}`;
}

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

/** Local-midnight instant of y-m-d in tz (fixed-point via offset lookup). */
function localMidnightUTC(y: number, m: number, tz: string): Date {
  let guess = new Date(Date.UTC(y, m - 1, 1));
  guess = new Date(guess.getTime() - tzOffsetMs(guess, tz));
  // one correction pass handles DST-boundary edge cases
  guess = new Date(Date.UTC(y, m - 1, 1) - tzOffsetMs(guess, tz));
  return guess;
}

export function monthRange(key: string, tz: string): { startISO: string; endISO: string } {
  const [y, m] = key.split('-').map(Number);
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return {
    startISO: localMidnightUTC(y, m, tz).toISOString(),
    endISO: localMidnightUTC(next.y, next.m, tz).toISOString(),
  };
}

export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1]} ${y}`;
}
```

- [ ] **Step 3: Run tests**: `npx vitest run` → PASS.

- [ ] **Step 4: Budget page.** `MonthSwitcher` (◀ `monthLabel(key)` ▶, callbacks with `addMonths(key, ±1)`). `Budget.tsx`: fetch categories, budgets for the month (`month = key + '-01'`), and transaction sums:

```tsx
// Core query shape (inside a useEffect keyed on monthKey):
const { startISO, endISO } = monthRange(month, tz);
const [{ data: cats }, { data: buds }, { data: txns }] = await Promise.all([
  supabase.from('categories').select('id,name').eq('archived', false).order('name'),
  supabase.from('budgets').select('category_id,amount_cents').eq('month', `${month}-01`),
  supabase.from('transactions').select('category_id,amount_cents')
    .gte('occurred_at', startISO).lt('occurred_at', endISO),
]);
// spent per category = sum of amount_cents (refunds are negative, so they
// reduce spend automatically); uncategorized bucket for category_id = null.
```

Render one row per category: name, `formatCents(spent)` / `formatCents(budget)`, remaining, a Tailwind progress bar (`min(100, spent/budget*100)%`, red when over). Tapping a row opens an inline budget-amount editor (input → `centsFromInput` → upsert `budgets` on `(user_id, category_id, month)`). An "Uncategorized" pseudo-row shows unbudgeted spend.

- [ ] **Step 5: Verify** in `npm run dev`: seed a budget, insert a transaction row via the Supabase Table Editor, confirm spent/remaining/bar update; flip months with the switcher.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/ web/src/pages/Budget.tsx web/src/components/MonthSwitcher.tsx
git commit -m "feat: money/month helpers (tested) + Budget tab with per-category progress"
```

---

## Task 11: Transactions tab — list, manual add, category assign

**Files:**
- Create: `web/src/pages/Transactions.tsx`, `web/src/components/AddTransaction.tsx`

**Interfaces:**
- Consumes: `formatCents`, `centsFromInput`, `monthRange`, `MonthSwitcher`, `supabase`.
- Produces: manual transactions with `message_id = 'manual:' + crypto.randomUUID()` (satisfies the NOT NULL + unique constraint without colliding with email rows).

- [ ] **Step 1: List.** `Transactions.tsx`: month switcher (shared state pattern from Budget), query transactions in `monthRange` ordered `occurred_at desc`, join category names (`select('*, categories(name)')`). Each row: merchant, category chip, date, `formatCents(amount_cents)` (refunds render negative/green). Tapping the category chip opens a `<select>` of categories → `update transactions set category_id`.

- [ ] **Step 2: Manual add.** `AddTransaction.tsx` — modal/sheet with kind toggle (purchase/refund), amount (`inputMode="decimal"`, validated by `centsFromInput`, Save disabled while `null`), merchant, category, date (defaults today):

```ts
const cents = centsFromInput(amount)!;
await supabase.from('transactions').insert({
  user_id: session.user.id,
  amount_cents: kind === 'refund' ? -cents : cents,
  kind,
  merchant_raw: merchant.trim(),
  category_id: categoryId || null,
  occurred_at: new Date(`${date}T12:00:00`).toISOString(),
  message_id: `manual:${crypto.randomUUID()}`,
  line_idx: 0,
});
```

- [ ] **Step 3: Verify** in dev: add a purchase and a refund; confirm Budget tab totals move correctly (refund reduces spend); reassign a category and confirm both tabs agree.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Transactions.tsx web/src/components/AddTransaction.tsx
git commit -m "feat: Transactions tab — month list, manual add, category assign"
```

---

## Task 12: Settings tab — categories, forwarding setup, invite keys

**Files:**
- Create: `web/src/pages/Settings.tsx`, `web/src/components/ForwardingSetup.tsx`

**Interfaces:**
- Consumes: Worker `/provision` (Task 6) via `VITE_WORKER_URL`; `generate_invite_code` RPC (Task 1); `review_queue` (confirmation-link surfacing).
- Produces: `profiles.forward_address` set for the signed-in user.

- [ ] **Step 1: Categories section**: list with add (insert), rename (update), archive (set flag) — plain inline forms.

- [ ] **Step 2: Forwarding setup** (`ForwardingSetup.tsx`) — the known-fiddly flow, hand-held:
  1. If `profiles.forward_address` is null: a "Get my forwarding address" button →
     `fetch(`${import.meta.env.VITE_WORKER_URL}/provision`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } })` → show the address with a copy button.
  2. Numbered Gmail steps, each with copy buttons where applicable: (1) Gmail → Settings → Forwarding → "Add a forwarding address" → paste the address; (2) **watch for the confirmation**: the app polls `review_queue` (Google's confirmation email arrives from `forwarding-noreply@google.com` → unmatched sender → review row) every 10s while this screen is open and surfaces the confirmation **link** from the excerpt (`/https?:\/\/mail-settings\.google\.com\S+/` — extract and render as a tappable button); (3) create the Gmail **filter** (`from:(alerts@chase.com OR no.reply.alerts@chase.com OR fidelityrewards.com)` — copyable) with action "Forward to <address>"; (4) "Send a test charge": instructions to email yourself the TestBank format (subject `TestBank alert`, body `You made a purchase of $1.00 at TEST MERCHANT.` — both copyable), which the filter forwards; the screen polls `transactions` for a `TEST MERCHANT` row and shows ✅ when it lands.
- [ ] **Step 3: Invite keys (master only)**: if `profiles.is_master`, show "Generate invite key" → `supabase.rpc('generate_invite_code')` → display the 6-char code with a copy button. Non-masters don't see the section.
- [ ] **Step 4: Sign out button** (`supabase.auth.signOut()`).
- [ ] **Step 5: Verify** in dev: generate a key as master; provision an address (confirm the `profiles` row updates); walk the Gmail flow on the real account; confirm the TestBank ✅ lights up (this re-verifies Task 7 end-to-end through the UI).
- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Settings.tsx web/src/components/ForwardingSetup.tsx
git commit -m "feat: Settings — categories, hand-held Gmail forwarding setup with TestBank check, master invite keys"
```

---

## Task 13: PWA layer + deploy to the domain

**Files:**
- Modify: `web/vite.config.ts` (vite-plugin-pwa), `web/index.html` (Apple meta tags)
- Create: `web/public/apple-touch-icon.png`, icons 192/512 (generate a simple glyph — e.g. a dollar-sign tile — with ImageMagick or an SVG→PNG render; committed binaries)
- Create: `web/wrangler.toml`
- Modify: `Worker/wrangler.toml` (remove the D1 binding + drop the D1 database if Task 7 verified clean)

- [ ] **Step 1: `vite.config.ts`**:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Tally',
        short_name: 'Tally',
        display: 'standalone',
        theme_color: '#1d4ed8',
        background_color: '#ffffff',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
});
```

- [ ] **Step 2: Apple meta tags** in `web/index.html` `<head>` (Apple ignores parts of the manifest):

```html
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Tally" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

- [ ] **Step 3: `web/wrangler.toml`** (static assets, SPA fallback):

```toml
name = "tally-web"
compatibility_date = "2026-06-01"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"
```

Add a route/custom domain for Jacob's zone, e.g. `tally.expense-app.uk` (the apex may stay on Email Routing): `routes = [{ pattern = "tally.expense-app.uk", custom_domain = true }]`.

- [ ] **Step 4: Build + deploy**: `cd web && npm run build && npx wrangler deploy`. Verify the URL serves the app over HTTPS, manifest + service worker load (DevTools → Application), and login works in production (add the deployed origin to Supabase Auth → URL Configuration → allowed redirect/site URLs).

- [ ] **Step 5: Cleanup**: remove the D1 binding from `Worker/wrangler.toml`; `npx wrangler d1 delete expensekit-db` ONLY after Jacob confirms nothing else uses it (destructive — ask first).

- [ ] **Step 6: Commit**

```bash
git add web/ Worker/wrangler.toml
git commit -m "feat: PWA manifest + Apple meta tags + Cloudflare static deploy on tally.expense-app.uk"
```

---

## Task 14: On-phone verification + docs

**Files:**
- Modify: `CLAUDE.md` (Current state checklist + architecture note pointing at the PWA), `README.md`

- [ ] **Step 1: Jacob installs on iPhone**: Safari → `https://tally.expense-app.uk` → Share → Add to Home Screen. Confirm standalone launch (no browser bar).
- [ ] **Step 2: Full pipe on the phone**: send a TestBank email → charge appears in Transactions; set a budget → Budget bar moves. (Claude cannot see this — Jacob confirms with a screenshot.)
- [ ] **Step 3: Real-bank soak**: leave the Chase/Fidelity Gmail filter live; when the next real alert lands, verify the transaction row (or template-tune from the `review_queue` excerpt if a layout drifted).
- [ ] **Step 4: Update `CLAUDE.md`**: mark the PWA rehaul in *Current state*; note that `App/` + `Packages/` are frozen reference code; update Build/test commands (`cd Worker && npm test`, `cd web && npx vitest run && npm run build`).
- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: PWA rehaul landed — update current state, build/test commands"
```

---

## Self-Review Notes

- **Spec coverage**: multi-user+invites (T1, T9, T12), parse-in-Worker (T4–T6), Supabase (T1, T5), core-first screens (T10–T12), TestBank pseudo-bank (T4, T7, T12), new-bank-from-review (review rows carry sender/subject/excerpt: T6; UI deferred per spec), Gmail-confirmation surfacing (T12 step 2), PWA recipe + deploy (T13), money/dedup/refund invariants (T2, T4, T5, Global Constraints). Charts/trends/search are explicitly deferred by the spec — no tasks, correct.
- **Placeholders**: none — every code step has the code; operational steps have exact commands.
- **Type consistency**: `ParsedCharge`/`RawEmail` defined once (T4 `types.ts`), consumed by T5/T6 with matching shapes; `centsFrom` (Worker) vs `centsFromInput` (web) deliberately separate per Global Constraints.
