# Expense Tracker — Product & Technical Spec

> Status: draft v0.3 (template-first parsing) · Owner: Jacob
> Scope: a handful of friends, **each running their own private copy**. iOS-only,
> on-device, **no backend, no LLM required**.

---

## 1. Summary

A native iOS app that **automatically tracks credit-card spending by reading bank
transaction-alert emails**, extracting each charge with a small **per-sender
parser**, and tallying it against a **monthly per-category budget**. It replaces a
manual Excel workflow.

There is **no server and no LLM in the core path**. Each person installs their own
copy; the app reads their email, parses locally, and stores everything on the
phone (synced across their own devices via CloudKit). Different friends share no
data — each install is its own island. The only manual inputs are setting budgets
and the occasional category fix. The money side is strictly read-only — the app
never touches a bank or moves funds.

---

## 2. Goals & non-goals

**Goals**
- Capture card transactions automatically — no manual entry for the common case.
- Monthly budget per category with a live **spent / remaining** view.
- A complete, filterable transaction log (by month, by category).
- Runs entirely on one phone. **No backend, and no AI model or API key required.**
- Free to run.
- Installable by a few friends, each independent and private.

**Non-goals (for now)**
- Any always-on server, shared database, or multi-tenant backend.
- Any reliance on an AI model or API key in the core pipeline (both are optional,
  deferred fallbacks — see §5).
- Real-time "the instant you swipe" push (see §4 — catch-up model instead).
- Plaid / direct bank linking, investments, net worth, bill pay, splitting.
- Android or web.

---

## 3. Architecture — local-first, no backend

Everything lives inside the iOS app, organized in clean layers so the email
source and the parser can each be swapped without touching the rest.

```
On app open (and opportunistically via Background App Refresh):

  iOS app (SwiftUI) — runs entirely on device, no server
  │
  ├─ 1. EmailSource
  │      Private Cloudflare Worker (store-and-forward relay)
  │      App fetches new messages since cursor, then acks to delete them
  │
  ├─ 2. Parser  (deterministic — no LLM in v1)
  │      per-sender template (regex): exact amount / last4 / date
  │      validate: extracted amount must appear in the email text
  │      Categorizer: learned memory → keyword rules → Uncategorized
  │      └─ unknown sender → flag it  (optional later: on-device model)
  │
  ├─ 3. Dedup  (idempotent on message id + line index)
  │
  ├─ 4. Store → SwiftData  (money as integer cents)
  │
  └─ Sync: SwiftData ──CloudKit──► your own devices + iCloud backup
           (spouse sharing via CKShare = v2)
```

**Layers (protocols, so each is replaceable):**
- `EmailSource` — connects to the inbox relay and returns new messages since a cursor.
  Implementations: `ForwardedInboxSource`.
- `TransactionParser` — turns one email into zero-or-more structured charges.
  v1 implementation: **`TemplateParser`** (deterministic per-sender regex). The
  protocol leaves room for an optional `OnDeviceParser` (Apple Foundation Models)
  as a fallback for senders you haven't templated — added only if you want broad
  bank coverage. **No LLM ships in v1.**
- `Categorizer` — assigns a category from (1) a learned merchant memory, (2) a
  keyword rules table, else (3) Uncategorized. Deliberately separate from
  extraction (different problem, different best tool).
- `Store` — SwiftData persistence + budget math.

No server and no LLM exist in v1. Both an on-device model and a Claude fallback
are *optional, deferred* paths behind the `TransactionParser` protocol — neither
is required for the app to work, and the on-device path needs no account at all.

### Project structure (built for Claude Code)

Put the **core logic in a Swift package and keep the SwiftUI app thin** — this is
what makes the project pleasant to build with Claude Code, which runs tests in the
terminal but **can't see the running app** and finds editing `.xcodeproj` files
error-prone:

- `Packages/ExpenseKit/` — `Parsing`, `Store`, `Email` targets + tests. All the
  correctness-critical code (money, templates, dedup, budget math) lives here and
  is testable headlessly on the Mac with `swift test` — no simulator, no Xcode
  project churn.
