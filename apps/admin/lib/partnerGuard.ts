import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

// Garde partagée par les layouts /partner/products, /partner/establishment et /partner/reservations
// (extrait le 2026-08-18, ex-duplication verbatim des trois — garde partner_id ajoutée le
// 2026-08-17, cf. l'historique conservé dans chacun de ces layouts appelants). Un compte sans
// partner_id (inscription libre, pas encore rejoint via invitation ou création admin) ni admin
// (qui n'a lui non plus jamais de partner_id — capacité portée par le compte lui-même, sans
// organisation, cf. commentaire de 20260813161117_identity_core_tables.sql) est redirigé vers
// `fallbackPath`. La vraie barrière de données est côté base, propre à chaque écran : les RPC
// SECURITY DEFINER qui revérifient la capacité (réservations, commissions — `order_lines` n'est
// plus lisible directement depuis 20260922210000), les policies RLS des fiches lues et les RPC
// d'écriture. Cette garde évite seulement d'afficher un écran vide à un visiteur sans rôle du tout.
//
// Échec fermé (2026-10-01) : un rôle illisible LÈVE (app/error.tsx propose de réessayer). Lu comme
// « aucun rôle », il renvoyait un partenaire ou un admin en panne de base sur `fallbackPath`.
export async function requirePartnerOrAdmin(
  supabase: SupabaseClient,
  userId: string,
  fallbackPath = "/partner"
): Promise<{ partnerId: string | null; isAdmin: boolean }> {
  const [partnerResult, adminResult] = await Promise.all([
    supabase.rpc("partner_id_for_account", { uid: userId }),
    supabase.rpc("is_admin", { uid: userId }),
  ]);
  if (partnerResult.error) {
    throw new Error(`Lecture de l'organisation impossible (partner_id_for_account) : ${partnerResult.error.message}`);
  }
  if (adminResult.error) {
    throw new Error(`Lecture du rôle impossible (is_admin) : ${adminResult.error.message}`);
  }
  const partnerId = partnerResult.data;
  const isAdmin = adminResult.data;

  if (!partnerId && !isAdmin) {
    redirect(fallbackPath);
  }

  return { partnerId, isAdmin: Boolean(isAdmin) };
}
