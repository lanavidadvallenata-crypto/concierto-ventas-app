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
| — | `expandir_vip_d_e.sql` | Solo si se decide ampliar a 500 VIP (filas D y E). | No. |

Reglas:
- **Nunca** volver a correr `seed_vip.sql` con tickets creados: borra las sillas (y sus IDs) y deja los tickets apuntando a sillas que no existen.
- Después de cualquier cambio de schema, `notify pgrst, 'reload schema';` (los scripts nuevos ya lo incluyen).
- Ninguna tabla tiene políticas RLS: el navegador (anon key) no lee ni escribe nada; todo pasa por el servidor con la service role key.
