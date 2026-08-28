-- Atomic Transaction Functions for KukuConnect FMS
-- Run this file in your Supabase SQL Editor AFTER schema.sql, orders.sql, and brooder.sql

-- 1. record_sale
-- Handles inserting a sale, deducting inventory, logging movements, and deducting brooder lots atomically.
create or replace function public.record_sale(payload jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  _sale jsonb := payload->'sale';
  _items jsonb := payload->'items';
  _movements jsonb := payload->'movements';
  _lot_deductions jsonb := payload->'brooderDeductions';
  
  _item jsonb;
  _mov jsonb;
  _deduction jsonb;
  _new_balance integer;
begin
  -- Idempotency check: prevent duplicate stock deductions from retries
  if exists (select 1 from public.sales where id = _sale->>'id') then
    return;
  end if;

  -- 1. Insert the Sale
  insert into public.sales (
    id, created_at, date_label, customer, customer_phone, total,
    receipt_number, payment_method, mpesa_code, served_by
  ) values (
    _sale->>'id',
    (_sale->>'created_at')::timestamptz,
    _sale->>'date_label',
    _sale->>'customer',
    _sale->>'customer_phone',
    (_sale->>'total')::numeric,
    _sale->>'receipt_number',
    _sale->>'payment_method',
    _sale->>'mpesa_code',
    _sale->>'served_by'
  );

  -- 2. Insert Sale Items
  for _item in select * from jsonb_array_elements(_items) loop
    insert into public.sale_items (sale_id, item_id, name, qty, price)
    values (
      _item->>'sale_id',
      _item->>'item_id',
      _item->>'name',
      (_item->>'qty')::integer,
      (_item->>'price')::numeric
    );
  end loop;

  -- 3. Apply Inventory Deductions & Insert Movements
  for _mov in select * from jsonb_array_elements(_movements) loop
    -- Update inventory item atomically and get the resulting balance
    update public.inventory_items 
    set quantity = quantity + (_mov->>'delta')::integer,
        updated_at = now()
    where id = _mov->>'item_id'
    returning quantity into _new_balance;

    -- If item didn't exist, we fallback to the balance passed by client (rare edge case)
    if _new_balance is null then
      _new_balance := (_mov->>'balance_after')::integer;
    end if;

    -- Insert the movement record
    insert into public.inventory_movements (
      id, item_id, item_name, type, delta, balance_after, note, ref_id, created_at
    ) values (
      _mov->>'id',
      _mov->>'item_id',
      _mov->>'item_name',
      _mov->>'type',
      (_mov->>'delta')::integer,
      _new_balance,
      _mov->>'note',
      _mov->>'ref_id',
      (_mov->>'created_at')::timestamptz
    );
  end loop;

  -- 4. Apply Brooder Lot Deductions
  if _lot_deductions is not null then
    for _deduction in select * from jsonb_array_elements(_lot_deductions) loop
      if (_deduction->>'is_discounted')::boolean = true then
        update public.brooder_lots
        set quantity = quantity - (_deduction->>'qty')::integer,
            total_discounted = total_discounted + (_deduction->>'qty')::integer
        where id = _deduction->>'lot_id';
      else
        update public.brooder_lots
        set quantity = quantity - (_deduction->>'qty')::integer,
            total_sales = total_sales + (_deduction->>'qty')::integer
        where id = _deduction->>'lot_id';
      end if;
    end loop;
  end if;
end;
$$;


-- 2. adjust_inventory
-- Handles atomic inventory quantity adjustments and logs the movement.
create or replace function public.adjust_inventory(payload jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  _mov jsonb := payload->'movement';
  _new_balance integer;
begin
  -- Idempotency check: prevent duplicate adjustments
  if exists (select 1 from public.inventory_movements where id = _mov->>'id') then
    return;
  end if;

  -- Update inventory item atomically
  update public.inventory_items 
  set quantity = quantity + (_mov->>'delta')::integer,
      updated_at = now()
  where id = _mov->>'item_id'
  returning quantity into _new_balance;

  if _new_balance is null then
    _new_balance := (_mov->>'balance_after')::integer;
  end if;

  -- Insert the movement record
  insert into public.inventory_movements (
    id, item_id, item_name, type, delta, balance_after, note, ref_id, created_at
  ) values (
    _mov->>'id',
    _mov->>'item_id',
    _mov->>'item_name',
    _mov->>'type',
    (_mov->>'delta')::integer,
    _new_balance,
    _mov->>'note',
    _mov->>'ref_id',
    (_mov->>'created_at')::timestamptz
  );
end;
$$;


-- 3. record_mortality
-- Handles inserting a mortality event and deducting the brooder lot atomically.
create or replace function public.record_mortality(payload jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  _event jsonb := payload->'event';
  _mov jsonb := payload->'movement';
  _new_balance integer;
begin
  -- Idempotency check: prevent duplicate mortality records
  if exists (select 1 from public.mortality_events where id = _event->>'id') then
    return;
  end if;

  -- Insert the mortality event
  insert into public.mortality_events (
    id, lot_id, lot_name, qty, reason, date, created_at
  ) values (
    _event->>'id',
    _event->>'lot_id',
    _event->>'lot_name',
    (_event->>'qty')::integer,
    _event->>'reason',
    (_event->>'date')::date,
    (_event->>'created_at')::timestamptz
  );

  -- Deduct from the brooder lot
  update public.brooder_lots
  set quantity = quantity - (_event->>'qty')::integer,
      total_mortality = total_mortality + (_event->>'qty')::integer
  where id = _event->>'lot_id';

  -- Deduct from inventory (if movement is provided)
  if _mov is not null then
    update public.inventory_items 
    set quantity = quantity + (_mov->>'delta')::integer,
        updated_at = now()
    where id = _mov->>'item_id'
    returning quantity into _new_balance;

    if _new_balance is null then
      _new_balance := (_mov->>'balance_after')::integer;
    end if;

    insert into public.inventory_movements (
      id, item_id, item_name, type, delta, balance_after, note, ref_id, created_at
    ) values (
      _mov->>'id',
      _mov->>'item_id',
      _mov->>'item_name',
      _mov->>'type',
      (_mov->>'delta')::integer,
      _new_balance,
      _mov->>'note',
      _mov->>'ref_id',
      (_mov->>'created_at')::timestamptz
    );
  end if;
end;
$$;


-- 4. record_hatch
-- Handles updating an incubation batch, incrementing inventory, inserting movement, and creating a brooder lot.
create or replace function public.record_hatch(payload jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  _batch jsonb := payload->'batch';
  _mov jsonb := payload->'movement';
  _lot jsonb := payload->'brooderLot';
  _new_balance integer;
begin
  -- Idempotency checks
  if _mov is not null and exists (select 1 from public.inventory_movements where id = _mov->>'id') then
    return;
  end if;
  if _lot is not null and exists (select 1 from public.brooder_lots where id = _lot->>'id') then
    return;
  end if;

  -- 1. Update Incubation Batch
  update public.incubation_batches
  set status = _batch->>'status',
      hatched_count = (_batch->>'hatched_count')::integer,
      hatched_at = (_batch->>'hatched_at')::timestamptz,
      notes = _batch->>'notes'
  where id = _batch->>'id';

  -- 2. Increment Day-Old Chicks Inventory
  if _mov is not null then
    update public.inventory_items 
    set quantity = quantity + (_mov->>'delta')::integer,
        updated_at = now()
    where id = _mov->>'item_id'
    returning quantity into _new_balance;

    if _new_balance is null then
      _new_balance := (_mov->>'balance_after')::integer;
    end if;

    -- Insert the movement record
    insert into public.inventory_movements (
      id, item_id, item_name, type, delta, balance_after, note, ref_id, created_at
    ) values (
      _mov->>'id',
      _mov->>'item_id',
      _mov->>'item_name',
      _mov->>'type',
      (_mov->>'delta')::integer,
      _new_balance,
      _mov->>'note',
      _mov->>'ref_id',
      (_mov->>'created_at')::timestamptz
    );
  end if;

  -- 3. Insert Brooder Lot
  if _lot is not null then
    insert into public.brooder_lots (
      id, name, hatch_date, quantity, initial_quantity, stage_id, breed, notes, status,
      last_aged_date, total_mortality, total_sales, total_discounted, created_at, brooder
    ) values (
      _lot->>'id',
      _lot->>'name',
      (_lot->>'hatch_date')::date,
      (_lot->>'quantity')::integer,
      (_lot->>'initial_quantity')::integer,
      _lot->>'stage_id',
      _lot->>'breed',
      _lot->>'notes',
      _lot->>'status',
      (_lot->>'last_aged_date')::date,
      (_lot->>'total_mortality')::integer,
      (_lot->>'total_sales')::integer,
      (_lot->>'total_discounted')::integer,
      (_lot->>'created_at')::timestamptz,
      _lot->>'brooder'
    );
  end if;
end;
$$;

-- 5. create_order
create or replace function public.create_order(payload jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  _order jsonb := payload->'order';
  _items jsonb := payload->'items';
  _item jsonb;
  _inv_item record;
  _computed_total numeric := 0;
  _price numeric;
begin
  -- Idempotency
  if exists (select 1 from public.farmer_orders where id = _order->>'id') then
    return;
  end if;

  -- Validate and reserve stock, compute total
  for _item in select * from jsonb_array_elements(_items) loop
    select * into _inv_item from public.inventory_items where id = _item->>'item_id' for update;
    if not found then
      raise exception 'Item % not found', _item->>'item_id';
    end if;

    if (_inv_item.quantity - _inv_item.reserved_quantity) < (_item->>'qty')::integer then
      raise exception 'Insufficient stock for %', _inv_item.name;
    end if;

    update public.inventory_items
    set reserved_quantity = reserved_quantity + (_item->>'qty')::integer
    where id = _item->>'item_id';

    _computed_total := _computed_total + ((_item->>'qty')::integer * _inv_item.default_price);
  end loop;

  -- Insert order
  insert into public.farmer_orders (
    id, created_at, customer_name, customer_phone, location, notes, total, status, source
  ) values (
    _order->>'id',
    (_order->>'created_at')::timestamptz,
    _order->>'customer_name',
    _order->>'customer_phone',
    _order->>'location',
    _order->>'notes',
    _computed_total,
    'pending',
    _order->>'source'
  );

  -- Insert items (using the authoritative price)
  for _item in select * from jsonb_array_elements(_items) loop
    select default_price into _price from public.inventory_items where id = _item->>'item_id';
    insert into public.farmer_order_items (
      order_id, breed, age, item_id, name, qty, unit_price
    ) values (
      _order->>'id',
      _item->>'breed',
      _item->>'age',
      _item->>'item_id',
      _item->>'name',
      (_item->>'qty')::integer,
      _price
    );
  end loop;
end;
$$;

-- 6. process_order_payment
create or replace function public.process_order_payment(payload jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  _order_id text := payload->>'order_id';
  _payment_ref text := payload->>'payment_ref';
  _sale_payload jsonb := payload->'sale_payload';
  _order_status text;
  _item record;
begin
  select status into _order_status from public.farmer_orders where id = _order_id for update;
  if _order_status != 'pending' then
    return;
  end if;

  -- Release reservations
  for _item in select item_id, qty from public.farmer_order_items where order_id = _order_id loop
    update public.inventory_items
    set reserved_quantity = reserved_quantity - _item.qty
    where id = _item.item_id;
  end loop;

  -- Update order
  update public.farmer_orders
  set status = 'paid', payment_ref = _payment_ref, paid_at = now()
  where id = _order_id;

  -- Record sale
  perform public.record_sale(_sale_payload);
end;
$$;

-- 7. cancel_order
create or replace function public.cancel_order(payload jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  _order_id text := payload->>'order_id';
  _order_status text;
  _item record;
begin
  select status into _order_status from public.farmer_orders where id = _order_id for update;
  if _order_status != 'pending' then
    return;
  end if;

  -- Release reservations
  for _item in select item_id, qty from public.farmer_order_items where order_id = _order_id loop
    update public.inventory_items
    set reserved_quantity = reserved_quantity - _item.qty
    where id = _item.item_id;
  end loop;

  -- Update order
  update public.farmer_orders
  set status = 'cancelled'
  where id = _order_id;
end;
$$;
