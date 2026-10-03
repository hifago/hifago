import { createClient } from "@hifago/supabase/client";

// Extrait le 2026-09-11 (/simplify) : `LogoutButton.tsx` et `DeleteAccountSection.tsx` répétaient
// verbatim la même séquence. Colocalisé ici plutôt que remonté dans `lib/` : les deux seuls
// appelants vivent dans ce même dossier (components/README.md — on ne remonte que ce qui sert au
// moins deux ROUTES, pas deux fichiers d'un même écran).
//
// ⚠️ Une panne réseau n'y LÈVE pas : auth-js la RENVOIE (`{ error }`) après avoir déjà retiré la
// session locale, et la redirection suivait déjà. Le `catch` ne couvre qu'une exception inattendue
// (stockage, verrou) : même alors on redirige — après une suppression de compte réussie côté
// serveur, laisser l'utilisateur sur l'écran d'un compte neutralisé serait pire.
export async function signOutAndGoHome(router: { push: (href: string) => void; refresh: () => void }) {
  const supabase = createClient();
  try {
    await supabase.auth.signOut();
  } catch (error) {
    console.error("signOut a échoué — redirection vers l'accueil maintenue", error);
  }
  router.push("/");
  router.refresh();
}
