# Sistema de venta — La Navidad Vallenata

Reemplaza el sistema anterior (Artifacts de Claude) por infraestructura propia del evento, para que ningún miembro del equipo necesite cuenta de Claude. Venta sigue siendo 100% manual por WhatsApp normal — esta app es donde el equipo registra la venta, verifica el pago y genera el QR.

## Stack (fase 1, sin Kommo ni WhatsApp Business API)

| Pieza | Para qué | Cuenta necesaria |
|---|---|---|
| Next.js | Código de la app | No (ya está aquí) |
| GitHub | Guarda el código | Sí — con el correo oficial |
| Vercel | Aloja y despliega la app | Sí — con el correo oficial (login "Continue with GitHub") |
| Supabase | Base de datos + login del equipo | Sí — con el correo oficial |
| Resend | Envío del correo con QR | Sí — con el correo oficial |

## Estado actual

- [x] Proyecto Next.js + TypeScript + Tailwind inicializado
- [x] Dependencias de Supabase, Resend, QR instaladas
- [x] `supabase/schema.sql` — schema completo (eventos, mesas VIP, sillas, reservas, tickets, accesos, roles)
- [x] Helpers de conexión a Supabase (`src/lib/supabase/`) y generación segura de QR (`src/lib/qr.ts`)
- [ ] Credenciales reales conectadas (bloqueado hasta que existan las cuentas)
- [ ] Páginas de la app (login, ventas, finanzas, acceso) — se construyen en cuanto haya credenciales para probar contra datos reales
- [ ] Despliegue en Vercel
- [ ] Prueba end-to-end

## Qué necesito de Anita para continuar

1. **Supabase**: crear proyecto → Project Settings → API → copiar `Project URL`, `anon public key`, `service_role key` (esta última nunca se sube a GitHub, solo se guarda como variable de entorno en Vercel)
2. **Resend**: crear cuenta → API Keys → generar una → copiar el valor (empieza con `re_`)
3. **GitHub**: crear un repositorio vacío (privado) → dar acceso o generar un Personal Access Token de solo ese repo para poder subir el código desde aquí
4. **Vercel**: conectar el repositorio de GitHub cuando ya tenga código — el despliegue automático se activa solo

## Nota de seguridad

Ninguna de estas claves debe compartirse por WhatsApp en texto plano si se puede evitar — mejor un gestor de contraseñas o el chat directo aquí. La `service_role key` de Supabase se salta todos los permisos (RLS) — trátala como una contraseña maestra.
