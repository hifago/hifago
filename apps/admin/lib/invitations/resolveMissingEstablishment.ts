import type { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";

// docs/specs/10-listes-standardisees-admin-socio.md — règle métier partagée entre la liste
// (apps/admin/app/admin/invitations/page.tsx, plusieurs lignes) et la fiche détail
// (apps/admin/app/admin/invitations/[id]/page.tsx, une seule) : une invitation "Prestador"
// consommée, dont l'établissement n'a pas encore été résolu à la création
// (create_partner_invitation, feature 13, ne renseigne jamais partner_invitations.partner_id
// après consommation), reste "actionnable" tant que le partenaire résolu porte encore une
// capacité operator sans establishment_id. Un seul point d'implémentation batché — la liste
// l'appelle avec toutes ses lignes, la fiche détail avec un tableau à un seul élément.
//
// Ses deux lectures LÈVENT sur une panne (lib/supabase/checkedRead.ts) : lues en `?? []`, elles
// faisaient dire « établissement rattaché » (rien à faire) à une invitation dont on ne savait rien.
export type InvitationForMissingEstablishment = {
  id: string;
  status: string;
  onboarding_path: string;
  partner_id: string | null;
  consumed_by_account_id: string | null;
};

export type MissingEstablishmentResolution = {
  // invitation.id -> partner.id, pour TOUTE invitation dont un partenaire a pu être résolu (que
  // son établissement manque ou non) — ex. le lien "Ver partner resuelto" de la fiche détail en a
  // besoin même quand l'établissement est déjà rattaché.
  resolvedPartnerByInvitation: Map<string, string>;
  // Sous-ensemble : invitation.id -> partner.id, seulement quand l'établissement manque encore.
  missingEstablishmentByInvitation: Map<string, string>;
};

export async function resolveMissingEstablishmentPartners(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invitations: InvitationForMissingEstablishment[]
): Promise<MissingEstablishmentResolution> {
  const candidates = invitations.filter(
    (invitation) => invitation.status === "consumed" && invitation.onboarding_path === "provider"
  );

  const accountIdsToResolve = Array.from(
    new Set(
      candidates
        .filter((invitation) => invitation.partner_id === null && invitation.consumed_by_account_id !== null)
        .map((invitation) => invitation.consumed_by_account_id as string)
    )
  );

  const accountToPartner = new Map<string, string | null>();
  if (accountIdsToResolve.length > 0) {
    const accountsRes = await supabase
      .from("partner_accounts")
      .select("id, partner_id")
      .in("id", accountIdsToResolve);
    checkedRead(accountsRes, "partner_accounts (invitaciones)");
    for (const account of accountsRes.data ?? []) {
      accountToPartner.set(account.id, account.partner_id);
    }
  }

  const resolvedPartnerByInvitation = new Map<string, string>();
  for (const invitation of candidates) {
    const resolved =
      invitation.partner_id ??
      (invitation.consumed_by_account_id ? accountToPartner.get(invitation.consumed_by_account_id) : null);
    if (resolved) resolvedPartnerByInvitation.set(invitation.id, resolved);
  }

  const candidatePartnerIds = Array.from(new Set(Array.from(resolvedPartnerByInvitation.values())));
  const partnersMissingEstablishment = new Set<string>();
  if (candidatePartnerIds.length > 0) {
    const capabilitiesRes = await supabase
      .from("partner_capabilities")
      .select("partner_id")
      .eq("role", "operator")
      .is("establishment_id", null)
      .in("partner_id", candidatePartnerIds);
    checkedRead(capabilitiesRes, "partner_capabilities (invitaciones)");
    for (const capability of capabilitiesRes.data ?? []) {
      if (capability.partner_id) partnersMissingEstablishment.add(capability.partner_id);
    }
  }

  const missingEstablishmentByInvitation = new Map<string, string>();
  for (const [invitationId, partnerId] of resolvedPartnerByInvitation) {
    if (partnersMissingEstablishment.has(partnerId)) missingEstablishmentByInvitation.set(invitationId, partnerId);
  }
  return { resolvedPartnerByInvitation, missingEstablishmentByInvitation };
}
