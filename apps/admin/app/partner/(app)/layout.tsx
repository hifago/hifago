import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { isRealAccount } from "@hifago/supabase/identity";
import { getOperatorCapability } from "@/lib/agenda/activeOperatorEstablishments";
import { PartnerAppNav } from "./PartnerAppNav";

// Feature 29 (docs/specs/05-invitations-onboarding-dashboard-partenaire.md) : première garde et
// première nav communes à /partner — jusqu'ici chaque écran (commissions/products/tools)
// dupliquait sa propre garde dans un layout.tsx scopé (elles restent en place, redondantes mais
// inoffensives, cf. spec §10) sans aucune nav partagée. Route group `(app)` : isole ces écrans
// authentifiés de `/partner/join`, qui doit rester accessible sans session (un invité n'est pas
// encore connecté quand il ouvre son lien) — `join/` est un répertoire frère, hors de ce groupe,
// jamais concerné par cette garde.
export default async function PartnerAppLayout({ children }: LayoutProps<"/partner">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Une session ANONYME (posée par le panier de la vitrine — en local les deux apps partagent
  // `localhost`, donc ses cookies) n'est pas un compte : elle va au login comme une absence de
  // session, jamais vers l'espace socio (« sin rol »). `!user` reste écrit pour le typage.
  if (!user || !isRealAccount(user)) {
    redirect("/login?next=/partner");
  }

  // Feature 31 (docs/specs/07-connexion-inscription-complete.md §8) : 2FA rendu optionnel le
  // 2026-08-15 (décision Jérôme) — plus de redirection forcée depuis ce layout.

  // Refonte vue référent (2026-08-20, docs/specs/22-vue-referent-restreinte.md) : la nav elle-même
  // décide quoi montrer, pas seulement les layouts enfants (§ci-dessous n'existe pas encore ici —
  // cf. establishment/products/reservations layout.tsx pour la garde serveur réelle). Un admin
  // (jamais de partner_id) obtient hasOperatorCapability=false par construction — sans effet pour
  // lui, il ne passe jamais par la nav socio en pratique.
  // Échec fermé (2026-10-01) : une panne lève (app/error.tsx propose de réessayer) — lue comme
  // « aucune organisation », elle rendait une nav amputée de tous les écrans d'operator.
  const { data: partnerId, error: partnerIdError } = await supabase.rpc("partner_id_for_account", {
    uid: user.id,
  });
  if (partnerIdError) {
    throw new Error(`Lecture de l'organisation impossible (partner_id_for_account) : ${partnerIdError.message}`);
  }
  const canOperate = await getOperatorCapability(supabase, partnerId);

  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      <PartnerAppNav hasOperatorCapability={canOperate} />
      <div className="mx-auto flex w-full min-w-0 flex-1 flex-col gap-6 p-4 md:p-8">{children}</div>
    </div>
  );
}
