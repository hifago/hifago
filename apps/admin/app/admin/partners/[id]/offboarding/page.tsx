import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";
import { OffboardingChecklist } from "./OffboardingChecklist";

export default async function AdminPartnerOffboardingPage({
  params,
}: PageProps<"/admin/partners/[id]/offboarding">) {
  const id = requireUuidParam((await params).id);
  const supabase = await createClient();

  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // répondait « introuvable », ou une checklist d'offboarding vierge.
  const { data: partner } = checkedRead(
    await supabase.from("partners").select("id, display_name").eq("id", id).maybeSingle(),
    "partners",
  );

  if (!partner) {
    notFound();
  }

  // Offboarding le plus récent pour ce partenaire, complet ou non — PAS filtré sur
  // capability_revoked_at is null (contrairement à l'idempotence de start_offboarding elle-même) :
  // une fois l'étape 4 franchie, ce filtre exclurait la ligne qu'on vient de compléter et
  // réafficherait la checklist comme si rien n'avait été fait. S'il n'y en a aucun, le premier clic
  // sur l'étape 1 en crée un (RPC idempotente, cf. plan feature 24).
  //
  // Rappel du nombre d'établissements concernés avant l'étape 4 : capacités operator pas encore
  // suspendues — exactement ce que offboarding_revoke_capability affectera.
  // Les deux requêtes sont indépendantes (ni l'une ni l'autre ne dépend du résultat de l'autre) :
  // parallélisées via Promise.all.
  const [offboardingResult, operatorCapabilitiesResult] = await Promise.all([
    supabase
      .from("partner_offboarding")
      .select(
        "id, unpublished_at, payments_settled_at, payments_settled_note, capability_revoked_at"
      )
      .eq("partner_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("partner_capabilities")
      .select("id", { count: "exact", head: true })
      .eq("partner_id", id)
      .eq("role", "operator")
      .neq("status", "suspended"),
  ]);
  const { data: offboarding } = checkedRead(offboardingResult, "partner_offboarding");
  const { count: operatorCapabilitiesCount } = checkedRead(operatorCapabilitiesResult, "partner_capabilities");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Offboarding — {partner.display_name}</h1>
        <p className="text-sm text-muted">
          Retirar a este partner de la plataforma, en 4 pasos ordenados.
        </p>
      </div>

      <OffboardingChecklist
        partnerId={partner.id}
        offboarding={offboarding ?? null}
        operatorCapabilitiesCount={operatorCapabilitiesCount ?? 0}
      />
    </div>
  );
}
