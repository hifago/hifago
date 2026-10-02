import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePartnerOrAdmin } from "./partnerGuard";

// Portée des écrans socio qui affichent UNE fiche par son id (édition de produit, calendrier,
// édition d'établissement — 2026-10-01).
//
// POURQUOI. Ces écrans lisaient la fiche par son seul id, en comptant sur la RLS pour n'en rendre
// que les siennes. Or les policies publiques (`products_select_public`, fiche en vente ;
// `establishments_select_public`, établissement actif) laissent lire toute fiche publiée : un
// socio ouvrait donc l'écran d'édition d'une fiche d'un autre partenaire. Aucune écriture ne
// passait (les RPC revérifient la propriété), mais l'écran s'affichait. Le filtre reprend le
// prédicat des policies « own » : `partner_id = partner_id_for_account(uid)`.
//
// L'admin n'a jamais d'organisation et passe les gardes socio (`requirePartnerOrAdmin`) : il n'est
// pas restreint. La portée est un type EXPLICITE — jamais un `null` qui se lirait « sans filtre ».
export type OwnerScope = { kind: "admin" } | { kind: "partner"; partnerId: string };

export async function ownerScope(supabase: SupabaseClient): Promise<OwnerScope> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { partnerId, isAdmin } = await requirePartnerOrAdmin(supabase, user.id);
  if (isAdmin) return { kind: "admin" };
  if (!partnerId) notFound();
  return { kind: "partner", partnerId };
}
