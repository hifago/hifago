import type { SupabaseClient } from "@supabase/supabase-js";

export type MfaGuardResult = { action: "none" } | { action: "verify" };

// Feature 31 (docs/specs/07-connexion-inscription-complete.md §8/§10) — le 2FA est un CHOIX : jamais
// d'enrôlement forcé (décision du 2026-08-15, confirmée le 2026-10-30), mais qui l'a activé doit le
// passer à CHAQUE connexion, mot de passe comme Google. Appelé depuis app/auth/callback/route.ts,
// app/admin/layout.tsx, app/partner/(app)/layout.tsx et app/page.tsx.
//
// ⚠️ À appeler AVANT tout contrôle is_admin() : depuis 20261030090000_admin_2fa_si_active.sql,
// is_admin() est faux pour un admin enrôlé tant que sa session est en AAL1. Sans ce garde en amont,
// il serait renvoyé à `/` (qui le renvoie sur /admin) en boucle au lieu d'atteindre /mfa/verify.
//
// nextLevel === 'aal2' && currentLevel === 'aal1' : un facteur VÉRIFIÉ existe mais n'a pas encore
// été prouvé pour CETTE session. Un facteur resté `unverified` (enrôlement abandonné) ne fait pas
// monter nextLevel : il ne bloque donc jamais personne.
export async function checkMfaGuard(supabase: SupabaseClient): Promise<MfaGuardResult> {
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel === "aal1") return { action: "verify" };
  return { action: "none" };
}
