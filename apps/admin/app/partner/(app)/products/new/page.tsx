import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { ProductForm } from "@/components/product-form";

// Spec 15 — pendant de /admin/products/new côté socio : mêmes champs/gating (ProductForm,
// variant="socio-proposal"), mais écrit via submit_product_creation_proposal (proposition
// modérée) plutôt qu'un insert direct — products reste RLS admin-only en écriture, jamais étendue
// au socio. Établissements filtrés à ceux du partenaire ET avec une capacité operator ACTIVE
// (évite de proposer dans le sélecteur un établissement pour lequel la RPC répondrait
// capability_suspended de toute façon).
export default async function NewProductProposalPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/partner/products/new");
  }

  // catalog_tags ne dépend ni de partnerId ni des établissements ci-dessous — lancée en parallèle
  // de la RPC partner_id_for_account plutôt qu'en dernier maillon d'une chaîne séquentielle à 4
  // niveaux.
  const [partnerIdResult, tagsResult] = await Promise.all([
    supabase.rpc("partner_id_for_account", { uid: user.id }),
    supabase.from("catalog_tags").select("id, label").order("slug"),
  ]);
  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // affichait « aucun établissement avec capacité d'operator » à un operator qui en a.
  const { data: partnerId } = checkedRead(partnerIdResult, "partner_id_for_account");
  const { data: tagsRaw } = checkedRead(tagsResult, "catalog_tags");

  const { data: activeCapabilities } = checkedRead(
    partnerId
      ? await supabase
          .from("partner_capabilities")
          .select("establishment_id")
          .eq("partner_id", partnerId)
          .eq("role", "operator")
          .eq("status", "active")
          .not("establishment_id", "is", null)
      : { data: null, error: null },
    "partner_capabilities",
  );

  const activeEstablishmentIds = (activeCapabilities ?? [])
    .map((c) => c.establishment_id)
    .filter((id): id is string => id !== null);

  const { data: establishments } = checkedRead(
    activeEstablishmentIds.length > 0
      ? await supabase
          .from("establishments")
          .select("id, name, partner_id, lobby_connector_active, lobby_has_token")
          .in("id", activeEstablishmentIds)
          .order("created_at", { ascending: true })
      : { data: [], error: null },
    "establishments",
  );

  const allTags = (tagsRaw ?? []).map((tag) => ({
    id: tag.id,
    label: resolveLocalizedField(asLocalizedField(tag.label), "es") ?? tag.id,
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Proponer una nueva ficha</h1>
      <p className="text-sm text-muted">
        Un admin revisará tu propuesta antes de que la ficha exista en el catálogo. No podrás
        agregar fotos hasta que sea aprobada.
      </p>
      {(establishments ?? []).length === 0 ? (
        <p className="text-sm text-muted" data-testid="no-active-establishments">
          Aún no tienes ningún establecimiento con capacidad de operador activa.
        </p>
      ) : (
        <ProductForm establishments={establishments ?? []} allTags={allTags} variant="socio-proposal" />
      )}
    </div>
  );
}
