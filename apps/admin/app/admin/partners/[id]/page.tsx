import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { buttonVariants } from "@hifago/ui";
import { CapabilitiesSection } from "./CapabilitiesSection";
import { EstablishmentsSection } from "./EstablishmentsSection";
import { CodesSection } from "./CodesSection";
import { PartnerLocationBlock } from "./PartnerLocationBlock";

export default async function AdminPartnerDetailPage({
  params,
}: PageProps<"/admin/partners/[id]">) {
  const id = requireUuidParam((await params).id);
  const supabase = await createClient();

  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // répondait « introuvable », ou une fiche sans capacités, établissements ni codes.
  const { data: partner } = checkedRead(
    await supabase.from("partners").select("id, display_name").eq("id", id).maybeSingle(),
    "partners",
  );

  if (!partner) {
    notFound();
  }

  // role_agreements : déjà lisible par l'admin depuis la Tranche 1 (role_agreements_select),
  // aucune nouvelle policy nécessaire — cf. plan feature 23.
  // allEstablishments : tous les établissements du registre (pas seulement ceux "libres" —
  // establishments.partner_id est not null, aucun établissement n'est jamais réellement libre) :
  // transfer_establishment n'a qu'un seul chemin, premier rattachement et transfert depuis un
  // autre partenaire confondus.
  const [
    capabilitiesResult,
    agreementsResult,
    ownEstablishmentsResult,
    allEstablishmentsResult,
    codesResult,
    crmProfileResult,
  ] = await Promise.all([
    supabase
      .from("partner_capabilities")
      .select("id, role, status, establishment:establishments(id, name)")
      .eq("partner_id", id)
      .order("role"),
    supabase
      .from("role_agreements")
      .select("role, explicit_consent, accepted_at")
      .eq("partner_id", id)
      .order("accepted_at", { ascending: false }),
    supabase
      .from("establishments")
      .select("id, name, status")
      .eq("partner_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("establishments")
      .select("id, name, partner:partners(display_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("partner_codes")
      .select("code, active")
      .eq("partner_id", id)
      .order("code"),
    // Revue admin partenaires (Jérôme, 2026-08-19) — lecture directe RLS (pas RPC) : seule
    // l'écriture de partner_crm_profile est RPC-only (set_partner_location), la policy
    // partner_crm_profile_select autorise déjà l'admin en lecture. maybeSingle : 31/32 partenaires
    // n'ont aujourd'hui aucune ligne (jamais géocodés), pas un cas d'erreur.
    supabase.from("partner_crm_profile").select("address, lat, lon").eq("partner_id", id).maybeSingle(),
  ]);
  const { data: capabilities } = checkedRead(capabilitiesResult, "partner_capabilities");
  const { data: agreements } = checkedRead(agreementsResult, "role_agreements");
  const { data: ownEstablishments } = checkedRead(ownEstablishmentsResult, "establishments");
  const { data: allEstablishments } = checkedRead(allEstablishmentsResult, "establishments");
  const { data: codes } = checkedRead(codesResult, "partner_codes");
  // partner_id est la clé primaire de partner_crm_profile : jamais plus d'une ligne.
  const { data: crmProfile } = checkedRead(crmProfileResult, "partner_crm_profile");

  // Dernier accord par rôle (accepted_at desc ci-dessus, donc le premier trouvé par rôle est le
  // plus récent) — un partenaire peut avoir plusieurs accords au fil des versions de document.
  const latestAgreementByRole = new Map<string, boolean>();
  for (const agreement of agreements ?? []) {
    if (!latestAgreementByRole.has(agreement.role)) {
      latestAgreementByRole.set(agreement.role, agreement.explicit_consent);
    }
  }

  const ownEstablishmentOptions = (ownEstablishments ?? []).map((establishment) => ({
    id: establishment.id,
    name: resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">{partner.display_name}</h1>
        <Link
          href={`/admin/partners/${partner.id}/offboarding`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          data-testid="offboarding-link"
        >
          Offboarding
        </Link>
      </div>

      <PartnerLocationBlock
        partnerId={partner.id}
        initialAddress={crmProfile?.address ?? ""}
        initialLat={crmProfile?.lat != null ? String(crmProfile.lat) : ""}
        initialLon={crmProfile?.lon != null ? String(crmProfile.lon) : ""}
      />

      <CapabilitiesSection
        partnerId={partner.id}
        capabilities={(capabilities ?? []).map((capability) => ({
          id: capability.id,
          role: capability.role,
          status: capability.status,
          establishmentName: capability.establishment
            ? (resolveLocalizedField(asLocalizedField(capability.establishment.name), "es") ??
              capability.establishment.id)
            : null,
          agreementAccepted: latestAgreementByRole.get(capability.role) ?? null,
        }))}
        ownEstablishments={ownEstablishmentOptions}
      />

      <EstablishmentsSection
        partnerId={partner.id}
        ownEstablishments={(ownEstablishments ?? []).map((establishment) => ({
          id: establishment.id,
          name: resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id,
          status: establishment.status,
        }))}
        allEstablishments={(allEstablishments ?? []).map((establishment) => ({
          id: establishment.id,
          name: resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id,
          ownerName: establishment.partner?.display_name ?? "—",
        }))}
      />

      <CodesSection codes={codes ?? []} />
    </div>
  );
}
