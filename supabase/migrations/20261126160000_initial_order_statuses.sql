-- Remember whether booking details have ever been entered, even if later cleared.
alter table public.orders
  add column if not exists order_details_entered boolean not null default false;

-- Existing orders with details already filled keep their current statuses.
update public.orders
set order_details_entered = true
where not order_details_entered
  and (confirmation_no ~ '[^[:space:]]' or company ~ '[^[:space:]]');

create or replace function public.set_initial_order_statuses()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  has_details boolean := coalesce(new.confirmation_no ~ '[^[:space:]]', false)
    or coalesce(new.company ~ '[^[:space:]]', false);
begin
  if tg_op = 'INSERT' then
    -- Imports can already contain both booking details and accurate statuses.
    new.order_details_entered := has_details;
    return new;
  end if;

  if not old.order_details_entered and has_details then
    new.paid_status := '否';
    new.stay_status := '否';
  end if;

  new.order_details_entered := old.order_details_entered or has_details;
  return new;
end;
$$;

drop trigger if exists set_initial_order_statuses on public.orders;
create trigger set_initial_order_statuses
before insert or update of confirmation_no, company, order_details_entered
on public.orders
for each row execute function public.set_initial_order_statuses();
