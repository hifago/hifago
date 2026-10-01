import { createClient } from "@hifago/supabase/server";
import { getViewerAccount } from "@/lib/auth/viewer";

// Spec 35 — la lecture du profil de `/cuenta/perfil`. `full_name`/`phone` existent DÉJÀ sur
// `partner_accounts` depuis le 2026-08-19 (écran socio `apps/admin`) : rien n'est créé ici, cette
// couche ne fait que les lire pour la vitrine. RLS directe (`partner_accounts_select`, propre
// compte) — aucun bypass nécessaire, contrairement à l'écriture (`update_my_account_profile`).
//
// ⚠️ `hasProfessionalCapability` EST le même prédicat que la garde en base de `delete_my_account()`
// (spec 35, migration 20260911140000) — lu ici en RLS directe plutôt que par un aller-retour RPC,
// pour DÉSACTIVER le bouton de suppression avant même que le client clique, jamais seulement après
// un refus. `partner_capabilities_select` (20260813163456) rend visibles exactement les mêmes
// lignes que la garde vérifie : `account_id = auth.uid()` (admin) OU `partner_id =
// partner_id_for_account(auth.uid())` (référent/opérateur, portée par l'organisation, jamais par
// le compte — cf. le commentaire de la migration). Un simple `select` scopé à SA PROPRE session
// suffit donc à répondre « ce compte a-t-il une capacité, quel que soit son statut ? ».

export type MyProfile = {
  email: string;
  fullName: string;
  phone: string;
  hasProfessionalCapability: boolean;
};

/**
 * Isolée pour être appelée aussi depuis `pago/page.tsx` (repli de pré-remplissage, décision ⑦
 * spec 35) sans passer par `getMyProfile()` : ce dernier appelle `getViewerAccount()`, donc un
 * second `auth.getUser()` — un aller-retour réseau réel, pas un cache — alors que `pago/page.tsx` a
 * déjà SON `user` et gère lui-même l'invité (`if (user)`, anonyme compris), une garde différente de
 * `getViewerAccount()` (`isRealAccount` strict). Un client déjà créé, un id déjà connu : jamais un
 * second appel à `createClient()`/`getUser()` pour la même donnée.
 */
export async function getPartnerAccountProfileFields(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string
): Promise<{ fullName: string; phone: string }> {
  const { data, error } = await supabase
    .from("partner_accounts")
    .select("full_name, phone")
    .eq("id", accountId)
    .maybeSingle();
  // Un profil illisible n'est jamais un profil vide : sur `/cuenta/perfil`, des champs vides
  // enregistrés écraseraient le vrai profil ; sur `/pago`, un nom vide y signifie « jamais édité »
  // et ferait retomber sur une ancienne commande. L'erreur lève, l'écran d'erreur de la zone suit.
  if (error) throw error;
  return { fullName: data?.full_name ?? "", phone: data?.phone ?? "" };
}

export async function getMyProfile(): Promise<MyProfile | null> {
  const viewer = await getViewerAccount();
  if (!viewer) {
    return null;
  }

  const supabase = await createClient();
  const [{ fullName, phone }, { data: capacites, error: erreurCapacites }] = await Promise.all([
    getPartnerAccountProfileFields(supabase, viewer.id),
    supabase.from("partner_capabilities").select("role").limit(1),
  ]);
  // Même règle : sur une panne, « aucune capacité » réactiverait à tort le bouton de suppression.
  if (erreurCapacites) throw erreurCapacites;

  return {
    email: viewer.email,
    fullName,
    phone,
    hasProfessionalCapability: Boolean(capacites && capacites.length > 0),
  };
}
