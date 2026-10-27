-- Fix: "own profile update" (0001) let a signed-in user update ANY column of
-- their own profile row — including is_master, which gates
-- generate_invite_code(). Any invited user could promote themselves and mint
-- invite keys (or rewrite email / forward_address).
--
-- RLS picks the row; column privileges pick the fields. The PWA only ever
-- writes public_key (KeySetup.tsx); forward_address is set by the Worker with
-- the service-role key, which bypasses these grants. Apply in the Supabase
-- SQL editor.

revoke update on public.profiles from anon, authenticated;
grant update (public_key) on public.profiles to authenticated;
