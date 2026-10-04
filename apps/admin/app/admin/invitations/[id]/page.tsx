import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";
import { RevokeInvitationButton } from "../RevokeInvitationButton";
import { InvitationStatusChip } from "../InvitationStatusChip";
import { ONBOARDING_PATH_LABELS } from "../invitationLabels";
import { resolveMissingEstablishmentPartners } from "@/lib/invitations/resolveMissingEstablishment";
import { formatDateTimeInBogota } from "@hifago/domain";

// docs/specs/10-listes-standardisees-admin-socio.md §5.4 — fiche minimale, n'existait pas avant
// (seule la liste montrait ces champs). Contenu = colonnes déjà connues + partner_hint/created_by,
// pas une refonte.
export default async function AdminInvitationDetailPage({
  params,
}: PageProps<"/admin/invitations/[id]">) {
  const id = requireUuidParam((await params).id);
  const supabase = await createClient();

  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // répondait « introuvable », ou un créateur inconnu.
  const { data: invitation } = checkedRead(
    await supabase
      .from("partner_invitations")
      .select(
        "id, promo_code, onboarding_path, status, partner_hint, expires_at, consumed_at, consumed_by_account_id, partner_id, created_by, created_at"
      )
      .eq("id", id)
      .maybeSingle(),
    "partner_invitations",
  );

  if (!invitation) {
    notFound();
  }

  // Les deux résolutions ci-dessous ne dépendent que de `invitation` déjà chargée — indépendantes
  // l'une de l'autre, lancées en concurrence plutôt qu'en série.
  const [{ resolvedPartnerByInvitation, missingEstablishmentByInvitation }, createdByName] = await Promise.all([
    resolveMissingEstablishmentPartners(supabase, [invitation]),
    invitation.created_by
      ? supabase
          .from("partner_accounts")
          .select("partners(display_name)")
          .eq("id", invitation.created_by)
          .maybeSingle()
          .then((result) => checkedRead(result, "partner_accounts").data?.partners?.display_name ?? null)
      : Promise.resolve(null),
  ]);
  const resolvedPartnerId = resolvedPartnerByInvitation.get(invitation.id) ?? null;
  const missingEstablishment = missingEstablishmentByInvitation.has(invitation.id);

  const hint = invitation.partner_hint as { display_name?: string; partner_city?: string } | null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold" data-testid="invitation-detail-code">
          {invitation.promo_code}
        </h1>
        {invitation.status === "pending" ? <RevokeInvitationButton invitationId={invitation.id} /> : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <div>
          <dt className="text-muted">Tipo</dt>
          <dd>{ONBOARDING_PATH_LABELS[invitation.onboarding_path] ?? invitation.onboarding_path}</dd>
        </div>
        <div>
          <dt className="text-muted">Estado</dt>
          <dd>
            <InvitationStatusChip status={invitation.status} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Creada</dt>
          <dd>{formatDateTimeInBogota(invitation.created_at, "es")}</dd>
        </div>
        <div>
          <dt className="text-muted">Expira</dt>
          <dd>{formatDateTimeInBogota(invitation.expires_at, "es")}</dd>
        </div>
        <div>
          <dt className="text-muted">Consumida</dt>
          <dd>{invitation.consumed_at ? formatDateTimeInBogota(invitation.consumed_at, "es") : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Creada por</dt>
          <dd>{createdByName ?? "—"}</dd>
        </div>
        {hint ? (
          <div className="col-span-2">
            <dt className="text-muted">Sugerencia al crear</dt>
            <dd>
              {hint.display_name ?? "—"}
              {hint.partner_city ? ` · ${hint.partner_city}` : ""}
            </dd>
          </div>
        ) : null}
      </dl>

      {missingEstablishment && resolvedPartnerId ? (
        <Link
          href={`/admin/establishments/new?partner_id=${resolvedPartnerId}`}
          className="text-sm font-medium text-warning hover:underline"
          data-testid={`invitation-missing-establishment-${invitation.id}`}
        >
          Falta establecimiento
        </Link>
      ) : null}

      {resolvedPartnerId ? (
        <Link href={`/admin/partners/${resolvedPartnerId}`} className="text-sm hover:underline">
          Ver partner resuelto
        </Link>
      ) : null}
    </div>
  );
}
