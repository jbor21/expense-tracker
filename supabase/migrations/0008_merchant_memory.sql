-- Learned merchant → category (PWA). normalized_merchant matches categorizer keys.
create table public.merchant_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  normalized_merchant text not null,
  category_id uuid not null references public.categories (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, normalized_merchant)
);

alter table public.merchant_memory enable row level security;

create policy "own merchant memory" on public.merchant_memory
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());