- `App/ExpenseTracker/` — a thin SwiftUI app depending on `ExpenseKit`. Use
  Xcode's filesystem-synchronized folders (or XcodeGen) so adding a file needs no
  `project.pbxproj` surgery. This is the only part that needs a simulator, and the
  part you verify by eye since Claude can't see it.

Full repo layout, build commands, and tooling live in `CLAUDE.md`.

---

## 4. How ingestion runs (the timing model)

iOS apps don't run 24/7, so ingestion is **catch-up, not real-time**:

- **Primary trigger — app open (foreground).** Every launch, the app runs the
  pipeline: fetch new alert emails since the cursor → parse → store. Takes ~a
  second, so the app is current the moment you're looking at it.
- **Bonus trigger — Background App Refresh** (`BGAppRefreshTask`). iOS
  *opportunistically* wakes the app (timing not guaranteed), so it's often
  already fresh on open. Treated as a nice-to-have, never relied on.

**What you give up:** no push the instant a charge happens (that would require a
server watching the inbox). For "can I afford this right now," catch-up is enough.

**Cursor + idempotency (core correctness).** Because the pipeline runs on *every*
open, it must not re-count charges it already saw:
- Keep a per-inbox **cursor** — Gmail `historyId` (or last processed timestamp);
  Graph delta token — and fetch only messages after it.
- Dedup as a backstop on the email's **message id** (+ a line index for emails
  containing multiple charges). Inserts are no-ops if the id already exists.

Both together mean: open the app 50 times a day, the same charge is stored once.

---

## 5. Parsing — deterministic per-sender templates

Parsing is really two different jobs, and v1 does both **without an LLM**.

**1. Extraction (exact, deterministic).** Pull the amount, last-4, date, and raw
merchant descriptor out of the email. Because your friends use a *known, finite*
set of banks, each bank's alert email has a fixed format — so a tiny per-sender
template (regex) extracts these fields exactly. For the amount, the one field you
cannot afford to get wrong, deterministic parsing is more reliable than any small
model. As a guard, **validate** that the extracted amount string actually appears
in the email; if a template fails or the amount doesn't validate, the app **flags
the email for review** rather than guessing or failing silently. See
`Parsing.swift` — a whole bank is ~30 lines.

**2. Categorization (a separate problem).** Deciding a Trader Joe's charge is
"Groceries" is interpretation, handled by the `Categorizer` in three cheap steps:
- **Learned memory** — a persisted `normalizedMerchant → category` map. The first
  time a merchant appears, you (or a rule) set its category; every future charge
  from that merchant is auto-categorized with zero inference. Most spending is
  repeat merchants, so this covers the bulk immediately.
- **Keyword rules** — a small table ("UBER" → Transportation, "NETFLIX" →
  Subscriptions) for a sensible first guess on never-seen merchants.
- **Uncategorized** — anything left lands in a one-tap review queue; your pick is
  written back into the learned memory so it's automatic next time.

**Why no LLM — and what each option would actually cost:**
- *Deterministic templates* (v1): no model, no API key, no account, no backend.
- *On-device Apple model* (optional, later): a genuine fallback for senders you
  haven't templated, for messy merchant-name cleanup, or for guessing categories
  on brand-new merchants. Runs locally — **no API key, no account, no backend** —
  gated only by device hardware (Apple-Intelligence-capable iPhones). Slots in
  behind `TransactionParser` without touching anything else.
- *Claude API* (optional, probably never): highest-quality cleanup, but per
  Anthropic's terms a third-party app must use **API-key auth via the Console** —
  there is no "sign in with your Claude subscription" for this, and routing app
  traffic against users' subscriptions is disallowed. That means each friend's own
  key, or a proxy you host. Skip unless you specifically want it.

**Identifying alert emails.** The user adds their bank's alert sender address(es)
in Settings (presets for common issuers — Chase, Amex, Citi, Capital One, BofA,
…). `EmailSource` queries only those senders; the matching template extracts. Only
`purchase` and `refund` are stored (`refund` as a **negative** amount);
balance / statement / payment notices are ignored.

**The trade-off to accept.** A template breaks if a bank changes its email format.
For a handful of banks that's rare, the app flags it when it happens, and the fix
is editing a few regex lines in that one template.

---

## 6. Data model (SwiftData)

