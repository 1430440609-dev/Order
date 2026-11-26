-- One commission customer attribution per signed-in account.
create table if not exists public.commission_preferences (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  customer_name text not null default '' check (char_length(customer_name) <= 80)
);

alter table public.commission_preferences enable row level security;
revoke all on table public.commission_preferences from public, anon, authenticated;
grant select, insert, update on table public.commission_preferences to authenticated;

drop policy if exists "commission_preferences_read_own" on public.commission_preferences;
create policy "commission_preferences_read_own"
on public.commission_preferences for select to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists "commission_preferences_insert_own" on public.commission_preferences;
create policy "commission_preferences_insert_own"
on public.commission_preferences for insert to authenticated
with check (owner_id = (select auth.uid()));

drop policy if exists "commission_preferences_update_own" on public.commission_preferences;
create policy "commission_preferences_update_own"
on public.commission_preferences for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));
