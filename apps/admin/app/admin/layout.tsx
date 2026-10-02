import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { AdminNav } from "./AdminNav";

// Premier écran de cette app (feature 1) — garde posée une fois ici, héritée automatiquement par
// toutes les routes admin futures. Garde serveur, jamais un simple masquage côté client : un
// compte non-admin qui atteindrait directement /admin/... resterait de toute façon bloqué en
// écriture par la RLS (establishments_write_admin, partner_capabilities RPC-only), mais sans
// cette garde la page elle-même s'afficherait quand même.
//
// Feature 27 (docs/specs/02-admin-accueil-et-navigation.md) : sidebar persistante ajoutée ici —
// jusque-là aucune nav n'existait, plusieurs écrans n'étaient joignables qu'en tapant leur URL.
// `next=/admin` (plus `/admin/establishments`) : un admin qui se reconnecte atterrit désormais sur
// la vraie page d'accueil, plus une redirection vers un onglet particulier.
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin");
  }

  // Feature 31 (docs/specs/07-connexion-inscription-complete.md §8) : le 2FA obligatoire a été
  // rendu optionnel le 2026-08-15 (décision Jérôme) suite à un bug d'enrôlement bloquant l'accès
  // admin réel — is_admin() ne requiert plus l'AAL2 (migration 20260815270000_admin_2fa_optional.sql).
  // Les écrans /mfa/enroll et /mfa/verify restent utilisables volontairement, plus forcés ici.
  //
  // Échec fermé (2026-10-01) : une panne n'est jamais lue comme « pas admin ». Avant, `error` était
  // ignoré et un admin en panne de base partait sur /login, comme déconnecté ; la page lève
  // désormais, et app/error.tsx propose de réessayer.
  //
  // Un compte connecté SANS rôle admin (socio, référent) est renvoyé à l'aiguillage `/`, qui
  // l'envoie sur sa propre page. L'ancien `/login?next=/admin` bouclait : le login rend le
  // formulaire à un compte déjà connecté, qui, une fois reconnecté, repartait vers /admin.
  const { data: isAdmin, error: isAdminError } = await supabase.rpc("is_admin", { uid: user.id });
  if (isAdminError) {
    throw new Error(`Lecture du rôle impossible (is_admin) : ${isAdminError.message}`);
  }

  if (!isAdmin) {
    redirect("/");
  }

  // Revue admin (Jérôme, 2026-08-20) — pastille "à faire" sur le lien "Propuestas" de la sidebar,
  // même 2 tables que /admin/proposals/page.tsx (product_proposals + establishment_proposals,
  // status='pending'), mais en count-only (head: true, jamais les lignes) — chargé sur CHAQUE page
  // admin (ce layout les enveloppe toutes), même posture que AdminAlerts.tsx : "chargées seulement
  // au rendu de la page, sans polling/Realtime" (spec §10), pas un état à part à synchroniser.
  // Un compte en échec lève (décision du 2026-10-01) : une pastille absente dirait « rien à
  // modérer », ce qui est faux.
  const [productProposalsPending, establishmentProposalsPending] = await Promise.all(
    (["product_proposals", "establishment_proposals"] as const).map(async (table) => {
      const { count, error } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) {
        throw new Error(`Lecture des propositions en attente impossible (${table}) : ${error.message}`);
      }
      return count ?? 0;
    })
  );
  const pendingProposalsCount = productProposalsPending + establishmentProposalsPending;

  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      <AdminNav pendingProposalsCount={pendingProposalsCount} />
      <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-1 flex-col gap-6 p-4 md:p-8">{children}</div>
    </div>
  );
}
