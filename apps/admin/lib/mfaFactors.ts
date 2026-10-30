import type { SupabaseClient } from "@supabase/supabase-js";

// Facteurs MFA affichés par la modale « Seguridad » (components/security-dialog.tsx) et par l'écran de
// défi (app/mfa/verify/page.tsx) : mêmes libellés des deux côtés, pour que la personne reconnaisse
// son appareil d'un écran à l'autre. Module sans « use client » : il est importé par un Server
// Component ET par des composants client, donc il n'importe rien de client.
export type MfaFactorKind = "totp" | "webauthn";

type FactorLike = { id: string; factor_type: string };

const LABELS: Record<MfaFactorKind, string> = {
  totp: "App de autenticación",
  webauthn: "Llave de seguridad",
};

export function isSupportedFactorKind(type: string): type is MfaFactorKind {
  return type === "totp" || type === "webauthn";
}

// « App de autenticación 1 », « Llave de seguridad 1 », « App de autenticación 2 »… numérotés PAR
// TYPE, dans l'ordre reçu (l'appelant passe les plus anciens d'abord : la numérotation ne bouge pas
// quand on en ajoute un).
export function factorLabels(factors: FactorLike[]): Map<string, string> {
  const seen: Record<string, number> = {};
  const labels = new Map<string, string>();
  for (const factor of factors) {
    if (!isSupportedFactorKind(factor.factor_type)) continue;
    seen[factor.factor_type] = (seen[factor.factor_type] ?? 0) + 1;
    labels.set(factor.id, `${LABELS[factor.factor_type]} ${seen[factor.factor_type]}`);
  }
  return labels;
}

// GoTrue refuse deux facteurs de même nom pour un compte, y compris vide (422
// mfa_factor_name_conflict). Le premier TOTP reste sans nom (l'app d'authentification affiche alors
// l'e-mail) ; tout facteur suivant, et toute clé de sécurité (nom obligatoire), en reçoit un unique.
export function uniqueFactorName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}

// Un enrôlement abandonné (onglet fermé, clé non présentée) laisse un facteur `unverified` : sans
// purge ils s'accumulent jusqu'à `max_enrolled_factors` (config.toml) et l'enrôlement échoue. Best
// effort : un échec ici ne doit jamais bloquer l'enrôlement qui suit. Renvoie les facteurs listés.
export async function purgeUnverifiedFactors(supabase: SupabaseClient) {
  const { data } = await supabase.auth.mfa.listFactors();
  const all = data?.all ?? [];
  for (const factor of all) {
    if (factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  return all;
}
