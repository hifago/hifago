import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";

// Garde scopée à /partner/commissions, même patron que partner/products/layout.tsx : la vraie
// barrière est côté base — les RPC SECURITY DEFINER partner_commissions_list et
// partner_commission_totals, bornées à l'organisation de l'appelant (`partner_id_for_account`) ;
// order_lines n'est plus lisible directement depuis 20260922210000. Cette garde évite seulement
// d'afficher un écran vide à un visiteur non authentifié.
//
// docs/specs/10-listes-standardisees-admin-socio.md §5.5 — le wrapper de largeur retiré ici était
// déjà mort (max-w-5xl imbriqué dans le max-w-3xl du layout parent, sans effet réel) : la largeur
// et le padding viennent désormais uniquement du layout parent (partner/(app)/layout.tsx).
export default async function PartnerCommissionsLayout({
  children,
}: LayoutProps<"/partner/commissions">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/partner/commissions");
  }

  return children;
}
