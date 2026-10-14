import type { SupabaseClient } from "@supabase/supabase-js";

export type MfaGuardResult =
  | { action: "none" }
  | { action: "enroll" }
  | { action: "verify" };

// Feature 31 (docs/specs/07-connexion-inscription-complete.md §8) — le 2FA admin se déclenche à la
// connexion elle-même, pas seulement à l'entrée d'un module : appelé depuis app/admin/layout.tsx
// ET app/partner/(app)/layout.tsx. has_admin_capability (pas is_admin, volontairement gelé à false
// tant que l'AAL2 n'est pas atteinte, cf. migration 20260815250000_admin_2fa_aal2.sql) décide si ce
// compte est concerné ; getAuthenticatorAssuranceLevel() décide où l'envoyer.
export async function checkMfaGuard(supabase: SupabaseClient): Promise<MfaGuardResult> {
  const { data: hasAdminCapability } = await supabase.rpc("has_admin_capability");
  if (!hasAdminCapability) return { action: "none" };

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal) return { action: "none" };

  // nextLevel === 'aal1' : aucun facteur enrôlé, l'AAL2 n'est même pas atteignable — enrôlement
  // obligatoire. nextLevel === 'aal2' && currentLevel === 'aal1' : un facteur existe déjà mais pas
  // encore vérifié pour CETTE session — simple vérification, pas un nouvel enrôlement.
  if (aal.nextLevel === "aal1") return { action: "enroll" };
  if (aal.nextLevel === "aal2" && aal.currentLevel === "aal1") return { action: "verify" };
  return { action: "none" };
}
