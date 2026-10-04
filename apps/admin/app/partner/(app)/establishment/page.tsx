import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { buttonVariants } from "@hifago/ui";
import { EmptyStateCta } from "@/components/EmptyStateCta";
import { PendingCreationBanner } from "./PendingCreationBanner";
import { EstablishmentStack, type EstablishmentCardRow } from "./EstablishmentStack";
import type { PendingProductCreationRow, ProductCardRow } from "./EstablishmentActivities";

type ProductQueryRow = {
  id: string;
  type: string;
  name: unknown;
  price_cop: number | null;
  establishment_id: string;
  sellable: boolean;
  lobby_category_id: number | null;
  evento_capacity_mode: "unlimited" | "metered" | "rsvp" | null;
  product_tag_assignments: { catalog_tags: { id: string; label: unknown } | null }[];
};

type PendingCreationProposalRow = {
  id: string;
  type: string | null;
  payload: unknown;
  establishment_id: string | null;
  created_at: string;
};

// Refonte vue prestataire (2026-08-19) — fusionne l'ancienne liste "/partner/establishment"
// (EstablishmentsGrid) et l'ancienne liste "/partner/products" (ProductsGrid) en une seule vue :
// docs/specs/06-gestion-etablissement.md §5.2 reste la source pour le principe "un seul écran, pas
// deux parcours" côté propositions, étendu ici à l'affichage lui-même — un établissement n'a jamais
// existé comme carte isolée de ses activités (V1 non plus, cf. exploration V1 : aucune vue
// "établissement" n'a jamais existé, le lien establishment→products restait un filtre implicite).
// /partner/products redirige désormais ici (page.tsx dédiée) — ses sous-routes (new/[id]/edit/
// availability/...) restent inchangées, ce sont les cibles des CTA de cette page.
export default async function PartnerEstablishmentPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // affichait « aucun établissement », ou des fiches sans photos ni propositions.
  const partnerId = user
    ? checkedRead(
        await supabase.rpc("partner_id_for_account", { uid: user.id }),
        "partner_id_for_account",
      ).data
    : null;

  // Pas de pagination pour ce lot (échelle du métier jugée faible — un prestataire gère rarement
  // plus qu'une poignée d'établissements).
  //
  // Les 5 requêtes ci-dessous ne dépendent que de `partnerId` (déjà résolu), jamais l'une de
  // l'autre — lancées en parallèle plutôt qu'attendues séquentiellement, même raisonnement que
  // l'ancien establishment/page.tsx.
  const [
    establishmentsResult,
    pendingEstablishmentEditsResult,
    pendingEstablishmentCreationsResult,
    productsResult,
    pendingProductCreationsResult,
  ] = await Promise.all([
    partnerId
      ? supabase
          .from("establishments")
          .select("id, name, status")
          .eq("partner_id", partnerId)
          .order("created_at", { ascending: false })
      : { data: null as { id: string; name: unknown; status: string }[] | null, error: null },
    partnerId
      ? supabase
          .from("establishment_proposals")
          .select("id, establishment_id")
          .eq("partner_id", partnerId)
          .eq("kind", "edit")
          .eq("status", "pending")
      : { data: null as { id: string; establishment_id: string }[] | null, error: null },
    // Refonte 2026-08-19 (retrait du plafond "1 pending", migration
    // 20260819220000_establishment_creation_no_pending_cap.sql) : un partenaire peut désormais
    // avoir PLUSIEURS propositions de création pending en parallèle — liste, jamais .maybeSingle()
    // (qui échouerait dès la 2e ligne).
    partnerId
      ? supabase
          .from("establishment_proposals")
          .select("id, payload, created_at")
          .eq("partner_id", partnerId)
          .eq("kind", "create")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
      : { data: null as { id: string; payload: unknown; created_at: string }[] | null, error: null },
    partnerId
      ? supabase
          .from("products")
          .select(
            "id, type, name, price_cop, establishment_id, sellable, lobby_category_id, evento_capacity_mode, product_tag_assignments(catalog_tags(id, label))",
          )
          .eq("partner_id", partnerId)
          .order("created_at", { ascending: false })
          .returns<ProductQueryRow[]>()
      : { data: null as ProductQueryRow[] | null, error: null },
    partnerId
      ? supabase
          .from("product_proposals")
          .select("id, type, payload, establishment_id, created_at")
          .eq("partner_id", partnerId)
          .eq("kind", "create")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .returns<PendingCreationProposalRow[]>()
      : { data: null as PendingCreationProposalRow[] | null, error: null },
  ]);
  const { data: establishments } = checkedRead(establishmentsResult, "establishments");
  const { data: pendingEstablishmentEdits } = checkedRead(pendingEstablishmentEditsResult, "establishment_proposals");
  const { data: pendingEstablishmentCreations } = checkedRead(
    pendingEstablishmentCreationsResult,
    "establishment_proposals",
  );
  const { data: products } = checkedRead(productsResult, "products");
  const { data: pendingProductCreationsRaw } = checkedRead(pendingProductCreationsResult, "product_proposals");

  const establishmentIds = (establishments ?? []).map((e) => e.id);
  const productIds = (products ?? []).map((p) => p.id);

  // 3 vagues dépendantes des ids ci-dessus (établissements/produits de cette page), jamais lancées
  // à vide — même idiome que l'ancien products/page.tsx.
  const [establishmentMediaResult, productMediaResult, pendingProductEditsResult, slotRulesResult] =
    await Promise.all([
      establishmentIds.length > 0
        ? supabase
            .from("establishment_media")
            .select("id, establishment_id, storage_path")
            .in("establishment_id", establishmentIds)
            .order("sort", { ascending: true })
        : Promise.resolve({ data: [] as { id: string; establishment_id: string; storage_path: string }[], error: null }),
      productIds.length > 0
        ? supabase
            .from("product_media")
            .select("id, product_id, storage_path")
            .in("product_id", productIds)
            .order("sort", { ascending: true })
        : Promise.resolve({ data: [] as { id: string; product_id: string; storage_path: string }[], error: null }),
      productIds.length > 0
        ? supabase
            .from("product_proposals")
            .select("product_id")
            .in("product_id", productIds)
            .eq("kind", "content")
            .eq("status", "pending")
        : Promise.resolve({ data: [] as { product_id: string | null }[], error: null }),
      productIds.length > 0
        ? supabase.from("product_slot_rules").select("product_id").in("product_id", productIds)
        : Promise.resolve({ data: [] as { product_id: string }[], error: null }),
    ]);
  const { data: establishmentMediaRaw } = checkedRead(establishmentMediaResult, "establishment_media");
  const { data: productMediaRaw } = checkedRead(productMediaResult, "product_media");
  const { data: pendingProductEditsRaw } = checkedRead(pendingProductEditsResult, "product_proposals");
  const { data: slotRulesRaw } = checkedRead(slotRulesResult, "product_slot_rules");

  const photosByEstablishment = new Map<string, { id: string; url: string }[]>();
  for (const media of establishmentMediaRaw ?? []) {
    const url = supabase.storage.from("catalog-media").getPublicUrl(media.storage_path).data.publicUrl;
    const list = photosByEstablishment.get(media.establishment_id) ?? [];
    list.push({ id: media.id, url });
    photosByEstablishment.set(media.establishment_id, list);
  }

  const photosByProduct = new Map<string, { id: string; url: string }[]>();
  for (const media of productMediaRaw ?? []) {
    const url = supabase.storage.from("catalog-media").getPublicUrl(media.storage_path).data.publicUrl;
    const list = photosByProduct.get(media.product_id) ?? [];
    list.push({ id: media.id, url });
    photosByProduct.set(media.product_id, list);
  }

  const pendingEditByEstablishment = new Map(
    (pendingEstablishmentEdits ?? []).map((p) => [p.establishment_id, p.id]),
  );
  const pendingEditProductIds = new Set((pendingProductEditsRaw ?? []).map((p) => p.product_id));
  const slotRulesProductIds = new Set((slotRulesRaw ?? []).map((r) => r.product_id));

  const establishmentRows: EstablishmentCardRow[] = (establishments ?? []).map((establishment) => {
    const name = resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id;
    return {
      id: establishment.id,
      name,
      status: establishment.status,
      pendingEdit: pendingEditByEstablishment.has(establishment.id),
      photos: (photosByEstablishment.get(establishment.id) ?? []).map((photo) => ({
        id: photo.id,
        url: photo.url,
        alt: name,
      })),
    };
  });

  const productsByEstablishment = new Map<string, ProductCardRow[]>();
  for (const product of products ?? []) {
    const name = resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id;
    const row: ProductCardRow = {
      id: product.id,
      type: product.type,
      name,
      priceCop: product.price_cop,
      sellable: product.sellable,
      tags: (product.product_tag_assignments ?? [])
        .map((a) => (a.catalog_tags ? resolveLocalizedField(asLocalizedField(a.catalog_tags.label), "es") : null))
        .filter((label): label is string => Boolean(label)),
      photos: (photosByProduct.get(product.id) ?? []).map((photo) => ({ id: photo.id, url: photo.url, alt: name })),
      pendingEdit: pendingEditProductIds.has(product.id),
      hasSlotRules: slotRulesProductIds.has(product.id),
      // Même règle que packages/domain isPmsBacked : lodging + lobby_category_id renseigné.
      isPmsBacked: product.type === "lodging" && product.lobby_category_id != null,
      eventoCapacityMode: product.evento_capacity_mode,
    };
    const list = productsByEstablishment.get(product.establishment_id) ?? [];
    list.push(row);
    productsByEstablishment.set(product.establishment_id, list);
  }

  const pendingProductCreationsByEstablishment = new Map<string, PendingProductCreationRow[]>();
  for (const proposal of pendingProductCreationsRaw ?? []) {
    if (!proposal.establishment_id) continue;
    const row: PendingProductCreationRow = {
      id: proposal.id,
      type: proposal.type,
      payload: proposal.payload,
      created_at: proposal.created_at,
    };
    const list = pendingProductCreationsByEstablishment.get(proposal.establishment_id) ?? [];
    list.push(row);
    pendingProductCreationsByEstablishment.set(proposal.establishment_id, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">Mi establecimiento y actividades</h1>
        <div className="flex flex-wrap gap-2">
          {/* Sans établissement existant, l'écran /partner/products/new n'a nulle part où proposer
              l'activité (message "Aún no tienes ningún establecimiento con capacidad de operador
              activa.") — bouton réservé au cas où au moins un existe déjà, comme celui-ci. */}
          {establishmentRows.length > 0 ? (
            <Link
              href="/partner/products/new"
              className={buttonVariants({ size: "sm" })}
              data-testid="add-new-activity-link"
            >
              Añadir actividad
            </Link>
          ) : null}
          <Link
            href="/partner/establishment/new"
            className={buttonVariants({ size: "sm" })}
            data-testid="propose-new-establishment-link"
          >
            Proponer un nuevo establecimiento
          </Link>
        </div>
      </div>

      {(pendingEstablishmentCreations ?? []).map((proposal) => (
        <PendingCreationBanner key={proposal.id} proposal={proposal} />
      ))}

      {establishmentRows.length === 0 && (pendingEstablishmentCreations ?? []).length === 0 ? (
        <EmptyStateCta
          title="Aún no tienes ningún establecimiento"
          description="Añade tu establecimiento para empezar a publicar actividades y recibir reservas."
          actionHref="/partner/establishment/new"
          actionLabel="Añadir establecimiento"
          testId="empty-establishments"
        />
      ) : (
        <div className="flex flex-col gap-8" data-testid="establishment-list">
          {establishmentRows.map((establishment) => (
            <EstablishmentStack
              key={establishment.id}
              establishment={establishment}
              products={productsByEstablishment.get(establishment.id) ?? []}
              pendingProductCreations={pendingProductCreationsByEstablishment.get(establishment.id) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
