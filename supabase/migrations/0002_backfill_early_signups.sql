-- Backfill for accounts created BEFORE 0001 was applied (the trigger only
-- fires for new signups). Makes the earliest auth user the master and seeds
-- the default categories for every backfilled user. Idempotent.

insert into public.profiles (id, email, is_master)
select u.id, u.email,
       u.id = (select id from auth.users order by created_at asc limit 1)
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);

insert into public.categories (user_id, name)
select p.id, c.name
  from public.profiles p
 cross join (values ('Groceries'),('Dining'),('Gas'),('Shopping'),('Bills'),('Fun'),('Other')) as c(name)
 where not exists (select 1 from public.categories k where k.user_id = p.id and k.name = c.name);
