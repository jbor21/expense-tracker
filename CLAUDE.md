# CLAUDE.md

Project context for Claude Code. Keep tight and high-signal — loads every session.

## ⚠️ Current reality (read first — Sept 2026)

**The live product is the PWA**: `web/` (React/Vite) + `Worker/` (Cloudflare,
inbound-email parse → seal → Supabase) + `supabase/`. It is E2EE / operator-blind.
Deployed at <https://tally.expense-app.uk>. Work here.

- **Bank templates now live in `Worker/src/parsing/templates.ts`** (TypeScript),
  *not* the Swift `ChaseTemplate`. A friend's "emails aren't parsing" = a Worker
  template issue → fix + test there (`Worker/test/templates.test.ts`).
- **`legacy-ios/`** (was `App/` + `Packages/ExpenseKit/`) is the original native
  app — **dormant, not built, not deployed**, and *incomplete* on this machine
  (iCloud sync truncated it; see `legacy-ios/README.md`). Most of the prose below
  describes that iOS design and is retained for background only.
- Git history was reset Sept 2026 (iCloud corrupted the old `.git`). Keep this
  repo out of any synced folder. CI/deploy: `.github/workflows/`, see `README.md`.

---

## What this is

A private, **local-first iOS** expense tracker. On app open, it reads the user's
bank transaction-alert **emails**, extracts each charge with a small **per-sender
template (deterministic regex, no LLM in v1)**, categorizes it, and tallies it
against monthly per-category budgets. **No backend, no AI model, no API key** in
the core path — everything runs on the phone; data syncs across the user's own
devices via CloudKit. Read-only on the money side. Full spec: `docs/SPEC.md`.

Each friend runs their own independent copy; different users share no data.

## Architecture (on-device, layered)

Protocols, so the email source and parser are swappable without touching the rest:

- **`EmailSource`** — connects to one inbox (OAuth, tokens in Keychain), returns
  new messages since a stored cursor. Impls: `GmailSource`, `GraphSource`.
- **`TransactionParser`** — one email → zero-or-more `ParsedCharge`. v1 impl:
  **`TemplateParser`** (per-sender regex via `BankTemplate` + `TemplateRouter`).
  The protocol leaves room for an optional `OnDeviceParser` (Apple Foundation
  Models) for un-templated senders — **not in v1**.
- **`Categorizer`** — category from (1) learned merchant memory, (2) keyword rules,
  else (3) Uncategorized. Separate concern from extraction.
- **`Store`** — SwiftData persistence + budget math.

