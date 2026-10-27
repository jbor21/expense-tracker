# expense-inbox — inbound-email parser (E2EE)

The one server-side compute piece of Tally (the Expense Tracker PWA). Friends
set a Gmail filter that auto-forwards bank alert emails to a per-user address
on this Worker. The Worker parses each email with the per-sender templates
(`src/parsing/`), **seals the sensitive fields to the user's public key**
(`src/crypto.ts` — X25519 sealed box → AES-256-GCM), and writes the ciphertext
row straight into Supabase. The PWA reads Supabase directly and decrypts
on-device.

The old store-and-forward surface (`/messages`, `/ack`, D1, per-user bearer
secrets, `PROVISION_KEY`) is **retired** — see git history if you need it.

**Privacy posture (operator-blind):**

- Nothing readable is stored anywhere. Parsed merchant / amount / card-last4 /
  kind go into a `payload_enc` sealed-box blob only the user's device can open
  (key derived from their 12-word recovery phrase; public half in
  `profiles.public_key`). Unparseable emails land in `review_queue` the same
  way (sender/subject/excerpt sealed).
- Plaintext exists only in Worker memory for the milliseconds between receipt
  and encryption — the accepted residual exposure (banks email in plaintext).
- Plaintext columns still exist (nullable) for rows written before a user's
  device created a key; the PWA encrypts that history client-side on the
  user's next login and nulls the plaintext. If a profile has no `public_key`
  yet, the Worker falls back to a plaintext write rather than dropping mail.
- Per-user addresses are unguessable (64-bit random local part); mail to an
  unknown address is rejected so a typo'd forwarding setup fails visibly in
  Gmail.

## Setup (operator)

1. **Domain** on Cloudflare with **Email Routing** enabled; set `INBOX_DOMAIN`
   in `wrangler.toml`.
2. **Secrets**: `npx wrangler secret put SUPABASE_URL` and
   `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`.
3. **Supabase schema**: apply `../supabase/migrations/*.sql` in order in the
   Supabase SQL editor (`0005_e2ee.sql` adds `profiles.public_key` +
   `payload_enc` columns).
4. **Deploy**: `npx wrangler deploy`.
5. **Email Routing** (dashboard): zone → Email → Routing rules →
   **Catch-all → Send to a Worker → expense-inbox**.

## API

| Route | Auth | Returns |
|---|---|---|
| `POST /provision` | `Bearer <Supabase user access token>` | `{address}` — mints `u_<hex>@INBOX_DOMAIN`, saves it to the caller's `profiles.forward_address` |

CORS is locked to the PWA origin (`https://tally.expense-app.uk`).

## Email flow

`email()` handler: PostalMime parse → look up profile by recipient address
(also fetches `public_key`) → `routeAndParse` with the bank templates →
matched charges are sealed + inserted into `transactions` (dedup via
`on_conflict (user_id, message_id, line_idx)` ignore-duplicates); unmatched
mail becomes a sealed `review_queue` row (500-char excerpt max). Unknown
recipient → `setReject`.

## Test

```bash
npm test          # vitest — templates, handler, writer (incl. seal/no-plaintext assertions), crypto
npx tsc --noEmit
```

End-to-end: use the PWA's Settings → Automatic charges flow (provision →
Gmail forward → test charge), then check the Supabase table editor — the row
must show `payload_enc` ciphertext and empty plaintext columns.
