-- Hotel Order Desk: schema and row-level security
-- Run once in Supabase SQL Editor for the dedicated Order-Desk-DB project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, role)
  values (
    new.id,
    lower(coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1))),
    'staff'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute procedure public.create_profile_for_auth_user();

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  confirmation_no text not null default '',
  company text not null default '',
  hotel text not null default '',
  guest_name text not null default '',
  placed_date date not null default current_date,
  checkin_date date,
  checkout_date date,
  nights integer not null default 0,
  days integer not null default 0,
  cost numeric(12,2) not null default 0,
  quote numeric(12,2) not null default 0,
  deposit numeric(12,2) not null default 0,
  balance numeric(12,2) not null default 0,
  profit numeric(12,2) not null default 0,
  paid_status text not null default '待定' check (paid_status in ('是', '否', '待定')),
  payment_method text not null default '闲鱼',
  stay_status text not null default '待定' check (stay_status in ('是', '否', '待定')),
  order_type text not null default '全部订单',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_owner_placed_idx on public.orders (owner_id, placed_date desc);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values ('site', '{"title":"住单 · 酒店订单管理"}'::jsonb)
on conflict (key) do nothing;

create or replace function public.is_order_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;
revoke all on function public.is_order_admin() from public;
grant execute on function public.is_order_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.app_settings enable row level security;

-- Profiles: users see their own profile; administrators can manage the staff directory.
drop policy if exists "profile_read_self_or_admin" on public.profiles;
create policy "profile_read_self_or_admin" on public.profiles
for select to authenticated
using (id = (select auth.uid()) or (select public.is_order_admin()));
drop policy if exists "profile_admin_insert" on public.profiles;
create policy "profile_admin_insert" on public.profiles
for insert to authenticated
with check ((select public.is_order_admin()));
drop policy if exists "profile_admin_update" on public.profiles;
create policy "profile_admin_update" on public.profiles
for update to authenticated
using ((select public.is_order_admin()))
with check ((select public.is_order_admin()));
drop policy if exists "profile_admin_delete" on public.profiles;
create policy "profile_admin_delete" on public.profiles
for delete to authenticated
using ((select public.is_order_admin()));

-- Orders: even administrators only see and change orders they personally entered.
drop policy if exists "orders_owner_all" on public.orders;
create policy "orders_owner_all" on public.orders
for all to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

-- Settings: shared read access for signed-in accounts; admin-only writes.
drop policy if exists "settings_read_authenticated" on public.app_settings;
create policy "settings_read_authenticated" on public.app_settings
for select to authenticated using (true);
drop policy if exists "settings_admin_insert" on public.app_settings;
create policy "settings_admin_insert" on public.app_settings
for insert to authenticated with check ((select public.is_order_admin()));
drop policy if exists "settings_admin_update" on public.app_settings;
create policy "settings_admin_update" on public.app_settings
for update to authenticated
using ((select public.is_order_admin()))
with check ((select public.is_order_admin()));
drop policy if exists "settings_admin_delete" on public.app_settings;
create policy "settings_admin_delete" on public.app_settings
for delete to authenticated using ((select public.is_order_admin()));

-- Explicitly grant only the required table operations to authenticated users.
grant select on public.profiles to authenticated;
grant insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.app_settings to authenticated;