// Promu depuis pms-nightly-contract-check le 2026-08-28 : le job savait déjà rapporter un corps
// d'erreur, le chemin de réservation non — c'est exactement l'asymétrie qui a rendu la panne du
// 2026-08-28 indiagnosticable pendant une heure.
//
// Un 403 de Caddy (relais : en-tête X-Relay-Secret refusé, corps « forbidden ») et un 403 de
// LobbyPMS (IP non whitelistée, corps JSON) sont INDISCERNABLES quand on ne rapporte que le statut.
// Le corps tranche en un coup d'œil, et il ne coûte rien : il est déjà lu et parsé par lobbyCall.
//
// SÛRETÉ : on n'imprime QUE le corps de la RÉPONSE. Jamais l'URL de la requête — elle porte
// `api_token` en query string (hifago/CLAUDE.md §8). Tronqué court : un corps d'erreur utile tient
// en deux lignes, et une page HTML d'erreur d'un proxy amont n'a pas à noyer les logs.
//
// `redact` (jobs, P6) : masque les secrets AVANT la coupe à 200 caractères — un jeton à cheval sur la
// coupure n'est plus présent en entier, et échapperait au masquage par valeur exacte.
export function describeLobbyErrorBody(body: unknown, redact?: (text: string) => string): string {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  if (!raw) return "corps vide";
  const text = redact ? redact(raw) : raw;
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
