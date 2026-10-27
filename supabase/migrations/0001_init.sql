-- Tally (Expense Tracker PWA) — initial schema. Apply in the Supabase SQL
-- editor (or `supabase db push`). See supabase/README.md.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  is_master boolean not null default false,
  forward_address text unique,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

create table public.invite_codes (
  code text primary key,
  created_by uuid not null references public.profiles (id),
  used_by uuid references public.profiles (id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  archived boolean not null default false,
  unique (user_id, name)
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  month date not null, -- always the first of the month
  amount_cents bigint not null check (amount_cents >= 0),
  unique (user_id, category_id, month)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents bigint not null, -- signed: refunds negative
  kind text not null check (kind in ('purchase', 'refund')),
  merchant_raw text not null,
  category_id uuid references public.categories (id) on delete set null,
  occurred_at timestamptz not null,
  account_last4 text,
  message_id text not null,
  line_idx integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, message_id, line_idx)
);

create table public.review_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  sender text not null,
  subject text not null,
  excerpt text not null, -- trimmed to 500 chars by the Worker, never full bodies
  received_at timestamptz not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- Signup gate: validate invite code from signUp metadata; first-ever user is
-- master and needs no code. Seeds default categories for every new user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  code text := upper(coalesce(new.raw_user_meta_data->>'invite_code', ''));
  is_first boolean;
  cat text;
begin
  select not exists (select 1 from public.profiles) into is_first;

  insert into public.profiles (id, email, is_master)
  values (new.id, new.email, is_first);

  if not is_first then
    update public.invite_codes
       set used_by = new.id, used_at = now()
     where invite_codes.code = code and used_by is null;
    if not found then
      raise exception 'invalid or already-used invite code';
    end if;
  end if;

  foreach cat in array array['Groceries','Dining','Gas','Shopping','Bills','Fun','Other'] loop
    insert into public.categories (user_id, name) values (new.id, cat);
  end loop;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Master-only invite generation: 6 chars from an unambiguous alphabet
-- (no 0/O/1/I/L), per the spec's "longer than Boda's 4".
create or replace function public.generate_invite_code()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  new_code text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_master) then
    raise exception 'only the master account can generate invite codes';
  end if;
  loop
    select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '')
      from generate_series(1, 6) into new_code;
    begin
      insert into public.invite_codes (code, created_by) values (new_code, auth.uid());
      return new_code;
    exception when unique_violation then
      -- collision: loop and try again
    end;
  end loop;
end;
$$;

-- Row-level security: every user sees only their own rows.
alter table public.profiles enable row level security;
alter table public.invite_codes enable row level security;
alter table public.categories enable row level security;
alter table public.budgets enable row level security;
alter table public.transactions enable row level security;
alter table public.review_queue enable row level security;

create policy "own profile read"   on public.profiles  for select using (id = auth.uid());
create policy "own profile update" on public.profiles  for update using (id = auth.uid());
-- invite_codes: no direct policies — access only via generate_invite_code() (security definer)

create policy "own categories" on public.categories  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own budgets"    on public.budgets     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own txns"       on public.transactions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own review"     on public.review_queue for all using (user_id = auth.uid()) with check (user_id = auth.uid());