Money is **integer cents** (`amountCents: Int`) everywhere. No floats/`Double` for
money — currency formatting happens only at the display edge.

```swift
@Model class Household {            // a couple's shared scope; one per install in v1
  var id: UUID
  var name: String
  var timezone: String             // for month bucketing, e.g. "America/New_York"
  // relationships: accounts, categories, budgets, transactions
}

@Model class EmailAccount {         // a connected inbox the app polls
  var provider: String             // "forward"
  var address: String
  var alertSenders: [String]       // (deprecated for forwarding)
  var cursor: String?              // cursor for the worker API
  var active: Bool
  // Inbox secrets live in the Keychain — not stored here
}

@Model class Account {              // a card / funding source
  var nickname: String             // "Amex Gold"
  var last4: String?
  var currency: String             // "USD"
}

@Model class Category {
  var name: String                 // "Groceries", "Dining Out", ...
  var isDefault: Bool
  var archived: Bool
}

@Model class Budget {               // one per category per month
  var period: Date                 // first day of the month
  var amountCents: Int
  // unique per (category, period)
}

@Model class Transaction {
  var merchant: String?
  var amountCents: Int             // positive = spend, negative = refund
  var currency: String
  var occurredAt: Date             // from email; falls back to received time
  var kind: String                 // "purchase" | "refund"
  var status: String               // "pending" | "posted" (best-effort)
  var sourceMessageId: String      // idempotency key
  var sourceLineIdx: Int           // for multi-charge emails
  var category: Category?          // nil → "Uncategorized"
  var account: Account?
  var rawExcerpt: String           // trimmed source text, for audit/debug
  // unique per (sourceMessageId, sourceLineIdx)
}
```

**Merchant memory** (for the `Categorizer`) is a small persisted map
`normalizedMerchant → categoryName` — its own lightweight `@Model` or a keyed
store. Updated every time the user categorizes an Uncategorized charge.

**Default category seed:** Groceries, Dining Out, Rent/Mortgage, Utilities,
Transportation/Gas, Insurance, Health, Subscriptions, Shopping, Entertainment,
Travel, Misc. User can add, rename, or archive any.

**Budget math** (per category + month):
```
spent     = sum(amountCents) of txns in that category whose occurredAt
            (in the household timezone) falls in `period`'s month
remaining = budget.amountCents − spent          // refunds are negative → reduce spent
```

---

## 7. Storage & sync

- **Local: SwiftData.** Single source of truth on the device.
- **Same-account sync + backup: CloudKit (private database).** SwiftData's
  CloudKit integration mirrors your data to your own other devices (iPhone/iPad)
  and gives free backup/restore across device upgrades. Essentially free, no ops.
- **Spouse sharing (two people, different Apple IDs): CKShare — v2.** This is
  the one piece with real implementation nuance (shared CloudKit zones).
  **v1 recommendation: single device per person** (with private-DB backup), and
  add cross-account household sharing in v2. Keeps the first version trivial.

---

## 8. Features — MVP

1. **Connect email** — Setup auto-forwarding to a dedicated inbox.
2. **Budget setup** — set an amount per category for the month; carry forward last
   month as defaults.
3. **Category management** — add / rename / archive, starting from the seed list.
4. **Transaction feed** — reverse-chronological: date, merchant, amount, category,
   account. Tap to recategorize or edit (recategorizing teaches the merchant memory).
5. **Per-category view** — budget, spent, remaining, progress bar. The core
   "am I on track this month" screen.
6. **Month switcher** — browse months; past months are read-only.
7. **Manual add** — "+" to enter a charge by hand (cash, or a bank with no alerts).
8. **Review queue** — Uncategorized charges (and any flagged/unparsed emails) in
   one place, so fixing them is one tap.

---

## 9. Reliability & edge cases

- **Re-open dedup:** cursor + message-id idempotency (§4) — the central guarantee.
- **Multi-charge emails:** handled via `sourceLineIdx`.
- **Pending vs posted:** count the first alert per charge; ignore "posted"
  confirmation / balance / statement emails, so a charge isn't double-counted.
- **Refunds:** negative amounts, reduce spent.
- **Template fails / amount doesn't validate:** email is flagged to the review
  queue rather than dropped — your cue that a bank changed its format.
