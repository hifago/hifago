import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { isRealAccount } from "@hifago/supabase/identity";

// Racine de l'app (admin+socio, cf. hifago/CLAUDE.md §2.1) : ne rend jamais de contenu, aiguille
// vers la page de base du type d'utilisateur connecté. C'est aussi la destination par défaut de
// app/login/page.tsx quand aucun `next` explicite n'est fourni — un login sans contexte de départ
// repasse par ici pour être aiguillé correctement plutôt que de supposer "admin" par défaut.
// operator ⇒ referrer (invariant DB) : un operator est donc toujours aussi referrer, testé en
// premier pour l'envoyer sur sa page la plus utile (ses fiches), pas sur ses commissions.
export default async function RootPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Une session ANONYME (posée par le panier de la vitrine — en local les deux apps partagent
  // `localhost`, donc ses cookies) n'est pas un compte : elle va au login comme une absence de
  // session, jamais vers l'espace socio (« sin rol »). `!user` reste écrit pour le typage.
  if (!user || !isRealAccount(user)) {
    redirect("/login");
  }

  // Feature 31 (docs/specs/07-connexion-inscription-complete.md §8) : 2FA rendu optionnel le
  // 2026-08-15 (décision Jérôme) — plus de redirection forcée vers /mfa/enroll ou /mfa/verify.

  // Échec fermé (2026-10-01) : chaque lecture de rôle en panne LÈVE (app/error.tsx propose de
  // réessayer). Lue comme « pas ce rôle », elle aiguillait ailleurs : un admin en panne de base
  // atterrissait sur /partner, devant « Aún no tienes ningún rol asignado ».
  const { data: isAdmin, error: isAdminError } = await supabase.rpc("is_admin", { uid: user.id });
  if (isAdminError) {
    throw new Error(`Aiguillage impossible (is_admin) : ${isAdminError.message}`);
  }
  if (isAdmin) {
    redirect("/admin");
  }

  const { data: isOperator, error: isOperatorError } = await supabase.rpc("has_capability", {
    uid: user.id,
    p_role: "operator",
  });
  if (isOperatorError) {
    throw new Error(`Aiguillage impossible (has_capability operator) : ${isOperatorError.message}`);
  }
  if (isOperator) {
    // Refonte vue prestataire (2026-08-19) : "Mis actividades" fusionnée dans
    // "/partner/establishment" — évite un double redirect (/partner/products lui-même redirige
    // désormais vers /partner/establishment).
    redirect("/partner/establishment");
  }

  const { data: isReferrer, error: isReferrerError } = await supabase.rpc("has_capability", {
    uid: user.id,
    p_role: "referrer",
  });
  if (isReferrerError) {
    throw new Error(`Aiguillage impossible (has_capability referrer) : ${isReferrerError.message}`);
  }
  if (isReferrer) {
    redirect("/partner/commissions");
  }

  // Feature 31 — révision 2026-08-19 : redevenu rare (inscription libre bloquée,
  // supabase/config.toml enable_signup=false) — ne concerne plus que les comptes créés PENDANT
  // la fenêtre où l'inscription libre était active (ex. gmiro46@gmail.com, connecté via Google
  // avant ce changement) ou provisionnés autrement sans capacité. Code défensif conservé tel
  // quel : ce compte doit atterrir sur son dashboard (qui affiche déjà cet état, cf.
  // /partner/(app)/page.tsx « Aún no tienes ningún rol asignado »), jamais sur /partner/join sans
  // jeton — cet écran attend un `?token=` et affiche sinon une erreur d'invitation invalide, un
  // faux message pour ce cas.
  redirect("/partner");
}
