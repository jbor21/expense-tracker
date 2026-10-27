-- E2EE: sensitive fields move into a sealed-box blob (payload_enc) encrypted
-- to a per-user X25519 public key. Only the user's device can decrypt; the
-- operator's service-role key sees ciphertext. Legacy plaintext columns go
-- nullable — new rows leave them null, and the client nulls them for old rows
-- when it runs the one-time history migration. Apply in the Supabase SQL editor.

-- The user's public key (base64), uploaded by the app at key creation. Not a
-- secret: it can only encrypt *to* the user, never decrypt.
alter table public.profiles add column public_key text;

alter table public.transactions
  add column payload_enc text,
  alter column amount_cents drop not null,
  alter column kind drop not null,
  alter column merchant_raw drop not null;

alter table public.review_queue
  add column payload_enc text,
  alter column sender drop not null,
  alter column subject drop not null,
  alter column excerpt drop not null;
