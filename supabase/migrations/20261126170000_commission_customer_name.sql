-- Store the commission template’s customer attribution with the source order.
alter table public.orders
  add column if not exists commission_customer_name text not null default ''
  check (char_length(commission_customer_name) <= 80);
