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
  sellable: boolean;
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
    supabase.from("establishments").select("id, name").order("name->>es", { ascending: true }).limit(10),
    // Revue admin étiquettes (Jérôme, 2026-08-20) — pas de plafond ni d'échappatoire texte
    // (contrairement à établissement, cf. commentaire ci-dessous) : catalog_tags est une
    // taxonomie curée par l'admin (dizaines attendues), pas une collection qui grossit à chaque
    // création d'établissement — un <select> simple suffit, même famille que "Tipo"/"Estado".
    supabase.from("catalog_tags").select("id, label").order("label->>es", { ascending: true }),
  ]);
  // Une panne LÈVE (lib/supabase/checkedRead.ts) : des filtres vides la cacheraient.
  const { data: establishments } = checkedRead(establishmentsResult, "establishments");
  const { data: tags } = checkedRead(tagsResult, "catalog_tags");
  const establishmentOptions = (establishments ?? []).map((establishment) => ({
    value: establishment.id,
    label: resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id,
  }));
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
  let selectColumns = "id, name, type, price_cop, sellable, establishments!inner(name)";
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

  const rows: ProductRow[] = (products ?? []).map((product) => ({
    id: product.id,
    name: resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id,
    establishmentName:
      resolveLocalizedField(asLocalizedField(product.establishments?.name), "es") ?? "—",
    type: product.type,
    priceCop: product.price_cop,
    sellable: product.sellable,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Catálogo</h1>
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
        tagOptions={tagOptions}
      />
    </div>
  );
}
