import type { Json } from "@hifago/supabase/database.types";
import type { EstablishmentFieldsState } from "@/lib/establishments/useEstablishmentFieldsState";

// Extrait le 2026-09-17 (revue de packaging admin) — `buildDescription()` était réimplémenté à
// l'identique dans NewEstablishmentForm.tsx ET EstablishmentEditBlock.tsx, prêt à diverger comme
// productCreationPayload.ts/productEditPayload.ts avant leur dédoublonnage (chantier du même jour).
//
// Signatures RPC vérifiées contre la base locale (`pg_get_functiondef`) avant d'écrire cette
// fonction, pas supposées : `create_establishment(p_partner_id, p_name, p_description, p_address,
// p_lat, p_lon, p_operated_directly)` et `update_establishment(p_establishment_id, p_name,
// p_description, p_address, p_lat, p_lon, p_operated_directly, p_note)` partagent EXACTEMENT les 6
// paramètres ci-dessous — seuls `p_partner_id` (création) et `p_establishment_id`/`p_note`
// (édition) restent propres à chaque RPC, ajoutés par l'appelant.
export function buildEstablishmentRpcParams(
  nombre: string,
  fields: EstablishmentFieldsState,
): {
  p_name: Json;
  p_description: Json | undefined;
  p_address: string | undefined;
  p_lat: number | undefined;
  p_lon: number | undefined;
  p_operated_directly: boolean;
} {
  const es = fields.descriptionEs.trim();
  const en = fields.descriptionEn.trim();
  let description: Json | undefined;
  if (es || en) {
    const value: { [key: string]: Json } = {};
    if (es) value.es = es;
    if (en) value.en = en;
    description = value;
  }

  return {
    // name reste jsonb multilingue en base (même pattern que products.name), mais le formulaire
    // n'expose qu'un seul champ : un nom d'établissement est un nom propre, généralement pas
    // traduit (décision Jérôme, spec 03 §3). Le repli de resolveLocalizedField renvoie déjà cette
    // valeur pour un lecteur EN en l'absence de clé "en".
    p_name: { es: nombre.trim() },
    p_description: description,
    p_address: fields.address.trim() || undefined,
    p_lat: fields.lat.trim() ? Number(fields.lat) : undefined,
    p_lon: fields.lon.trim() ? Number(fields.lon) : undefined,
    p_operated_directly: fields.operatedDirectly,
  };
}

/**
 * Champs de présentation d'une PROPOSITION du partenaire (création ou édition) — mêmes règles que
 * buildEstablishmentRpcParams ci-dessus, sous la forme du payload jsonb que lisent
 * submit_establishment_creation_proposal / submit_establishment_edit_proposal. Jamais
 * `operated_directly` : classification de plateforme, jamais proposable (spec 06 §3).
 */
export function buildEstablishmentProposalFields(
  nombre: string,
  fields: EstablishmentFieldsState,
): { name: Json; description: Json | null; address: string | null; lat: number | null; lon: number | null } {
  const params = buildEstablishmentRpcParams(nombre, fields);
  return {
    name: params.p_name,
    description: params.p_description ?? null,
    address: params.p_address ?? null,
    lat: params.p_lat ?? null,
    lon: params.p_lon ?? null,
  };
}
