import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { ProposalsTable } from "./ProposalsTable";

export default async function AdminProposalsPage() {
  const supabase = await createClient();

  // product_proposals_select_admin (feature 15) : l'admin voit les propositions de tous les
  // partenaires. Nom actuel du produit affiché ici pour l'identifier — la comparaison
  // valeur actuelle/proposée champ par champ vit sur l'écran de détail, pas ici. product est null
  // pour une proposition kind='create' pas encore approuvée (spec 15, le produit n'existe pas
  // encore) : repli sur le nom proposé (payload), même patron que establishmentProposals ci-dessous.
  const { data: productProposals } = checkedRead(
    await supabase
      .from("product_proposals")
      .select("id, created_at, kind, payload, product:products(name), partner:partners(display_name)")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    "product_proposals",
  );

  // establishment_proposals_select_admin (docs/specs/06-gestion-etablissement.md) — même écran de
  // modération que product_proposals, fusionné et trié par date, jamais un second écran séparé.
  // establishment est null pour une proposition kind='create' pas encore approuvée (l'établissement
  // n'existe pas encore) : repli sur le nom proposé (payload) dans ce cas.
  const { data: establishmentProposals } = checkedRead(
    await supabase
      .from("establishment_proposals")
      .select(
        "id, created_at, kind, payload, establishment:establishments(name), partner:partners(display_name)",
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    "establishment_proposals",
  );

  const rows = [
    ...(productProposals ?? []).map((p) => ({
      id: p.id,
      created_at: p.created_at,
      kind: p.kind,
      entityType: "product" as const,
      displayName:
        resolveLocalizedField(asLocalizedField(p.product?.name), "es") ??
        resolveLocalizedField(asLocalizedField((p.payload as { name?: unknown } | null)?.name), "es") ??
        "—",
      partner: p.partner,
    })),
    ...(establishmentProposals ?? []).map((p) => ({
      id: p.id,
      created_at: p.created_at,
      kind: p.kind,
      entityType: "establishment" as const,
      displayName:
        resolveLocalizedField(asLocalizedField(p.establishment?.name), "es") ??
        resolveLocalizedField(
          asLocalizedField((p.payload as { name?: unknown } | null)?.name),
          "es",
        ) ??
        "—",
      partner: p.partner,
    })),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Propuestas pendientes</h1>

      <ProposalsTable proposals={rows} />
    </div>
  );
}
