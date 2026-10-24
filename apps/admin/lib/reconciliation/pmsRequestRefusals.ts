// Les refus MÉTIER que rend admin_resolve_pms_booking_request (`{ ok:false, reason }`, jamais une
// exception) → le texte que l'admin lit. Sans cette table, chaque refus tombait sur « No se pudo
// procesar la solicitud », et l'admin ne savait pas s'il avait mal recopié un numéro de booking ou si
// la demande avait déjà été traitée par un collègue. `pmsRequestRefusals.contract.test.ts` verrouille
// chaque code sur la migration qui le rend.
export const REFUS_PMS_PAR_RAISON: Readonly<Record<string, string>> = {
  request_not_found: "La solicitud ya no existe.",
  not_resolvable: "Esta solicitud ya fue procesada o sigue en curso. Recarga la página para ver su estado.",
  invalid_bookings: "El ID de la reserva en Lobby debe contener solo números.",
  line_not_in_order: "Una de las líneas no pertenece a esta orden.",
  already_booked: "Una de las líneas ya tiene otra reserva de Lobby asociada: no se sobrescribe.",
  line_not_reserved: "Una de las líneas ya no está reservada (anulada o expirada).",
  line_not_pms: "Una de las líneas no está vinculada a Lobby.",
  booking_in_use: "Ese ID de reserva ya está asociado a otra orden del mismo establecimiento. Revisa el número.",
};

/** Le texte d'un refus rendu par la RPC, ou `null` quand `data` n'est pas un refus connu. */
export function pmsRefusalMessage(data: unknown): string | null {
  const reason = (data as { reason?: unknown } | null)?.reason;
  if (typeof reason !== "string" || !Object.hasOwn(REFUS_PMS_PAR_RAISON, reason)) return null;
  return REFUS_PMS_PAR_RAISON[reason];
}
