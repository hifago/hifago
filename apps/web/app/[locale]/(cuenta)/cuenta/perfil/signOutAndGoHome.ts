import { createClient } from "@hifago/supabase/client";

// Extrait le 2026-09-11 (/simplify) : `LogoutButton.tsx` et `DeleteAccountSection.tsx` répétaient
// verbatim la même séquence. Colocalisé ici plutôt que remonté dans `lib/` : les deux seuls
// appelants vivent dans ce même dossier (components/README.md — on ne remonte que ce qui sert au
// moins deux ROUTES, pas deux fichiers d'un même écran).
//
// ⚠️ La redirection a lieu MÊME si `signOut()` lève (panne réseau) : une erreur qu'il RENVOIE y
// menait déjà, et après une suppression de compte réussie côté serveur, la session locale n'a plus
// rien à faire — laisser l'utilisateur sur l'écran d'un compte neutralisé serait pire.
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
