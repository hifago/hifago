// Un identifiant reçu de l'extérieur (segment d'URL, corps de requête) qui n'est pas un UUID est
// refusé AVANT toute lecture : PostgREST rejetterait la requête en erreur (22P02), que les pages et
// les routes lisent désormais — à raison — comme une panne. Une faute de saisie doit rester un
// « introuvable » ou un 400, jamais un écran d'erreur ni un 503 (2026-10-02).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
