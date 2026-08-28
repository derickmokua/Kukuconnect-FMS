-- KukuConnect farm admin schema (Supabase / Postgres)
-- Run in Supabase SQL Editor: https://supabase.com/dashboard → SQL
-- Internal staff only; enable Email auth in Authentication → Providers

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Staff can read profiles"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'staff'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_items (
  id text primary key,
  name text not null,
  category text not null check (category in ('livestock', 'eggs', 'other')),
  quantity integer not null default 0 check (quantity >= 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  unit text not null default 'units',
  low_stock_at integer not null default 0,
  default_price numeric(12, 2) not null default 0,
  sellable boolean not null default true,
  system boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id text primary key,
  item_id text not null references public.inventory_items (id) on delete cascade,
  item_name text not null,
  type text not null check (type in ('in', 'out', 'adjust', 'sale', 'hatch', 'loss')),
  delta integer not null,
  balance_after integer not null,
  note text not null default '',
  ref_id text,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_created_at_idx
  on public.inventory_movements (created_at desc);

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------
create table if not exists public.sales (
  id text primary key,
  created_at timestamptz not null default now(),
  date_label text not null,
  customer text not null default '',
  customer_phone text not null default '',
  total numeric(12, 2) not null default 0
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id text not null references public.sales (id) on delete cascade,
  item_id text not null,
  name text not null,
  qty integer not null check (qty > 0),
  price numeric(12, 2) not null default 0
);

create index if not exists sales_created_at_idx on public.sales (created_at desc);

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
create table if not exists public.expenses (
  id text primary key,
  date date not null,
  category text not null check (
    category in ('feed', 'medicine', 'labour', 'transport', 'utilities', 'equipment', 'other')
  ),
  amount numeric(12, 2) not null check (amount >= 0),
  description text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists expenses_date_idx on public.expenses (date desc);

-- ---------------------------------------------------------------------------
-- Incubation
-- ---------------------------------------------------------------------------
create table if not exists public.incubation_batches (
  id text primary key,
  name text not null,
  egg_count integer not null check (egg_count >= 0),
  start_date date not null,
  incubation_days integer not null default 21,
  status text not null default 'incubating'
    check (status in ('incubating', 'hatched', 'discarded')),
  notes text not null default '',
  candling_notes text not null default '',
  removed_eggs integer not null default 0,
  hatched_count integer,
  hatched_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists incubation_status_idx
  on public.incubation_batches (status, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: authenticated farm staff full access (internal admin)
-- ---------------------------------------------------------------------------
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.expenses enable row level security;
alter table public.incubation_batches enable row level security;

create policy "auth all inventory_items" on public.inventory_items
  for all to authenticated using (true) with check (true);

drop policy if exists "auth all inventory_movements" on public.inventory_movements;
create policy "select inventory_movements" on public.inventory_movements
  for select to authenticated using (true);
create policy "insert inventory_movements" on public.inventory_movements
  for insert to authenticated with check (true);

drop policy if exists "auth all sales" on public.sales;
create policy "select sales" on public.sales
  for select to authenticated using (true);
create policy "insert sales" on public.sales
  for insert to authenticated with check (true);

drop policy if exists "auth all sale_items" on public.sale_items;
create policy "select sale_items" on public.sale_items
  for select to authenticated using (true);
create policy "insert sale_items" on public.sale_items
  for insert to authenticated with check (true);

create policy "auth all expenses" on public.expenses
  for all to authenticated using (true) with check (true);

create policy "auth all incubation_batches" on public.incubation_batches
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Seed default catalogue (KukuConnect SKUs)
-- ---------------------------------------------------------------------------
insert into public.inventory_items
  (id, name, category, quantity, unit, low_stock_at, default_price, sellable, system)
values
  ('parent-stock', 'Parent Stock', 'livestock', 0, 'birds', 20, 0, false, true),
  ('day-old-chick', '1 Day Old Chick', 'livestock', 0, 'chicks', 50, 150, true, true),
  ('week-1-chick', '1 Week Chick', 'livestock', 0, 'chicks', 30, 200, true, true),
  ('week-2-chick', '2 Weeks Chick', 'livestock', 0, 'chicks', 30, 280, true, true),
  ('week-3-chick', '3 Weeks Chick', 'livestock', 0, 'chicks', 20, 350, true, true),
  ('month-1-chick', '1 Month Chick', 'livestock', 0, 'birds', 20, 500, true, true),
  ('meat-bird', 'Meat Bird (3 Months)', 'livestock', 0, 'birds', 10, 1200, true, true),
  ('tray-eggs', 'Tray of Eggs', 'eggs', 0, 'trays', 5, 400, true, true),
  ('hatching-eggs', 'Hatching Eggs', 'eggs', 0, 'eggs', 50, 0, false, true)
on conflict (id) do nothing;
