-- Sprint 10: Inventario simple en platos (idempotente)

alter table if exists public.platos
  add column if not exists is_available boolean not null default true,
  add column if not exists stock integer,
  add column if not exists track_stock boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platos_stock_non_negative_check'
      and conrelid = 'public.platos'::regclass
  ) then
    alter table public.platos
      add constraint platos_stock_non_negative_check
      check (stock is null or stock >= 0);
  end if;
end $$;

comment on column public.platos.is_available is
'Disponibilidad manual del plato en carta (true = disponible).';

comment on column public.platos.track_stock is
'Si true, el plato descuenta/valida stock en create_order. Si false, stock infinito.';

comment on column public.platos.stock is
'Stock actual del plato. Si track_stock=true y stock es null, se trata como 0.';
