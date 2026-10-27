# Tally — expense tracker

Private expense tracker. Bank transaction-alert emails are auto-forwarded (Gmail
filter) to a per-user address on a **Cloudflare Worker**, which parses each charge
with per-sender templates, **seals the sensitive fields to the user's key**
(operator-blind E2EE), and writes the ciphertext row to **Supabase**. The
**PWA** reads Supabase directly and decrypts on-device.

Live: <https://tally.expense-app.uk>

## Layout

| Path | What |
|---|---|
| `web/` | The PWA — React + TypeScript + Vite, Cloudflare static assets. **The product.** |
| `Worker/` | Cloudflare Worker — inbound email → parse → seal → Supabase. Bank templates in `src/parsing/templates.ts`. |
| `supabase/migrations/` | Postgres schema (apply in order in the Supabase SQL editor). |
| `docs/` | Specs and design notes — the "why". |
| `legacy-ios/` | Dormant original native-iOS version. Not built, not deployed. See its README. |

## Develop

```bash
# Worker
cd Worker && npm ci && npm test          # 52 tests
npx tsc --noEmit

# Web (needs Worker deps installed too — the PWA imports Worker/src/crypto.ts)
cd web && npm ci && npx vitest run       # 35 tests
npx tsc -b && npx oxlint && npm run build
```

Local env: copy `web/.env.example` → `web/.env.local` for overrides. The
committed `web/.env.production` holds the public client config (Supabase anon key
is RLS-protected and safe to commit).

## CI / deploy (GitHub Actions)

- **`.github/workflows/ci.yml`** — every PR: Worker + web typecheck, lint, tests, build.
- **`.github/workflows/deploy.yml`** — push to `main`: runs the checks, then
  `wrangler deploy` for `Worker/` and `web/`.

Repo secrets required for deploy: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
The Worker's own runtime secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
live in Cloudflare via `wrangler secret put` and are not touched by deploys.

## History note

The git history was reset here in **Sept 2026** after an iCloud "Desktop &
Documents" sync accident corrupted the previous repo's object store on this
machine. Pre-reset history (and the complete `legacy-ios` sources) exist on the
original Mac only. Keep this repo **out of any cloud-synced folder**.
