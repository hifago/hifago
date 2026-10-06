// Ce qu'une réponse LobbyPMS PROUVE sur un booking — décidé sur le statut ET le corps, jamais sur le
// statut seul. Chez Lobby, un même statut recouvre des réalités opposées (journal 2026-08 et 09) :
//   - GET /api/v1/bookings/{id} en 404 avec le corps Laravel « No query results for model
//     [App\Models\Booking]. » : le booking n'existe plus (annulé par API — forme documentée et
//     reproduite par la fixture) ;
//   - un 404 `{"error":"Resource Not Found."}` est le 404 de ROUTAGE de Lobby (URI inconnue, ou
//     requête altérée par le relais : incident du 19/09). Il ne dit RIEN du booking ; le lire comme
//     « disparu » aurait annulé toutes les lignes interrogées pendant la panne ;
//   - « déjà annulé » à l'ANNULATION se lit au code d'erreur `RECORD_NOT_FOUND` (observé le 27/08 sur
//     le booking 21635340 ; documenté « booking_id was not found »). Son STATUT, lui, n'a jamais été
//     consigné (422 comme les autres codes métier, ou 404) : c'est le code qui fait foi, sous 404 ou
//     422 — le 404 de routage, lui, n'a pas d'`error_code`.
// Tout le reste — autre 404, 401, 403 (relais ou IP), 5xx, HTML — est un échec PASSAGER : on ne
// conclut rien, on réessaie plus tard.

const LARAVEL_BOOKING_NOT_FOUND = /^No query results for model \[App\\Models\\Booking\]/;

/** GET d'un booking : la réponse prouve-t-elle que ce booking n'existe plus chez Lobby ? */
export function isLobbyBookingGone(status: number, body: unknown): boolean {
  if (status !== 404 || typeof body !== "object" || body === null) return false;
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" && LARAVEL_BOOKING_NOT_FOUND.test(message);
}

/** Annulation d'un booking : la réponse prouve-t-elle qu'il était déjà annulé (objectif atteint) ? */
export function isLobbyCancelAlreadyDone(status: number, body: unknown): boolean {
  if ((status !== 422 && status !== 404) || typeof body !== "object" || body === null) return false;
  return (body as { error_code?: unknown }).error_code === "RECORD_NOT_FOUND";
}

/** `estatus` observés (lobby_pms_api.md) : réservation confirmée, séjour terminé. */
const KNOWN_LOBBY_ESTATUS = new Set(["completo", "fin"]);

/**
 * Un booking que Lobby RENVOIE (200) dans un état qu'aucune règle n'explique : supprimé logiquement
 * (`deleted_at` posé) ou un `estatus` jamais observé. Ce que renvoie une annulation faite par le
 * staff dans l'interface Lobby n'a jamais été observé : c'est un signal pour une vérification
 * manuelle, JAMAIS une annulation automatique — et jamais un signal de réalisation (seul
 * `checkout_realizado` l'est). Rend une description courte, ou null.
 */
export function describeUnexpectedLobbyBooking(data: Record<string, unknown>): string | null {
  const signals: string[] = [];
  if (data.deleted_at !== null && data.deleted_at !== undefined) signals.push("deleted_at posé");
  const estatus = data.estatus;
  if (typeof estatus === "string" && !KNOWN_LOBBY_ESTATUS.has(estatus)) {
    signals.push(`estatus « ${estatus.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 30)} »`);
  }
  return signals.length > 0 ? signals.join(", ") : null;
}
