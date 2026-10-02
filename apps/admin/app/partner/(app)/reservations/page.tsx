import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import {
  addDaysIso,
  asLocalizedField,
  resolveLocalizedField,
  resolveListParams,
  todayInBogota,
} from "@hifago/domain";
import { getActiveOperatorEstablishmentIds } from "@/lib/agenda/activeOperatorEstablishments";
import { RESERVATIONS_FILTER_DEFINITIONS } from "@/lib/lists/filters";
import { RESERVATIONS_DEFAULT_SORT, RESERVATIONS_SORT_WHITELIST } from "@/lib/lists/sortable-columns";
import { ReservationsTable, type ReservationRow } from "./ReservationsTable";

// Lot fuseau (2026-08-28) : ces deux helpers étaient une copie locale de plus. La fenêtre par
// défaut de « Mis Reservas » (aujourd'hui → +6 j) partait de la date UTC, donc du LENDEMAIN passé
// 19 h à Guatapé — le socio qui ouvrait son écran le soir ne voyait plus les réservations du jour
// même. C'est le second des deux écrans consultés quotidiennement. `todayInBogota`/`addDaysIso`
// (packages/domain) remplacent les deux, sans redéclaration locale.

// Spec 17 §0 Tranche 1 — « Mis Reservas ». Refonte vue prestataire (2026-08-19) : migration vers
// resolveListParams/DataList (pagination+tri serveur, filtres date/activité/client ou email/statut,
// ces 2 derniers retravaillés le 2026-08-20 — cf. ReservationsFilterBar.tsx), à la place de
// l'ancien .limit(100) sans filtre. La RLS (order_lines_select_operator, migration 20260817170000)
// suffirait seule à restreindre les lignes visibles, mais un filtre explicite sur les
// établissements réellement opérés par CE partenaire reste nécessaire (même raisonnement que
// commissions/page.tsx sur referrer_partner_id) : order_lines_select (Tranche 3, additive) laisse
// aussi remonter les lignes que ce compte aurait achetées lui-même comme simple client — hors
// sujet ici.
export default async function PartnerReservationsPage({
  searchParams,
}: PageProps<"/partner/reservations">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null; // garde déjà posée par layout.tsx — jamais atteint en pratique.
  }

  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // affichait « aucune réservation » — `partner_id_for_account` en panne vidait même la liste des
  // établissements opérés sans le dire.
  const { data: partnerId } = checkedRead(
    await supabase.rpc("partner_id_for_account", { uid: user.id }),
    "partner_id_for_account",
  );

  const resolvedSearchParams = await searchParams;
  const { page, pageSize, from, to, sort, filters, extraParams } = resolveListParams(
    resolvedSearchParams,
    {
      sortWhitelist: RESERVATIONS_SORT_WHITELIST,
      defaultSort: RESERVATIONS_DEFAULT_SORT,
      filters: RESERVATIONS_FILTER_DEFINITIONS,
    }
  );

  // Défaut "semaine à venir" (demande initiale de Jérôme, refonte vue prestataire) quand aucun
  // filtre de date n'est explicitement posé dans l'URL — un filtre déjà présent prime toujours.
  // Reflété aussi dans filterValues/extraParams pour que le formulaire de filtres affiche ces
  // dates par défaut plutôt que des champs vides, et que ServerPagination les préserve d'une page
  // à l'autre.
  const hasExplicitDateFilter = filters.date_from !== undefined || filters.date_to !== undefined;
  const dateFrom = filters.date_from ?? (hasExplicitDateFilter ? undefined : todayInBogota());
  const dateTo = filters.date_to ?? (hasExplicitDateFilter ? undefined : addDaysIso(dateFrom ?? todayInBogota(), 6));
  const filterValues = { ...filters, ...(dateFrom ? { date_from: dateFrom } : {}), ...(dateTo ? { date_to: dateTo } : {}) };
  const effectiveExtraParams = { ...extraParams, ...filterValues };

  const establishmentIds = await getActiveOperatorEstablishmentIds(supabase, partnerId);

  // Scope établissement recalculé côté SQL (has_capability), jamais par establishmentIds ci-dessus
  // — cette liste ne sert plus qu'au combobox de filtre (productOptions) un peu plus bas.
  const { data: lines } = checkedRead(
    await supabase.rpc("partner_reservations_list", {
      p_date_from: dateFrom ?? null,
      p_date_to: dateTo ?? null,
      p_product_id: filters.product_id ?? null,
      p_holder_q: filters.holder_q ?? null,
      p_status: filters.status ?? null,
      p_sort_key: sort.column,
      p_sort_desc: sort.direction === "desc",
      p_limit: to - from + 1,
      p_offset: from,
    }),
    "partner_reservations_list",
  );
  const count = !lines || lines.length === 0 ? 0 : lines[0].total_count;

  // Activités du prestataire pour le combobox de filtre (retour Jérôme, 2026-08-20) — même
  // établissements que la requête principale, jamais reposé sur products.sellable (une réservation
  // existante peut porter sur une activité entre-temps dépubliée, elle doit rester filtrable).
  const { data: productOptionsRaw } = checkedRead(
    establishmentIds.length > 0
      ? await supabase
          .from("products")
          .select("id, name")
          .in("establishment_id", establishmentIds)
          .order("name->>es", { ascending: true })
      : { data: [] as { id: string; name: unknown }[], error: null },
    "products",
  );
  const productOptions = (productOptionsRaw ?? []).map((product) => ({
    id: product.id,
    name: resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id,
  }));

  const rows: ReservationRow[] = (lines ?? []).map((line) => ({
    id: line.id,
    date: line.date,
    productName: resolveLocalizedField(asLocalizedField(line.product_name), "es") ?? "—",
    establishmentName: resolveLocalizedField(asLocalizedField(line.establishment_name), "es") ?? "—",
    holderName: line.holder_name,
    holderPhone: line.holder_phone,
    holderEmail: line.holder_email,
    qty: line.qty,
    totalCop: line.total_cop,
    status: line.status,
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mis reservas</h1>
      <ReservationsTable
        rows={rows}
        page={page}
        pageSize={pageSize}
        totalCount={count ?? 0}
        sort={sort}
        filterValues={filterValues}
        extraParams={effectiveExtraParams}
        products={productOptions}
      />
    </div>
  );
}