No LLM in v1, and no server beyond `Worker/` — a dumb store-and-forward
inbound-email relay (decided 2026-07-03; replaces Gmail OAuth, see *Current
state*). Parsing, money math, dedup, and all finance logic stay on the phone —
never move them server-side. An on-device model or a Claude
fallback are optional, deferred paths behind `TransactionParser`; the on-device
path needs no account, and Claude would require API-key auth via the Console
(never bundle a key, never route against a user's subscription).

## Repo structure (Swift-package core + thin app)

```
repo/
├─ Packages/
│  └─ ExpenseKit/                Swift package — the testable core
│     ├─ Package.swift
│     ├─ Sources/
│     │  ├─ Core/                ParsedCharge, Money, shared types
│     │  ├─ Parsing/             BankTemplate, templates, TemplateRouter, Categorizer
│     │  ├─ Store/               SwiftData models + budget math
│     │  └─ Email/               EmailSource + Gmail/Graph impls
│     └─ Tests/                  ParsingTests (vs real sample emails), StoreTests, EmailTests
├─ App/
│  └─ ExpenseTracker/            thin SwiftUI app (Xcode), depends on ExpenseKit
│     ├─ ExpenseTracker.xcodeproj   (use filesystem-synchronized folders)
│     └─ Sources/                App entry + Views/
├─ Worker/                       Cloudflare Worker — inbound-email relay (store-and-forward)
├─ docs/SPEC.md
├─ CLAUDE.md
└─ README.md
```

All correctness-critical code lives in `ExpenseKit` and is testable **without a
simulator**. The app target is presentation only. New files go in a package
`Sources/` folder (auto-included) or the app's synchronized folder — avoid hand-
editing `project.pbxproj`.

## Build, test & verify

```bash
# Core logic — fast, headless, where you work autonomously:
swift test  --package-path Packages/ExpenseKit
swift build --package-path Packages/ExpenseKit

# Full app (UI) — needs a simulator; pipe through xcbeautify if available:
xcodebuild -project App/ExpenseTracker/ExpenseTracker.xcodeproj \
  -scheme ExpenseTracker \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build
```

**Toolchain:** `swift test` needs the **Xcode** toolchain selected (`xcode-select -p`
must point at `…/Xcode.app/…`, not bare Command-Line-Tools) — SwiftData's `@Model`
macro plugin and the test runner both ship with Xcode. Tests use **Swift Testing**
(`import Testing`); the `Parsing` target enables the `BareSlashRegexLiterals`
upcoming feature for the regex literals in templates.

**You cannot see the running app.** Verify all logic via `swift test` on
`ExpenseKit`. Never claim a UI change works — describe it and let the user confirm
from a screenshot or Xcode Preview. Anything correctness-critical must have a test.

## Non-negotiable invariants

- **Money is integer cents** (`amountCents: Int`). Never `Double`/floats for money.
  Format to currency only in the view layer. `Money.cents(from:)` is the only
  string→cents path.
- **Extraction is deterministic and validated.** A template pulls the amount from
  the email text, so it's present by construction; if a template returns nothing
  or the amount can't be parsed, **flag the email for review** — never guess,
  never drop silently.
- **Ingestion is idempotent and incremental.** Runs on *every* app open: (1) fetch
  only messages after the stored **cursor**; (2) dedup on `(sourceMessageId,
  sourceLineIdx)` and skip existing rows. Repeated opens must never double-count.
  Two identical legit charges = two emails = two rows; do **not** merge them.
- **No API key, no AI service in v1.** If a Claude fallback is ever added, it uses
  the **user's own key** from the Keychain. The on-device fallback uses no
  key/account.
- **Only `purchase` and `refund` are stored.** Refunds are **negative**
  `amountCents`. Drop balance / statement / payment notices.
- **Month bucketing uses the household timezone**, not UTC.
- **Financial data stays on-device / in the user's own iCloud.** Store only a
  trimmed `rawExcerpt`, never full bodies; no telemetry of transaction contents.

## Parser shape

`ParsedCharge` (in `Core`) is the single output shape for any parser:
`kind (.purchase/.refund)`, `merchantRaw`, `amountCents` (signed), `currency`,
`occurredAt?`, `accountLast4?`. A `BankTemplate` declares its `senders` and
`parse(_:) -> [ParsedCharge]` (returns `[]` if it can't parse). `TemplateRouter`
picks the template for the sender and returns `nil` when none match → flag for
review. Categorization is **not** the parser's job — `Categorizer` runs after, on
`merchantRaw`. Any future LLM parser must return the same shape and validate the
amount appears in the source before it's trusted.

## Data model (quick ref — full in SPEC §6)

SwiftData `@Model`s: `Household`, `EmailAccount` (holds `cursor`, `alertSenders`;
tokens in Keychain), `Account` (card), `Category`, `Budget` (one per category per
month, `period` = first of month), `Transaction` (key fields: `amountCents`,
`kind`, `sourceMessageId`, `sourceLineIdx`, `category` nilable → "Uncategorized").
Plus a persisted **merchant memory** map `normalizedMerchant → categoryName`.

## Storage & sync

SwiftData local + CloudKit **private database** for same-Apple-ID multi-device
sync and backup (v1). Cross-account spouse sharing via **CKShare is v2** — don't
build it into v1.

## Tooling & plugins (keep it minimal)

- **Context7** (MCP) — pull current docs for SwiftData, CloudKit, the Foundation
  Models framework, and the Gmail API before relying on memory; training data on
  these is stale.
- **swiftformat / swiftlint** via a post-edit hook — keeps style automatic.
- **Built-in `/code-review`** — run on the parsing / money / dedup / budget paths.
  Ships with Claude Code; no plugin to install.
- Don't install web/backend marketplace plugins — they add always-on token cost to
  every session for nothing on an iOS app.

## Workflow

- **Plan mode per phase** (spec Phase 0 → 1 → 2): approve the plan, execute, then
  tick the box in *Current state* below.
- **TDD the core**: for `Money.cents`, each `BankTemplate`, dedup, and budget
  rollups, write tests first against 3–4 real sample emails per bank, then
  `swift test`.
- **`/new-bank` skill** (`.claude/skills/new-bank/SKILL.md`): paste a real alert
  email → scaffolds a `BankTemplate` + test (from the email as fixture), registers
  the sender, and wires it into `TemplateRouter`, following the Chase pattern.
- **UI is the manual part**: build, screenshot, eyeball — Claude can't see it.

## Conventions

- **SwiftUI**, async/await, no force-unwraps outside tests.
- Treat email bodies as **untrusted** — validate at the parser boundary. Keep
  template `parse`, categorization, and budget math as pure, testable funcs.
- Money as integer cents end-to-end; one `Money` formatter at the edge.
- New bank = a new `BankTemplate` + sample-email tests, nothing elsewhere.
- Commits: present tense (`feat: …`, `fix: …`, `chore: …`).

## Current state

- [x] Phase 0: `ExpenseKit` package + SwiftData model + budget math (tested) +
      thin app with budget setup / categories / manual add / spent-remaining view
  - [x] **Core** (`Money.cents` + `Money.centsFromInput`, `ParsedCharge`,
        `RawEmail`), **Parsing** (`ChaseTemplate`, `TemplateRouter`,
        `DefaultCategorizer`), **Store** (7 `@Model`s + `MerchantMemory` +
        `Budgeting` spent/remaining + `monthStart`/`previousMonth`/`nextMonth`)
        — **43 tests green via `swift test`**.
  - [x] Thin SwiftUI app (`App/ExpenseTracker/`, filesystem-synchronized
        `Sources/`, depends on the ExpenseKit package): `TabView` (Budget /
        Transactions / Settings) — category seed/add/rename/archive, per-month
        budget setup w/ last-month carry-forward, manual add (purchase/refund),
        per-category spent/remaining + progress bars, month switcher. Builds &
        runs in the iOS Simulator — all five screens verified from screenshots.
- [x] Phase 1: template ingestion (Gmail source + TemplateParser + Categorizer +
      cursor/dedup + fetch-on-open + review queue) — **verified end-to-end on the
      simulator**: Gmail sign-in → fetch → parse → store → tally.
  - [x] **ExpenseKit `Email` target** (headless, 24 new tests; 75 total green):
        `EmailSource`/`EmailBatch`, `HTTPClient` seam + `TokenProvider`,
        `GmailSource` (historyId cursor: backfill→seed, history.list incremental,
        404→re-backfill, base64url/HTML body decode), pure `IngestionPipeline`
        (dedup on `(messageId,lineIdx)`, idempotent, refund-negative, flag-on-fail)
        + `ChargeParser` (TemplateRouter conforms). `FlaggedEmail` `@Model` in Store.
  - [x] **App glue** (typecheck/parse-only here — full build is Xcode-side):
        `GmailAuth` (GoogleSignIn wrapper, tokens in Keychain via SDK),
        `IngestionService` (@MainActor, runs pipeline → SwiftData on open), Review
        tab, Settings "Email Import" + `ConnectEmailView` (sender presets).
  - [x] **Xcode-side (wired & verified):** GoogleSignIn SPM package + URL scheme +
        `GIDClientID` (in `ExpenseTracker-Info.plist`); sign-in restores on every
        launch (ingestion awaits the memoized restore before reading auth), and a
        Settings → "Reset Ingestion" affordance re-ingests from scratch.
        `ChaseTemplate` pulls the amount from the labeled `Amount:` line (ignoring
        the `$0.00` alert-threshold decoy in the subject) and the merchant from the
        subject (stripping the `transaction with `/` exceeded $X.XX` framing).
        `ChaseTemplate` (both alert layouts) and `FidelityTemplate` exist — other
        banks route to Review until templated (scaffold one with the `/new-bank`
        skill). Templates parse only their anchored amount line (Chase `Amount:`,
        Fidelity `charged $X at`; no bare-$ fallback), so payment/statement
        notices land in Review instead of becoming phantom purchases.
- [ ] Phase 2: polish & robustness (app target only; ExpenseKit untouched, 81 tests
      green; whole app tree verified headlessly via `swiftc -typecheck`).
      The *optional on-device parser fallback* is the one Phase 2 item still deferred.
  - [x] **Background App Refresh**: `BGAppRefreshTask` (id
        `com.expensetracker.ExpenseTracker.refresh`) via the SwiftUI
        `.backgroundTask(.appRefresh:)` scene modifier; scheduled when the scene
        enters `.background` and re-chained after each run. Info.plist gains
        `BGTaskSchedulerPermittedIdentifiers` + `UIBackgroundModes`=`fetch`. Reuses
        `IngestionService` on a fresh `ModelContext`; fetch-on-open stays primary.
        (Xcode: confirm the "Background Modes → Background fetch" capability shows.)
  - [x] **Account auto-naming**: `IngestionService.apply()` find-or-creates an
        `Account` per parsed `accountLast4` (reused across a batch + re-runs);
        unnamed cards render "Card ••1234"; rename in Settings → Accounts
        (`AccountsView`, inline nickname field). No Store change — `Account`
        already existed and `PreparedTransaction.accountLast4` already flowed through.
  - [x] **Charts**: `SpendingChartView` (Swift Charts) — horizontal category-spend
        bars for the viewed month, opened from a chart toolbar button in Budget.
  - [x] **Spending trend**: `SpendingTrend` + a trend chip on `BudgetRow` (this vs
        last month; spending up=red ▲, down=green ▼, "New" for first-time spend).
  - [x] **Search/filter**: `.searchable` (merchant) + `TransactionFilterView`
        (category + absolute amount range) in the Transactions tab.
- [ ] Email-forwarding ingestion (decided 2026-07-03; replaces Gmail OAuth — no
      OAuth test-user management, no weekly re-auth, no restricted-scope
      verification): each user sets a Gmail filter auto-forwarding bank alerts to
      a per-user address on one shared Cloudflare Worker; the app polls it. Start
      fresh — no backfill; remove the OAuth path once the Swift side lands.
  - [x] **Worker** (`Worker/`, deploy + hand-test in `Worker/README.md`):
        Email Routing catch-all → D1 store-and-forward. `POST /provision` (gated
        by `PROVISION_KEY` secret) → per-user address+secret (secret stored
        hashed), `GET /messages?since=<cursor>` (bearer) → batch + cursor,
        `POST /ack {upTo}` → delete. Dedup on original `Message-ID`; 30-day cron
        purge backstop. Original From/Subject preserved by Gmail filter-forward
        → `TemplateRouter` matches unchanged. HTTP surface verified end-to-end
        via `wrangler dev --local` (provision/auth/fetch/cursor/ack/dedup); the
        `email()` handler + Email Routing wiring get verified at first deploy.
  - [x] **`ForwardedInboxSource`** (ExpenseKit `Email`, 12 tests; 93 total green):
        `EmailSource` over the Worker API via the `HTTPClient`/`TokenProvider`
        seams. `messageId` = original `Message-ID` (falls back to Worker row id);
        `alertSenders` deliberately ignored (Gmail filter already selected; Google's
        forwarding-confirmation email must reach Review). `acknowledge(upTo:)`
        deletes delivered rows — call it only *after* `context.save()` succeeds.
  - [x] **`IngestionService` integration** (typecheck-verified): `run()` branches
        on `EmailAccount.provider` — `"forward"` builds `ForwardedInboxSource`
        (secret from `InboxSecretStore`, Keychain `AfterFirstUnlock` so background
        refresh works) and acks strictly *after* `context.save()` succeeds
        (`apply` now returns saved-or-not); gmail path unchanged as fallback.
        Worker URL constant + Keychain store live in `Email/ForwardedInbox.swift`.
        A `"forward"` account is preferred over `"gmail"` when both are active.
  - [x] **Onboarding** (ExpenseKit +8 tests, 101 green; app typecheck-clean):
        `InboxProvisioner` (POST /provision; the invite key = the operator's
        `PROVISION_KEY`, typed by the user, never bundled/persisted) +
        `GmailForwarding.confirmationCode(in:)` / `.filterQuery(senders:)` in
        `Email/Onboarding.swift`. App: `ForwardedSetupView` (invite key →
        provision → Keychain + `EmailAccount(provider:"forward")`; numbered
        Gmail steps with copy buttons; confirmation code auto-surfaced by
        polling the relay read-only *and* scanning `FlaggedEmail` — covers the
        race where ingestion already acked the relay copy). Settings gains the
        forwarding entry (OAuth demoted to "Legacy"); `ConnectEmailView` prefers
        the forward account + Fidelity preset.
  - [x] **OAuth removal** (GmailAuth, GoogleSignIn SPM dep + URL scheme +
        `GIDClientID`, legacy Settings section, SETUP_GMAIL.md) + SPEC §3/§10
        amendment — after forwarding is verified on-device.
- [x] **Budget carry-forward** (spec `docs/superpowers/specs/2026-07-12-…`):
      `Budgeting.effectiveBudget` resolves a month's budget on read (explicit row
      → latest earlier month → none; 6 tests, 102 green). BudgetView shows
      "Carried from <Month>"; BudgetSetupView pre-fills from it, saves only the
      viewed month.
  - [x] **PWA port (2026-08-04)** — the iOS-only version left the live web app
        without carry-forward (a July budget read as 0 in August; user-reported).
        `web/src/lib/budgets.ts` `effectiveBudgets()` (8 tests) + Budget.tsx now
        queries `.lte('month', …)` and resolves the winner client-side, showing
        "Carried from <Month>". Client-only — no migration, no Worker change.
- [x] **Merchant memory visibility** (spec `docs/superpowers/specs/2026-07-10-…`):
      "Remember for future charges" toggle + auto-categorized footnote in
      TransactionDetailView; `MerchantMemoryMaintenance.propagateRename` keeps
      memory rows matching after a category rename (CategoriesView calls it);
      Settings → Learned Merchants page (change/forget learned rows).
      (UI verified by user on-device pending.)
- [ ] **E2EE (operator-blind storage)** (decided 2026-07-14; answers "can you
      see my data?" with a provable no): per-user X25519 keypair derived from a
      12-word BIP39 phrase (128-bit entropy → SHA-256 → private key; entropy hex
      in `localStorage`, public key in `profiles.public_key`). Sealed box =
      ephemeral ECDH → HKDF-SHA256 → AES-256-GCM, single canonical impl in
      `Worker/src/crypto.ts` (PWA imports it relatively; `@noble/curves`+
      `@scure/bip39`). Sensitive fields (merchant, amount, last4, kind; review
      sender/subject/excerpt) live in a `payload_enc` blob; `occurred_at`,
      `message_id`/`line_idx` (dedup), `category_id` stay plaintext for queries
      — timestamps + category names remain operator-visible, amounts/merchants
      don't. Plaintext email transit through the Worker (~ms, never stored) is
      the accepted residual exposure.
  - [x] **Worker seals before insert** (`supabaseWriter.ts`; 52 tests green):
        profile lookup returns `public_key`; when present, rows carry only
        `payload_enc` (tests assert no plaintext leaves the Worker and the
        user's key opens the blob); when null (user pre-E2EE), plaintext
        fallback until their next login migrates history client-side.
        Migration `supabase/migrations/0005_e2ee.sql` (public_key +
        payload_enc columns, legacy columns nullable) — apply in Supabase.
  - [x] **DEPLOY (shipped 2026-07-16)**: migration `0005_e2ee.sql` applied via
        Supabase MCP (`apply_migration`, project `zeftuqnzstcffouuqcxi`); Worker
        + web deployed via `npx wrangler deploy` (live bundle byte-identical to
        local `dist/`). Existing 4 users have `public_key` null → Worker writes
        plaintext for them until their first post-E2EE login encrypts history.
  - [x] **Budgets encrypted too (shipped 2026-07-16)**: `budgets.amount_cents` →
        sealed `{amountCents}` in `budgets.payload_enc` (migration
        `0006_e2ee_budgets.sql`, applied). Client-only path — Worker untouched.
        `KeyGate` now runs an idempotent `migrateHistory()` sweep on every app
        load, so plaintext rows that pre-date a column gaining E2EE (or a
        failed migration) get encrypted on next open. `docs/PRIVACY.md` is the
        sendable explainer (plain-English + technical appendix).
  - [ ] **Live check (user-driven)**: log in → phrase screen + history
        encrypts → forward a test charge → row renders in app AND shows only
        `payload_enc` ciphertext in the Supabase table editor; test recovery
        (clear site data → re-enter 12 words). Then nudge each friend to open
        the app.
  - [x] **PWA side** (web tsc/vitest/oxlint/build all green; 24 web + 52 Worker
        tests; on-device E2E + Supabase-dashboard-shows-ciphertext check still
        user-verified): keys.ts lifecycle,
        recovery-phrase screen at signup ("screenshot these 12 words", no quiz),
        unlock-with-phrase on new devices, decrypt-at-fetch boundary
        (Transactions/Budget/AddTransaction/ForwardingSetup), one-time
        client-side history encryption, Settings "Privacy & recovery" card.
- [ ] Phase 3: CKShare household sharing + budget assistant

_Update this checklist as things land._

## Notes for Claude Code

- Read `docs/SPEC.md` before larger changes — the "why" lives there.
- Preserve the `EmailSource` / `TransactionParser` seams so the source or parser
  can be swapped later (on-device model, different provider) with no other changes.
- Money math, budget rollups, cursor handling, dedup, and template regexes are the
  correctness-critical paths — add/extend tests against real sample emails whenever
  you touch them.
