import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, resolveLocalizedField, resolveListParams } from "@hifago/domain";
import { NewTagForm } from "./NewTagForm";
import { TagsList, type TagRow } from "./TagsList";
import { TAGS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { TAGS_DEFAULT_SORT, TAGS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";
import { quotePostgrestValue } from "@/lib/lists/postgrestFilterValue";

// docs/specs/08-admin-gestion-activite.md §5 — catalogue de tags, remplace la catégorie fixe
// (products.category) côté écran admin direct.
// docs/specs/10-listes-standardisees-admin-socio.md (lot 4) — DataList, pagination activée malgré
// le volume attendu en dizaines (uniformité demandée, impact nul si le volume reste petit —
// "Página 1 de 1"). Nouvelle fiche détail /admin/tags/[id] : Eliminar y est désormais réservé
// (décision Jérôme — jamais une action de ligne sur la liste), Editar (renommer) reste en ligne
// via modal, non destructif.
export default async function AdminTagsPage({ searchParams }: PageProps<"/admin/tags">) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: TAGS_SORT_WHITELIST,
      defaultSort: TAGS_DEFAULT_SORT,
      filters: TAGS_FILTER_DEFINITIONS,
    }
  );

  const supabase = await createClient();
  let query = supabase
    .from("catalog_tags")
    .select("id, label, slug, created_at, product_tag_assignments(count)", { count: "exact" })
    .order(sort.column, { ascending: sort.direction === "asc" })
    .range(from, to);

  if (filters.q) {
    // La saisie passe entre guillemets (lib/lists/postgrestFilterValue.ts) : insérée telle quelle,
    // une virgule ou une parenthèse rendait le filtre invalide ou en changeait le sens.
    const motif = quotePostgrestValue(`%${filters.q}%`);
    query = query.or(`label->>es.ilike.${motif},slug.ilike.${motif}`);
  }

  // Une panne LÈVE (app/error.tsx) : lue comme une absence, elle affichait un catalogue vide.
  const { data: tags, count, error } = await query;
  if (error) {
    throw new Error(`Lecture des étiquettes impossible (catalog_tags) : ${error.message}`);
  }

  const rows: TagRow[] = (tags ?? []).map((tag) => ({
    id: tag.id,
    label: resolveLocalizedField(asLocalizedField(tag.label), "es") ?? tag.slug,
    usageCount: tag.product_tag_assignments[0]?.count ?? 0,
    createdAt: tag.created_at,
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Etiquetas</h1>

      <NewTagForm />

      <TagsList
        rows={rows}
        page={page}
        pageSize={pageSize}
        totalCount={count ?? 0}
        sort={sort}
        filterValues={filters}
        extraParams={extraParams}
      />
    </div>
  );
}
