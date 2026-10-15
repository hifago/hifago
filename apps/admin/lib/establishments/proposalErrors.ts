// Motifs de refus communs aux RPC de proposition d'un établissement — dépôt (création, édition)
// et approbation (moderate_establishment_proposal), qui partagent la même validation depuis la
// migration 20261015004421 (establishment_proposal_details). Un seul libellé par motif, pour que
// le partenaire et l'admin lisent la même chose.
import { CONTACT_PHONE_FORMAT_MESSAGE } from "@/lib/establishments/contactPhone";

export const ESTABLISHMENT_PROPOSAL_ERRORS: Record<string, string> = {
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
  name_required: "El nombre es obligatorio.",
  pending_cap_exceeded:
    "Ya tienes 10 propuestas pendientes. Espera a que se revisen antes de enviar más.",
  invalid_phone: CONTACT_PHONE_FORMAT_MESSAGE,
  invalid_time: "Las horas de check-in y check-out deben tener el formato HH:MM.",
  invalid_mode: "La forma de venta del alojamiento no es válida.",
  stay_incomplete: "Check-in, check-out y forma de venta se envían juntos. Vuelve a intentarlo.",
  place_has_no_stay_mode: "Un lugar no puede venderse como alojamiento.",
};
