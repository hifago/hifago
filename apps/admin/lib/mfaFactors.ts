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

// Le navigateur lève `NotAllowedError` quand la personne ferme la fenêtre de la clé, ne la présente pas
// ou laisse le délai expirer ; le SDK la rend en `ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY` (la cause
// porte le nom). `ERROR_CEREMONY_ABORTED` n'existe que si on passe un `signal` d'annulation — ce que
// l'interface ne fait pas — mais reste reconnu. Ce n'est pas une panne : on ne l'annonce pas comme telle.
export function isCancelledCeremony(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: { name?: unknown } | null };
  return (
    code === "ERROR_CEREMONY_ABORTED" ||
    (code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" && cause?.name === "NotAllowedError")
  );
}

// GoTrue refuse deux facteurs de même nom pour un compte, y compris vide (422
// mfa_factor_name_conflict). Le premier TOTP reste sans nom (l'app d'authentification affiche alors
// l'e-mail) ; tout facteur suivant, et toute clé de sécurité (nom obligatoire), en reçoit un unique.
export function uniqueFactorName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}

// Un enrôlement abandonné (onglet fermé, clé non présentée) laisse un facteur `unverified` : sans
// purge ils s'accumulent jusqu'à `max_enrolled_factors` (config.toml) et l'enrôlement échoue. Renvoie
// les facteurs listés. Une LECTURE en échec lève : une panne n'est jamais une absence (ici, elle ferait
// croire qu'aucun facteur vérifié n'existe et nommerait le suivant de travers) ; l'appelant l'affiche.
// Le retrait d'un facteur abandonné, lui, reste au mieux : le rater ne bloque pas l'enrôlement.
export async function purgeUnverifiedFactors(supabase: SupabaseClient) {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) {
    throw new Error(`Lecture des facteurs impossible : ${error?.message ?? "réponse vide"}`);
  }
  for (const factor of data.all) {
    if (factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  return data.all;
}
