// Código corto y legible de una compra: los 8 primeros caracteres del
// grupo_id (UUID). Va en el asunto de los correos, en "Mis entradas" y en
// Finanzas cuando hace falta nombrar la compra sin pegar un UUID entero.
// Gmail agrupa por asunto + remitente: con el código, dos compras distintas
// del mismo comprador son dos conversaciones (antes la vieja quedaba
// colapsada bajo la nueva); un reenvío de la MISMA compra sí se agrupa.
export function codigoCompra(grupoId: string) {
  return grupoId.replace(/-/g, "").slice(0, 8).toUpperCase();
}