- **Bank with no email alerts:** manual add (or, later, the optional on-device
  parser for un-templated senders).
- **Missed window / app not opened for a while:** next open fetches everything
  since the cursor; nothing is lost as long as the alert emails exist.

---

## 10. Security & privacy

- **All financial data stays on the device** (and the user's own private iCloud).
  Nothing transits a server you run, because there isn't one — and in v1 nothing
  is sent to any AI service either.
- **Forwarding architecture**: Bank alerts auto-forward to a shared Worker which stores them only until the app pulls them. Delivered emails are deleted instantly; there's also a 30-day cron backstop to ensure zero retained mail.
- **Relay secret in Keychain**: The app reads from the relay via an inbox secret, preventing unauthorized access. No OAuth is used.
- **No API key is bundled.** v1 needs none. If the optional Claude fallback is ever
  enabled, it uses the user's own key from the Keychain.
- **CloudKit private database** is per-Apple-ID and encrypted by Apple; only the
  user (and, in v2, an explicitly invited spouse) can access it.
- Store only a **trimmed excerpt** of each email for debugging, not full bodies.

> **Amendment (2026-07-14, PWA era) — end-to-end encryption.** The product now
> runs as a PWA with Supabase storage, so “nothing transits a server” no longer
> holds; instead the design goal is **operator-blind storage**: each user's
> device derives an X25519 keypair from a 12-word BIP39 recovery phrase (the
> only key-management moment: save the words once). The Worker seals merchant,
> amount, card-last4, and kind (and review sender/subject/excerpt) to the
> user's public key before insert (`Worker/src/crypto.ts`; sealed box =
> ephemeral ECDH → HKDF-SHA256 → AES-256-GCM); the PWA decrypts on-device and
> encrypts legacy plaintext history on the user's first post-E2EE login.
> Operator-visible metadata (accepted trade-off): timestamps, category
> assignments/names, row counts. Residual exposure: the email itself passes
> through the Worker in plaintext for milliseconds and is never stored. Losing
> the phrase and all devices means the data is unrecoverable — by design.

---

## 11. Distribution (decide later — doesn't block building)

Each friend installs their own copy. Two paths:
- **TestFlight** — lowest friction for friends (install Apple's TestFlight app,
  tap your link). Requires Apple Developer Program ($99/yr), which also smooths
  CloudKit and push; builds re-upload every 90 days. Up to 10k external testers.
- **Sideloading (AltStore / SideStore)** — $0, no Developer Program, but each
  friend sets up the sideload tool and apps re-sign weekly; that overhead
  multiplies across people.

Recommendation for "a few friends": **TestFlight** if you'll spend the $99/yr.

---

## 12. Roadmap

- **Phase 0 — Core loop, manual data.** SwiftData model + budget setup + category
  management + manual add + per-category spent/remaining view. Works end-to-end
  before any email is touched.
- **Phase 1 — Template ingestion (no LLM).** EmailSource (Gmail first) +
  `TemplateParser` for your banks + `Categorizer` (memory + rules) + cursor/dedup +
  fetch-on-open + review queue. Transactions start flowing automatically.
- **Phase 2 — Coverage & polish.** *Optional* on-device parser as a fallback for
  un-templated senders / merchant cleanup; Background App Refresh; account
  auto-naming; charts; UX pass.
- **Phase 3 — Household sharing & assistant.** CKShare spouse sync; a budget
  assistant that proposes category budgets from income/household/typical spend
  (your friend's onboarding idea).

---

## 13. Open decisions

1. **Email provider per person** — Replaced with single shared Cloudflare Worker + Gmail forwarding filter.
2. **Do your cards send per-transaction email alerts?** Verify per card — this is
   the whole premise.
3. **Which banks → which templates?** List the actual banks you and your friends
   use; each is one small template (~30 lines). This replaces the device question
   as the real day-one task.
4. **On-device fallback — if/when?** Only needed to support banks you haven't
   templated *without* manual entry; requires Apple-Intelligence-capable iPhones.
5. **Sharing in v1 or v2?** Recommend v2 (single device per person first).
6. **Distribution** — TestFlight (lean) vs sideload (§11).
