import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { ProductForm } from "@/components/product-form";
import { toTagOptions } from "@/lib/tags/proposedTags";
import { ProviderServiceStep } from "../../PartnerProviderWelcome";

// Spec 15 — pendant de /admin/products/new côté socio : mêmes champs/gating (ProductForm,
// variant="socio-proposal"), mais écrit via submit_product_creation_proposal (proposition
// modérée) plutôt qu'un insert direct — products reste RLS admin-only en écriture, jamais étendue
// au socio. Établissements filtrés à ceux du partenaire ET avec une capacité operator ACTIVE
// (évite de proposer dans le sélecteur un établissement pour lequel la RPC répondrait
// capability_suspended de toute façon).
//
// Migration 20261019120000 (demande Jérôme, 2026-10-19) : les propositions de création
// d'établissement ENCORE EN REVUE sont aussi proposées, marquées « (en revisión) » — un nouveau
// partenaire propose ses activités sans attendre l'approbation de son établissement. Même règle de
// capacité que la RPC : une capacité operator active, quelle qu'elle soit. `?establecimiento=`
// présélectionne l'entrée (enchaînement depuis l'écran de confirmation de l'établissement).
export default async function NewProductProposalPage({
  searchParams,
}: PageProps<"/partner/products/new">) {
  const { establecimiento: requestedEstablishment, nueva } = (await searchParams) ?? {};
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
  // Équipements (migration 20261013151206) : un socio les choisit en proposant un logement. Chargés
  // sans condition, comme les tags — le type n'est choisi que dans le formulaire.
  const [partnerIdResult, tagsResult, amenitiesResult] = await Promise.all([
    supabase.rpc("partner_id_for_account"),
    supabase.from("catalog_tags").select("id, label").order("slug"),
    supabase.from("catalog_amenities").select("id, label").order("category_key").order("sort_order"),
  ]);
  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // affichait « aucun établissement avec capacité d'operator » à un operator qui en a.
  const { data: partnerId } = checkedRead(partnerIdResult, "partner_id_for_account");
  const { data: tagsRaw } = checkedRead(tagsResult, "catalog_tags");
  const { data: amenitiesRaw } = checkedRead(amenitiesResult, "catalog_amenities");

  const { data: activeCapabilities } = checkedRead(
    partnerId
      ? await supabase
          .from("partner_capabilities")
          .select("establishment_id")
          .eq("partner_id", partnerId)
          .eq("role", "operator")
          .eq("status", "active")
      : { data: null, error: null },
    "partner_capabilities",
  );
  const hasActiveOperatorCapability = (activeCapabilities ?? []).length > 0;

  const { data: pendingEstablishmentProposals } = checkedRead(
    partnerId && hasActiveOperatorCapability
      ? await supabase
          .from("establishment_proposals")
          .select("id, payload")
          .eq("partner_id", partnerId)
          .eq("kind", "create")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
      : { data: [], error: null },
    "establishment_proposals",
  );

  // Premier service (texte d'accueil du prestataire, validé par Jérôme le 2026-10-19) : tant que le
  // partenaire n'a ni service publié ni proposition en attente, le formulaire s'ouvre sur « ce
  // qu'est un service » (ProviderServiceStep) au lieu de la seule ligne sur la revue.
  const [anyProductResult, anyProductProposalResult] = await Promise.all([
    partnerId
      ? supabase.from("products").select("id").eq("partner_id", partnerId).limit(1)
      : { data: [] as { id: string }[], error: null },
    partnerId
      ? supabase
          .from("product_proposals")
          .select("id")
          .eq("partner_id", partnerId)
          .eq("kind", "create")
          .eq("status", "pending")
          .limit(1)
      : { data: [] as { id: string }[], error: null },
  ]);
  const { data: anyProduct } = checkedRead(anyProductResult, "products");
  const { data: anyProductProposal } = checkedRead(anyProductProposalResult, "product_proposals");
  const isFirstService = (anyProduct ?? []).length === 0 && (anyProductProposal ?? []).length === 0;

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

  const establishmentOptions = [
    ...(establishments ?? []),
    ...(pendingEstablishmentProposals ?? []).map((proposal) => ({
      id: proposal.id,
      name: (proposal.payload as { name?: unknown } | null)?.name ?? null,
      partner_id: partnerId as string,
      pending_proposal: true,
    })),
  ];
  const initialEstablishmentId =
    typeof requestedEstablishment === "string" &&
    establishmentOptions.some((option) => option.id === requestedEstablishment)
      ? requestedEstablishment
      : "";

  const allTags = toTagOptions(tagsRaw);
  const allAmenities = toTagOptions(amenitiesRaw);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="titre-page">Proponer un nuevo servicio</h1>
      {isFirstService && establishmentOptions.length > 0 ? (
        <ProviderServiceStep />
      ) : (
        <p className="text-sm text-muted">
          Un admin revisará tu propuesta antes de que el servicio exista en el catálogo. No podrás
          agregar fotos hasta que sea aprobado.
        </p>
      )}
      {establishmentOptions.length === 0 ? (
        <p className="text-sm text-muted" data-testid="no-active-establishments">
          Aún no tienes ningún establecimiento con capacidad de operador activa.
        </p>
      ) : (
        <ProductForm
          key={typeof nueva === "string" ? nueva : undefined}
          establishments={establishmentOptions}
          initialEstablishmentId={initialEstablishmentId}
          allTags={allTags}
          allAmenities={allAmenities}
          variant="socio-proposal"
        />
      )}
    </div>
  );
}
