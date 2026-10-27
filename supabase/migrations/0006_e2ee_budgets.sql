-- E2EE for budgets: the app both writes and reads budget amounts (the Worker
-- never touches them), so the amount moves into a sealed payload_enc blob like
-- transactions/review_queue did in 0005. Legacy amount_cents goes nullable —
-- the client encrypts existing rows during the one-time history migration.

alter table public.budgets
  add column payload_enc text,
  alter column amount_cents drop not null;
