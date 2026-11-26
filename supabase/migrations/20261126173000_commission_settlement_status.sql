-- Commission settlement is separate from the booking's payment status.
alter table public.orders
  add column if not exists commission_settlement_status text not null default '未结款'
  check (commission_settlement_status in ('已结款', '未结款'));
