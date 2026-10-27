-- Fix: handle_new_user's variable `code` collided with the invite_codes.code
-- column — Postgres raised "ambiguous" on every invited signup. Variables are
-- now v_-prefixed. Also friendlier exception wording ("key" not "code").

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_code text := upper(coalesce(new.raw_user_meta_data->>'invite_code', ''));
  v_is_first boolean;
  v_cat text;
begin
  select not exists (select 1 from public.profiles) into v_is_first;

  insert into public.profiles (id, email, is_master)
  values (new.id, new.email, v_is_first);

  if not v_is_first then
    update public.invite_codes
       set used_by = new.id, used_at = now()
     where invite_codes.code = v_code and used_by is null;
    if not found then
      raise exception 'invalid or already-used invite key';
    end if;
  end if;

  foreach v_cat in array array['Groceries','Dining','Gas','Shopping','Bills','Fun','Other'] loop
    insert into public.categories (user_id, name) values (new.id, v_cat);
  end loop;

  return new;
end;
$$;
