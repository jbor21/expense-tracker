# Supabase setup (Tally)

Project: `https://zeftuqnzstcffouuqcxi.supabase.co`

## Applying migrations

Paste each file in `migrations/` (in order) into the Supabase dashboard →
**SQL Editor** → Run. (If the Supabase CLI is ever linked, `supabase db push`
works too.)

## Where the keys live

| Key | Where | How |
|---|---|---|
| Project URL | Worker secret + web env | `wrangler secret put SUPABASE_URL`; `VITE_SUPABASE_URL` in `web/.env.local` |
| `anon` (public) | web env only | `VITE_SUPABASE_ANON_KEY` in `web/.env.local` (gitignored; safe-ish — RLS enforces access) |
| `service_role` | **Worker secret ONLY** | `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` |

**Never** put `service_role` in the web app or commit it — it bypasses all
row-level security.

## Auth settings

- Authentication → Sign In / Up: email/password enabled, **email confirmations
  OFF** (friends-and-family app).
- Authentication → URL Configuration: add the deployed origin
  (`https://tally.expense-app.uk`) as the Site URL.

## Model notes

- First user to sign up becomes the **master** account (no invite code
  needed); everyone after needs a 6-char code from the master's Settings.
- All money columns are integer cents (`amount_cents bigint`).
- `transactions` dedup: unique `(user_id, message_id, line_idx)`.
