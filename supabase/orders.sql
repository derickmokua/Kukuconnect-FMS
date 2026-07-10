-- M2: Farmer orders (run after schema.sql in Supabase SQL Editor)
-- Public web form inserts as anon; staff manage as authenticated.

create table if not exists public.farmer_orders (
  id text primary key,
  created_at timestamptz not null default now(),
  customer_name text not null,
  customer_phone text not null,
  location text not null default '',
  notes text not null default '',
  total numeric(12, 2) not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'fulfilled', 'cancelled')),
  payment_ref text not null default '',
  paid_at timestamptz,
  fulfilled_at timestamptz,
  source text not null default 'web'
    check (source in ('web', 'admin', 'whatsapp', 'phone'))
);

create table if not exists public.farmer_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.farmer_orders (id) on delete cascade,
  breed text not null,
  age text not null,
  item_id text not null,
  name text not null,
  qty integer not null check (qty > 0),
  unit_price numeric(12, 2) not null default 0
);

create index if not exists farmer_orders_status_idx
  on public.farmer_orders (status, created_at desc);

create index if not exists farmer_orders_phone_idx
  on public.farmer_orders (customer_phone);

alter table public.farmer_orders enable row level security;
alter table public.farmer_order_items enable row level security;

-- Staff: full access
drop policy if exists "auth all farmer_orders" on public.farmer_orders;
create policy "auth all farmer_orders" on public.farmer_orders
  for all to authenticated using (true) with check (true);

drop policy if exists "auth all farmer_order_items" on public.farmer_order_items;
create policy "auth all farmer_order_items" on public.farmer_order_items
  for all to authenticated using (true) with check (true);

-- Public: place orders only (no read of others' data)
drop policy if exists "anon insert farmer_orders" on public.farmer_orders;
create policy "anon insert farmer_orders" on public.farmer_orders
  for insert to anon with check (true);

drop policy if exists "anon insert farmer_order_items" on public.farmer_order_items;
create policy "anon insert farmer_order_items" on public.farmer_order_items
  for insert to anon with check (true);
