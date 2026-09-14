-- Las ventas hechas por el comprador desde la web pública no tienen un vendedor
-- interno asociado. vendido_por pasa a ser opcional; Finanzas muestra "Venta web"
-- cuando es NULL.
alter table public.tickets
  alter column vendido_por drop not null;
