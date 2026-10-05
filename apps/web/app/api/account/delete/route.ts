import { NextResponse } from "next/server";
import { createClient } from "@hifago/supabase/server";
import { createServiceRoleClient } from "@hifago/supabase/service";
import { isRealAccount } from "@hifago/supabase/identity";

// Spec 35 Tranche 4 — suppression de compte, côté serveur (entretien Jérôme 2026-09-11).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// POURQUOI DEUX APPELS, ET DANS CET ORDRE-LÀ
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. `delete_my_account()` — avec la session DU CLIENT, jamais service_role : c'est `auth.uid()`
//    qui identifie le compte à anonymiser, et c'est la RPC elle-même qui porte les gardes (invité,
//    compte professionnel). L'appeler en service_role viderait `auth.uid()` et casserait sa garde.
// 2. L'API Admin, en service_role, pour neutraliser l'identité de connexion (`auth.users`) —
//    JAMAIS du SQL sur le schéma `auth`, qui appartient à `supabase_auth_admin` : `insert` y est
//    déjà confirmé refusé sur Supabase Cloud (2026-08-21) et le job de purge porte le même risque
//    non vérifié pour son `delete`. L'API Admin est le chemin officiellement supporté.
//
// ⚠️ L'ORDRE N'EST PAS ARBITRAIRE. Si l'étape 2 échoue après une étape 1 réussie, le client garde
// un compte fonctionnel dont seuls le nom et le téléphone sont effacés : il peut se reconnecter et
// RETENTER. L'ordre inverse produirait le pire état possible — plus aucun moyen de se connecter,
// donc plus aucun moyen de relancer la suppression, et un profil resté en base. On choisit la
// panne qui reste réparable par l'utilisateur lui-même.
//
// ⚠️ VÉRIFIÉ EN RÉEL sur la stack locale le 2026-09-11 : changer l'email par l'API Admin met aussi
// à jour `auth.identities` (l'ancien email n'y survit pas), et une NOUVELLE inscription avec
// l'ancien email est acceptée — ce qui est la décision ⑤ (« l'email redevient utilisable »).
// Non re-vérifié sur Cloud, mais le risque est d'une autre nature que celui du SQL direct : même
// API REST GoTrue des deux côtés.

/** `.invalid` est réservé par la RFC 2606 : ce domaine ne peut appartenir à personne, donc l'adresse
 *  ne peut jamais atteindre une vraie boîte ni entrer en collision avec un futur inscrit. */
function adresseNeutralisee(userId: string) {
  return `deleted+${userId}@hifago.invalid`;
}

/** Rend la connexion impossible sans jamais stocker ni journaliser de secret lisible. */
function motDePasseAleatoire() {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // `isRealAccount`, jamais `Boolean(user)` : depuis la spec 31 un invité A une identité.
  if (!isRealAccount(user) || !user?.email) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  // REJOUABLE (2026-10-05). Si la réponse d'une suppression RÉUSSIE s'est perdue (réseau, onglet
  // fermé), le client retente avec l'email d'origine : la session voit déjà l'adresse neutralisée,
  // et la comparaison ci-dessous bouclait sur `email_mismatch` sans fin. Une session valide portant
  // l'adresse neutralisée de CE compte ne peut venir que d'une suppression déjà menée à son terme
  // (la connexion y est impossible : le mot de passe a été remplacé) — on le dit, sans rien rejouer.
  // L'échec de l'étape 2 (`auth_update_failed`) est, lui, déjà rejouable tel quel :
  // `delete_my_account` réanonymise sans erreur un profil déjà vidé.
  if (user.email.trim().toLowerCase() === adresseNeutralisee(user.id)) {
    return NextResponse.json({ ok: true });
  }

  // La confirmation par email retapé (décision ④) est vérifiée ICI, côté serveur. La vérifier
  // seulement dans l'écran en ferait une décoration : ce qui protège un geste irréversible, c'est
  // le contrôle que l'appelant ne peut pas contourner.
  let saisie: unknown;
  try {
    saisie = (await request.json())?.email;
  } catch {
    saisie = undefined;
  }
  const normaliser = (valeur: string) => valeur.trim().toLowerCase();
  if (typeof saisie !== "string" || normaliser(saisie) !== normaliser(user.email)) {
    return NextResponse.json({ ok: false, reason: "email_mismatch" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("delete_my_account");
  if (error) {
    return NextResponse.json({ ok: false, reason: "rpc_failed" }, { status: 500 });
  }
  const resultat = data as { ok: boolean; reason?: string };
  if (!resultat?.ok) {
    // `professional_account` (décision ⑪), `anonymous_session`, `account_not_found` — le libellé
    // affiché est choisi par l'écran, la raison vient de la base.
    return NextResponse.json(
      { ok: false, reason: resultat?.reason ?? "refused" },
      { status: 409 }
    );
  }

  const admin = createServiceRoleClient();
  const { error: erreurAdmin } = await admin.auth.admin.updateUserById(user.id, {
    email: adresseNeutralisee(user.id),
    password: motDePasseAleatoire(),
    // Sans `email_confirm`, GoTrue laisse le changement EN ATTENTE et envoie un lien de
    // confirmation à l'adresse neutralisée — qui n'existe pas. L'ancien email resterait alors
    // occupé, ce qui contredirait la décision ⑤. Vérifié en réel le 2026-09-11.
    email_confirm: true,
  });
  if (erreurAdmin) {
    // Le profil EST anonymisé (étape 1), mais la connexion reste possible. L'écran le dit
    // honnêtement et invite à retenter — voir l'encadré d'ordre en tête de fichier.
    return NextResponse.json({ ok: false, reason: "auth_update_failed" }, { status: 500 });
  }

  // La session courante est révoquée côté client par `signOut()` juste après cette réponse. Le
  // jeton d'accès déjà émis reste techniquement valide jusqu'à son expiration, mais il n'ouvre
  // plus rien qui compte : le profil est vide, et aucune reconnexion n'est possible.
  return NextResponse.json({ ok: true });
}
