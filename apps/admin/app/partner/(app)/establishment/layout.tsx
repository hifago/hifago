import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { requirePartnerOrAdmin } from "@/lib/partnerGuard";
import { getOperatorCapability } from "@/lib/agenda/activeOperatorEstablishments";

// Garde scopée à /partner/establishment (et ses enfants /new, /[id]/edit) — même patron que
// products/layout.tsx : la vraie barrière reste la RLS (establishments_select) et les garde-fous
// internes aux RPC submit_establishment_*_proposal (ownership, capacité), cette garde évite
// seulement d'afficher un écran vide à un visiteur non authentifié.
//
// docs/specs/10-listes-standardisees-admin-socio.md §5.5 — le wrapper de largeur retiré ici était
// déjà mort (max-w-4xl imbriqué dans le max-w-3xl du layout parent, sans effet réel) : la largeur
// et le padding viennent désormais uniquement du layout parent (partner/(app)/layout.tsx).
//
// Garde partner_id ajoutée (constat 2026-08-17) : un compte issu de l'inscription libre (Feature
// 31, docs/specs/07-connexion-inscription-complete.md) n'a aucun partner_id tant qu'il n'a pas
// rejoint via invitation ou création admin — jusqu'ici il pouvait quand même atteindre
// /partner/establishment/new (lien toujours affiché par establishment/page.tsx, indépendant du
// rôle) et n'était bloqué qu'à la soumission par submit_establishment_creation_proposal (reason
// `not_a_partner`), sans explication. Même RPC que /partner/(app)/page.tsx (`partner_id_for_account`)
// pour rester cohérent avec le message déjà affiché là-bas (« Aún no tienes ningún rol asignado »).
//
// Correctif (même jour) : cette garde bloquait aussi l'admin, qui n'a jamais de partner_id non
// plus (capacité admin portée par le compte lui-même, sans organisation — cf. commentaire de
// 20260813161117_identity_core_tables.sql). Repéré via partner-propose-establishment-photo.spec.ts,
// qui reste authentifié admin pour revérifier la galerie après approbation (même patron que
// partner-propose-photo.spec.ts côté produit) — la vraie barrière pour un tiers reste de toute
// façon la RLS (establishments_select) et les RPC, cette garde ne doit exclure QUE le visiteur
// sans rôle du tout, jamais l'admin.
export default async function PartnerEstablishmentLayout({
  children,
}: LayoutProps<"/partner/establishment">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/partner/establishment");
  }

  const { partnerId, isAdmin } = await requirePartnerOrAdmin(supabase);

  // Refonte vue référent (2026-08-20, docs/specs/22-vue-referent-restreinte.md §3d du cahier des
  // charges socio) : garde serveur réelle, pas un simple masquage du lien de nav — un référent pur
  // (aucune capacité operator, quel que soit son statut) n'a rien à faire ici. L'admin n'est jamais
  // concerné (même raison que requirePartnerOrAdmin ci-dessus, aucun partner_id).
  if (!isAdmin && !(await getOperatorCapability(supabase, partnerId))) {
    redirect("/partner");
  }

  return children;
}
