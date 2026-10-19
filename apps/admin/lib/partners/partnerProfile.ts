import type { CommercialStatus } from "./crmProfile";

// Fiche admin d'un socio — l'état éditable de « Identidad y contacto » et le calcul de ce qui part
// vers admin_update_partner_profile (20261019160000). Seuls les champs MODIFIÉS partent : un autre
// admin qui a changé un autre champ entre-temps n'est pas écrasé par une valeur relue plus tôt.

export const PARTNER_TEXT_FIELDS = [
  "display_name",
  "legal_name",
  "identification_type",
  "identification_number",
  "partner_city",
  "email",
  "phone",
  "instagram",
  "facebook",
  "website",
  "barrio",
  "notes",
] as const;

export type PartnerTextField = (typeof PARTNER_TEXT_FIELDS)[number];

export type PartnerProfile = Record<PartnerTextField, string> & {
  commercial_status: CommercialStatus;
  /** Saisie libre, séparées par des virgules. */
  tags: string;
};

/**
 * Le moyen de paiement n'est jamais relu en clair (seul son résumé atteint le navigateur) : on le
 * garde, on le remplace en entier, ou on l'efface.
 */
export type BankDraft =
  | { action: "keep" }
  | { action: "remove" }
  | { action: "bancolombia"; nombre: string; numeroCuenta: string; tipoCuenta: string }
  | { action: "nequi"; nombre: string; telefono: string };

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export function parseTags(input: string): string[] {
  const tags: string[] = [];
  for (const raw of input.split(",")) {
    const tag = raw.trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** `p_changes` pour admin_update_partner_profile — objet vide si rien n'a changé. */
export function buildProfileChanges(
  initial: PartnerProfile,
  draft: PartnerProfile,
  bank: BankDraft,
): { [key: string]: Json } {
  const changes: { [key: string]: Json } = {};

  for (const field of PARTNER_TEXT_FIELDS) {
    const before = initial[field].trim();
    const after = draft[field].trim();
    if (after !== before) changes[field] = after === "" ? null : after;
  }

  if (draft.commercial_status !== initial.commercial_status) {
    changes.commercial_status = draft.commercial_status;
  }

  const tagsBefore = parseTags(initial.tags);
  const tagsAfter = parseTags(draft.tags);
  if (tagsAfter.join("\u0000") !== tagsBefore.join("\u0000")) changes.tags = tagsAfter;

  if (bank.action === "remove") {
    changes.bank = null;
  } else if (bank.action === "bancolombia") {
    changes.bank = {
      nombre: bank.nombre.trim(),
      bancolombia: { numero_cuenta: bank.numeroCuenta.trim(), tipo_cuenta: bank.tipoCuenta.trim() },
    };
  } else if (bank.action === "nequi") {
    changes.bank = { nombre: bank.nombre.trim(), nequi: { telefono: bank.telefono.trim() } };
  }

  return changes;
}

/** Lien cliquable d'un réseau saisi en texte libre (@pseudo, nom de page ou URL), ou null. */
export function socialHref(network: "instagram" | "facebook" | "website", value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (network === "website") return /\s/.test(v) ? null : `https://${v}`;
  // Pseudo seul : « @casa.kayam » ou « casa.kayam ». Un domaine collé sans schéma reste un lien.
  if (/^(www\.)?(instagram|facebook|fb)\.com\//i.test(v)) return `https://${v}`;
  const handle = v.replace(/^@/, "");
  if (!/^[\w.]+$/.test(handle)) return null;
  return network === "instagram"
    ? `https://instagram.com/${handle}`
    : `https://facebook.com/${handle}`;
}
