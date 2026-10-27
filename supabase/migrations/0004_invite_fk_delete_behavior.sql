-- Deleting a user whose invite-key rows still reference them failed on FK.
-- used_by: keep the spent key, forget who used it. created_by: keys die with
-- the master account that minted them.
alter table public.invite_codes drop constraint invite_codes_used_by_fkey,
  add constraint invite_codes_used_by_fkey foreign key (used_by) references public.profiles(id) on delete set null;
alter table public.invite_codes drop constraint invite_codes_created_by_fkey,
  add constraint invite_codes_created_by_fkey foreign key (created_by) references public.profiles(id) on delete cascade;
