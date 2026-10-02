import type { SupabaseClient } from "@supabase/supabase-js";

// Extrait le 2026-08-19 — reservations/page.tsx et page.tsx (accueil socio, spec 20) dérivaient
// chacun séparément « les établissements que CE partenaire opère activement » (role "operator",
// status "active") : reservations/page.tsx via une requête SQL déjà filtrée (`.eq("role",
// "operator").eq("status","active")`), page.tsx via un fetch de TOUTES les capacités (nécessaire
// là-bas pour la carte de statut, qui affiche aussi les rôles/statuts non-operator/non-active) puis
// un filtre JS équivalent. Deux implémentations de la même règle métier, un seul endroit maintenant.
export type PartnerCapabilityForFilter = {
  role: string;
  status: string;
  establishment_id: string | null;
};

// Prédicat + projection partagés — page.tsx a déjà les lignes non filtrées en mémoire (carte de
// statut), donc pas de requête supplémentaire à lui faire refaire : il appelle directement cette
// fonction pure sur les lignes qu'il a déjà.
export function selectActiveOperatorEstablishmentIds(
  capabilities: PartnerCapabilityForFilter[]
): string[] {
  return capabilities
    .filter((row) => row.role === "operator" && row.status === "active")
    .map((row) => row.establishment_id)
    .filter((id): id is string => Boolean(id));
}

// Distinct de selectActiveOperatorEstablishmentIds ci-dessus : ce prédicat sert à décider un ACCÈS
// (nav + gardes des layouts établissement/produits/réservations, refonte vue référent 2026-08-20),
// pas à scoper des DONNÉES — un opérateur suspendu doit toujours pouvoir consulter/comprendre sa
// situation (établissement, réservations passées), ce n'est pas un référent pur. `status` n'est
// donc volontairement pas filtré ici, contrairement à selectActiveOperatorEstablishmentIds.
export function hasOperatorCapability(capabilities: PartnerCapabilityForFilter[]): boolean {
  return capabilities.some((row) => row.role === "operator");
}

// Fetch + hasOperatorCapability en un seul appel — extrait le 2026-08-20 (refonte vue référent) :
// `partner_capabilities.select("role, status, establishment_id").eq("partner_id", partnerId)` puis
// hasOperatorCapability(...) étaient recopiés verbatim dans partner/(app)/layout.tsx et les 3
// gardes establishment/products/reservations, le jour même où ce dépôt a déjà fixé une fois cette
// exacte classe de duplication pour partnerId/isAdmin (cf. lib/partnerGuard.ts,
// requirePartnerOrAdmin, extrait le 2026-08-18).
export async function getOperatorCapability(
  supabase: SupabaseClient,
  partnerId: string | null
): Promise<boolean> {
  if (!partnerId) return false;

  // Échec fermé (2026-10-01) : une panne LÈVE (app/error.tsx). Lue comme « pas operator », elle
  // renvoyait un operator sur /partner depuis les gardes et amputait sa nav.
  const { data: capabilities, error } = await supabase
    .from("partner_capabilities")
    .select("role, status, establishment_id")
    .eq("partner_id", partnerId);
  if (error) {
    throw new Error(`Lecture des capacités impossible (partner_capabilities) : ${error.message}`);
  }

  return hasOperatorCapability(capabilities ?? []);
}

// reservations/page.tsx n'a besoin QUE des établissements opérés (jamais des lignes non filtrées) —
// requête filtrée côté serveur directement, même règle métier que
// selectActiveOperatorEstablishmentIds ci-dessus, traduite en `.eq(...)` plutôt qu'un filtre JS
// après un fetch complet.
export async function getActiveOperatorEstablishmentIds(
  supabase: SupabaseClient,
  partnerId: string | null
): Promise<string[]> {
  if (!partnerId) return [];

  // Même règle : une panne lève, jamais « aucun établissement » (liste de réservations vide).
  const { data, error } = await supabase
    .from("partner_capabilities")
    .select("establishment_id")
    .eq("partner_id", partnerId)
    .eq("role", "operator")
    .eq("status", "active");
  if (error) {
    throw new Error(`Lecture des établissements opérés impossible (partner_capabilities) : ${error.message}`);
  }

  return (data ?? [])
    .map((c) => c.establishment_id as string | null)
    .filter((id): id is string => Boolean(id));
}
