import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { asLocalizedField, resolveLocalizedField, resolveListParams } from "@hifago/domain";
import { buttonVariants } from "@hifago/ui";
import { ProductsList, type ProductRow } from "./ProductsList";
import { PRODUCTS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { PRODUCTS_DEFAULT_SORT, PRODUCTS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";

type ProductQueryRow = {
  id: string;
  name: unknown;
  type: string;
  price_cop: number | null;
  price_tiers: unknown;
  is_free: boolean;
  sellable: boolean;
  establishment_id: string;
  establishments: { name: unknown } | null;
  product_tag_assignments?: { tag_id: string }[];
};

// docs/specs/02-admin-accueil-et-navigation.md §5.5 — la liste manquait, seuls
// new/edit/availability existaient (aucune vue neutre du catalogue).
// docs/specs/10-listes-standardisees-admin-socio.md — écran pilote (2e) : 1er vrai passage du
// `Table` compound HeroUI vers `DataList`, pagination ET tri désormais tous les deux serveur.
export default async function AdminProductsPage({
  searchParams,
}: PageProps<"/admin/products">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: PRODUCTS_SORT_WHITELIST,
      defaultSort: PRODUCTS_DEFAULT_SORT,
      filters: PRODUCTS_FILTER_DEFINITIONS,
    }
  );

  const supabase = await createClient();

  // Revue admin catalogo (Jérôme, 2026-08-19) — options du filtre "Establecimiento" construites à
  // la volée (établissements dynamiques, jamais une liste fermée écrite en dur dans filters.ts,
  // contrairement à type/sellable). establishment_id est une vraie colonne FK sur products — un
  // simple .eq() suffit, pas besoin de RPC ni de contourner une limite PostgREST comme pour la
  // recherche établissement/partenaire (aucun .or() ici, aucune combinaison colonne de base +
  // colonne de relation embarquée).
  //
  // Retour Jérôme : le dropdown seul ne passe pas à l'échelle (établissements dynamiques, en
  // croissance continue) — plafonné à 10 (ordre alphabétique, le plus prévisible sans introduire
  // d'agrégat "les plus utilisés" non demandé), complété par un champ texte `establishment_q` en
  // échappatoire pour chercher un établissement absent des 10 visibles. Les deux ne se combinent
  // jamais : establishment_id (dropdown) prioritaire s'il est posé, sinon establishment_q (texte).
  // Les deux ne dépendent que du filtre "établissement" respectif, jamais l'un de l'autre —
  // lancées en concurrence (même idiome que la fiche client, [client_key]/page.tsx).
  const [establishmentsResult, tagsResult] = await Promise.all([
    // Édition en ligne (2026-10-13) : la cellule « Establecimiento » propose TOUS les
    // établissements (une fiche peut partir vers n'importe lequel), donc plus de `.limit(10)` sur
    // la requête. Le plafond de 10 du FILTRE est inchangé : il est repris plus bas par un
    // `slice(0, 10)` sur ce même ordre alphabétique — mêmes dix options qu'avant.
    supabase.from("establishments").select("id, name").order("name->>es", { ascending: true }),
    // Revue admin étiquettes (Jérôme, 2026-08-20) — pas de plafond ni d'échappatoire texte
    // (contrairement à établissement, cf. commentaire ci-dessous) : catalog_tags est une
    // taxonomie curée par l'admin (dizaines attendues), pas une collection qui grossit à chaque
    // création d'établissement — un <select> simple suffit, même famille que "Tipo"/"Estado".
    supabase.from("catalog_tags").select("id, label").order("label->>es", { ascending: true }),
  ]);
  // Une panne LÈVE (lib/supabase/checkedRead.ts) : des filtres vides la cacheraient.
  const { data: establishments } = checkedRead(establishmentsResult, "establishments");
  const { data: tags } = checkedRead(tagsResult, "catalog_tags");
  const allEstablishmentOptions = (establishments ?? []).map((establishment) => ({
    value: establishment.id,
    label: resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id,
  }));
  const establishmentOptions = allEstablishmentOptions.slice(0, 10);
  const tagOptions = (tags ?? []).map((tag) => ({
    value: tag.id,
    label: resolveLocalizedField(asLocalizedField(tag.label), "es") ?? tag.id,
  }));

  // establishments!inner (pas le embed par défaut) : establishment_id est not null sur products,
  // donc ça ne change jamais l'ensemble de résultats — juste ce qui permet d'appliquer un .ilike()
  // sur establishments.name (colonne d'une relation embarquée) sans RPC, tant que ce n'est jamais
  // combiné à une autre condition via .or() (limite déjà documentée pour établissements/clientes).
  // product_tag_assignments!inner : ajouté au select UNIQUEMENT si tag_id est actif (chaîne
  // construite dynamiquement) — jamais structurel comme establishments!inner, sinon tout produit
  // sans aucune étiquette disparaîtrait de la liste par défaut (même piège LEFT JOIN vs INNER JOIN
  // déjà documenté pour list_partners_admin). (product_id, tag_id) est la clé primaire de la table
  // : filtrer sur un tag_id précis ne peut jamais dupliquer une ligne produit.
  let selectColumns =
    "id, name, type, price_cop, price_tiers, is_free, sellable, establishment_id, establishments!inner(name)";
  if (filters.tag_id) {
    selectColumns += ", product_tag_assignments!inner(tag_id)";
  }

  let query = supabase
    .from("products")
    .select(selectColumns, { count: "exact" })
    .order(sort.column, { ascending: sort.direction === "asc" })
    .range(from, to);

  if (filters.q) {
    query = query.ilike("name->>es", `%${filters.q}%`);
  }
  if (filters.type) {
    query = query.eq("type", filters.type);
  }
  if (filters.sellable) {
    query = query.eq("sellable", filters.sellable === "true");
  }
  if (filters.establishment_id) {
    query = query.eq("establishment_id", filters.establishment_id);
  } else if (filters.establishment_q) {
    query = query.ilike("establishments.name->>es", `%${filters.establishment_q}%`);
  }
  if (filters.tag_id) {
    query = query.eq("product_tag_assignments.tag_id", filters.tag_id);
  }

  const { data: products, count } = checkedRead(await query.returns<ProductQueryRow[]>(), "products");

  // Étiquettes de la page courante, pour la colonne éditable « Etiquetas » — par une requête À
  // PART, jamais par l'embed `product_tag_assignments!inner` ci-dessus : sous le filtre `tag_id`,
  // cet embed ne rend que l'étiquette filtrée. La cellule afficherait alors une seule étiquette,
  // et l'enregistrer (la RPC REMPLACE les assignations) retirerait toutes les autres.
  const productIds = (products ?? []).map((product) => product.id);
  const { data: tagAssignments } =
    productIds.length > 0
      ? checkedRead(
          await supabase.from("product_tag_assignments").select("product_id, tag_id").in("product_id", productIds),
          "product_tag_assignments",
        )
      : { data: [] as { product_id: string; tag_id: string }[] };
  const tagIdsByProduct = new Map<string, string[]>();
  for (const assignment of tagAssignments ?? []) {
    tagIdsByProduct.set(assignment.product_id, [
      ...(tagIdsByProduct.get(assignment.product_id) ?? []),
      assignment.tag_id,
    ]);
  }

  const rows: ProductRow[] = (products ?? []).map((product) => {
    // `price_tiers` vaut souvent `'null'::jsonb` (pas SQL NULL) : seul un tableau non vide est un
    // vrai barème — même lecture que la garde `price_has_tiers` de admin_update_product_inline.
    const hasPriceTiers = Array.isArray(product.price_tiers) && product.price_tiers.length > 0;
    return {
      id: product.id,
      name: resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id,
      establishmentId: product.establishment_id,
      establishmentName:
        resolveLocalizedField(asLocalizedField(product.establishments?.name), "es") ?? "—",
      type: product.type,
      priceCop: product.price_cop,
      priceMode: product.is_free ? "free" : hasPriceTiers ? "tiers" : product.price_cop === null ? "none" : "simple",
      sellable: product.sellable,
      tagIds: tagIdsByProduct.get(product.id) ?? [],
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="titre-page">Catálogo</h1>
        <Link href="/admin/products/new" className={buttonVariants()} data-testid="new-product-link">
          Nueva actividad
        </Link>
      </div>
      <ProductsList
        rows={rows}
        page={page}
        pageSize={pageSize}
        totalCount={count ?? 0}
        sort={sort}
        filterValues={filters}
        extraParams={extraParams}
        establishmentOptions={establishmentOptions}
        allEstablishmentOptions={allEstablishmentOptions}
        tagOptions={tagOptions}
      />
    </div>
  );
}
