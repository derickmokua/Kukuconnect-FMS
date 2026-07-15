-- Optional cloud tables for brooder + mortality (run after schema.sql)

create table if not exists public.brooder_lots (
  id text primary key,
  name text not null,
  hatch_date date not null,
  quantity integer not null default 0,
  initial_quantity integer not null default 0,
  stage_id text not null,
  breed text not null default '',
  notes text not null default '',
  status text not null default 'active',
  last_aged_date date not null,
  total_mortality integer not null default 0,
  total_sales integer not null default 0,
  total_discounted integer not null default 0,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  brooder text not null default 'Unassigned'
);

-- Migrate existing databases (safe to re-run)
alter table public.brooder_lots
  add column if not exists brooder text not null default 'Unassigned';
alter table public.brooder_lots
  add column if not exists initial_quantity integer not null default 0;
alter table public.brooder_lots
  add column if not exists total_sales integer not null default 0;
alter table public.brooder_lots
  add column if not exists total_discounted integer not null default 0;

-- Backfill placed qty where missing (best-effort from remaining + outs)
update public.brooder_lots
set initial_quantity = greatest(
  initial_quantity,
  coalesce(quantity, 0)
    + coalesce(total_mortality, 0)
    + coalesce(total_sales, 0)
    + coalesce(total_discounted, 0)
)
where initial_quantity = 0;

create table if not exists public.mortality_events (
  id text primary key,
  lot_id text not null,
  lot_name text not null,
  qty integer not null,
  reason text not null default '',
  date date not null,
  created_at timestamptz not null default now()
);

alter table public.brooder_lots enable row level security;
alter table public.mortality_events enable row level security;

drop policy if exists "auth all brooder_lots" on public.brooder_lots;
create policy "auth all brooder_lots" on public.brooder_lots
  for all to authenticated using (true) with check (true);

drop policy if exists "auth all mortality_events" on public.mortality_events;
create policy "auth all mortality_events" on public.mortality_events
  for all to authenticated using (true) with check (true);
