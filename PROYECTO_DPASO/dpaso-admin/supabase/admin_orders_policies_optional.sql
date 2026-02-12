-- Opcional: ejecutar solo si el rol admin aún no puede ver/actualizar pedidos.
-- Este script NO toca policies públicas de insert existentes.

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "admin select orders" on public.orders;
create policy "admin select orders"
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "admin update orders" on public.orders;
create policy "admin update orders"
on public.orders
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "admin select order_items" on public.order_items;
create policy "admin select order_items"
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);
