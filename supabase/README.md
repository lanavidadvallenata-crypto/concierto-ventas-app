# Base de datos — orden de las migraciones

Todos los `.sql` de esta carpeta se corren a mano en el **SQL Editor** de Supabase
(Project → SQL Editor → pegar → Run). Este es el orden en que se aplicaron y en el
que hay que aplicarlos en un proyecto nuevo:

| # | Archivo | Qué hace | ¿Repetible? |
|---|---|---|---|
| 1 | `schema.sql` | Tablas base: perfiles, eventos, mesas_vip, sillas_vip, reservas, tickets, accesos. | No (crea tablas). |
| 2 | *(a mano)* | `insert into public.eventos default values;` — hace falta UNA fila en eventos (nombre, fecha, venue y aforo tienen default). | — |
| 3 | `seed_vip.sql` | Recrea mesas_vip/sillas_vip y carga filas A, B, C (300 sillas). **Borra las sillas existentes: solo con tickets = 0.** | No. |
| 4 | `permitir_venta_web.sql` | `tickets.vendido_por` pasa a opcional (compras web). | Sí. |
| 5 | `agregar_bloqueo_temporal.sql` | `sillas_vip.reservado_hasta` + función `liberar_sillas_vencidas()`. | Sí. |
| 6 | `agregar_limite_checkout.sql` | Tabla `intentos_checkout` (límite por IP). | Sí. |
| 7 | `agregar_tasa_cambio.sql` | Tabla `tasas_cambio` (tasa BCV euro). | Sí. |
| 8 | `reparar_fk_tickets_sillas.sql` | Restaura la FK tickets→sillas_vip que `seed_vip.sql` borró con `drop … cascade`. | Sí. |
| 9 | `feedback_19sep_grupos_preventa_taquilla.sql` | `grupo_id`, `precio_bs`, `tasa_aplicada`, `etapa`, `canal`; métodos efectivo. | Sí. |
| 10 | `auditoria_21sep_indice_sillas_rls.sql` | Índice único "una silla, un ticket vivo" + RLS en todas las tablas. | Sí. |
| 11 | `cortesias_06oct.sql` | Entradas de cortesía (patrocinios): ocupan aforo a precio 0. | Sí. |
| 12 | `abona618_12oct.sql` | Abona618 (pago en cuotas): `planes_pago`, `cuotas`, `abona618_config`. Aditivo puro, no altera ninguna tabla existente. **`abona618_config.activo` arranca en `false`**: el módulo se sube apagado. | No (crea tablas). |
| 13 | `abona618_endurecer_12oct.sql` | Constraints de integridad de Abona618 e índices corregidos, después de la auditoría del 12 de octubre. Va con ALTER porque el anterior usa `create table if not exists` y no se puede migrar reeditándolo. | Sí. |
| — | `expandir_vip_d_e.sql` | Solo si se decide ampliar a 500 VIP (filas D y E). | No. |

Reglas:
- **Nunca** volver a correr `seed_vip.sql` con tickets creados: borra las sillas (y sus IDs) y deja los tickets apuntando a sillas que no existen.
- Después de cualquier cambio de schema, `notify pgrst, 'reload schema';` (los scripts nuevos ya lo incluyen).
- Ninguna tabla tiene políticas RLS: el navegador (anon key) no lee ni escribe nada; todo pasa por el servidor con la service role key.

**Abona618 — encender, apagar y extender el tope** (todo sin desplegar):

```sql
-- encender cuando esté probado
update public.abona618_config set activo = true,  actualizado_en = now() where id = 1;
-- apagar de emergencia
update public.abona618_config set activo = false, actualizado_en = now() where id = 1;
-- extender el tope de VIP en plan de 100 a 150, y volver a recibir el aviso
update public.abona618_config
   set tope_vip = 150, aviso_tope_vip = 140, aviso_tope_enviado_en = null, actualizado_en = now()
 where id = 1;
```

Para BAJAR el tope hay que bajar primero el aviso, o la constraint
`aviso_menor_que_tope` lo rechaza:

```sql
update public.abona618_config set aviso_tope_vip = 40, tope_vip = 50, actualizado_en = now() where id = 1;
```
