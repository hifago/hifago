// Ce qu'un écran d'édition dit quand la base refuse de modifier un produit qui porte des réservations
// en cours. Deux triggers sur `products`, une seule traduction pour la fiche admin (product-form)
// et l'écran de modération (ModerateProposalForm) :
//   - products_occurrence_change_guard (migration 20261014204354, HF002) : la nouvelle date ou
//     récurrence d'un evento laisserait des réservations hors de ses dates. Le DÉTAIL de l'erreur
//     (nombre de réservations, dates) est rédigé en espagnol par la base : il est affiché tel quel ;
//   - products_capacity_flags_frozen : connexion LobbyPMS, mode de cupo et ocupación del recurso
//     restent gelés (la date et la récurrence n'en relèvent plus), et le mode de prix (spec 43) ;
//   - per_hour_requires_hourly_slots (spec 43) : passer à l'heure une activité aux horaires ≠ 60 min.
// null : aucun de ces refus — l'écran garde son message générique.

type RpcError = { code?: string; message?: string; details?: string | null } | null | undefined;

export function eventoChangeRefusal(error: RpcError): string | null {
  if (!error) return null;
  if (error.code === "HF002" || error.message?.includes("occurrence_change_orphans_reservations")) {
    if (!error.details) {
      return "No se puede guardar el cambio de fecha: algunas reservas en curso quedarían fuera de las nuevas fechas.";
    }
    // Plus de dix dates : la base termine la liste par « … », sans point derrière.
    return `No se puede guardar el cambio de fecha — ${error.details}${error.details.endsWith("…") ? "" : "."}`;
  }
  if (error.message?.includes("capacity_flags_frozen_while_reserved")) {
    return "Este producto tiene reservas en curso: su conexión con LobbyPMS, su modo de cupo, su ocupación del recurso compartido y su modo de precio no pueden cambiar hasta que se realicen o se cancelen.";
  }
  // Spec 43 (migration 20261025140000) : une activité à l'heure n'a que des horaires de 60 minutes.
  if (error.message?.includes("per_hour_requires_hourly_slots")) {
    return "Una actividad por hora solo admite horarios en franjas de 60 minutos: cambia primero sus horarios.";
  }
  return null;
}
