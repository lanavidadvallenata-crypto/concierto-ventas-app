"use server";

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/perfil";
import { crearMarcaIngreso } from "@/lib/marca-ingreso";

// Marca el ticket como usado. Es la ÚNICA escritura de la puerta y solo
// ocurre con el toque en "DEJAR ENTRAR" — nunca al abrir el enlace.
//
// Por qué: el 21 sep, en la prueba real con iPhone, la cámara abrió el enlace
// del QR DOS veces en menos de un segundo (07:14:56.859 y 07:14:57.652). Con
// la validación en el GET, la primera carga marcaba el ticket y la segunda —
// la única que la persona llegaba a ver — salía "YA VALIDADO". Cualquier
// navegador o app que precargue enlaces produce lo mismo. Con el toque
// explícito da igual cuántas veces se cargue la página.
export async function registrarIngreso(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) redirect("/acceso");

  const perfil = await getPerfilActual();
  if (!perfil || (perfil.rol !== "acceso" && perfil.rol !== "admin")) redirect(`/acceso/${token}`);

  const service = createServiceClient();

  // Update atómico: solo una petición puede pasar de qr_usado=false a true.
  const { data: marcado, error } = await service
    .from("tickets")
    .update({ qr_usado: true, qr_usado_en: new Date().toISOString(), qr_usado_por: perfil.id })
    .eq("qr_token", token)
    .eq("qr_usado", false)
    .eq("estado_pago", "verificado")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Error registrando ingreso:", error.message);
    redirect(`/acceso/${token}?error=1`);
  }

  if (marcado) {
    await service.from("accesos").insert({ ticket_id: marcado.id, resultado: "valido", escaneado_por: perfil.id });
    // Solo ESTE teléfono verá el verde (ver src/lib/marca-ingreso.ts).
    redirect(`/acceso/${token}?ok=${crearMarcaIngreso(token)}`);
  }

  // No se marcó: otro teléfono lo registró entre que se abrió la pantalla y
  // el toque (o dejó de estar verificado). La página lo muestra en ROJO.
  redirect(`/acceso/${token}?repetido=1`);
}
