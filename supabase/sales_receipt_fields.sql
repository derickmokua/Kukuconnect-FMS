-- Optional: receipt meta on sales (run after schema.sql)
alter table public.sales add column if not exists receipt_number text default '';
alter table public.sales add column if not exists payment_method text default 'Cash';
alter table public.sales add column if not exists mpesa_code text default '';
alter table public.sales add column if not exists served_by text default '';
