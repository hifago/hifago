import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { asLocalizedField, formatCop, resolveLocalizedField } from "@hifago/domain";
import { KpiCard } from "@hifago/ui";
import { SalesChart } from "./charts/SalesChart";
import { CommissionsChart } from "./charts/CommissionsChart";
import { TopPartnersChart } from "./charts/TopPartnersChart";
import { CatalogHealthChart } from "./charts/CatalogHealthChart";
import { AdminAlerts } from "./AdminAlerts";
import { RecentList } from "./RecentList";
import { computeDateWindow } from "./dateWindow";

// Feature 27 (docs/specs/02-admin-accueil-et-navigation.md §5.2) — remplace le simple
// `redirect("/admin/establishments")` qui faisait office de page d'accueil jusqu'ici. Reprend/
// améliore les 3 KPIs du dashboard legacy (`public/admin.js:208-234`) + ajoute les graphiques
// d'évolution décidés au cahier des charges admin §2 (indicateurs tranchés dans la spec, le
// principe seul était acté). Commissions toujours qualifiées « generadas », jamais « a pagar » —
// aucun ledger dû/payé n'existe encore côté hifago (spec §1, constat 1).

export default async function AdminHomePage({
  searchParams,
}: PageProps<"/admin">) {
  const resolvedSearchParams = await searchParams;
  const windowParam = resolvedSearchParams?.window;
  const windowDays = windowParam === "90" ? 90 : 30;

  const supabase = await createClient();
  const { since, todayIso, days } = computeDateWindow(windowDays);

  // KPI et graphiques : quatre agrégats SQL (20260930221527), chacun rend une ligne ou une ligne par
  // jour/partenaire. Avant, cinq RPC rendaient une ligne par `order_line`, sommée ici en JS —
  // tronquée par `max_rows` au-delà de 1000 — et filtraient un statut `'confirmed'` qui n'existe
  // plus. Les statuts comptés comme vente sont ceux de la spec 02 §5.2, écrits dans la migration.
  // Une erreur LÈVE au lieu de s'afficher en 0 : un KPI faux mais plausible est pire qu'une page
  // en erreur.
  const [
    totalsRes,
    referrerCommissionsRes,
    establishmentsCountRes,
    dailySeriesRes,
    topPartnersRes,
    productProposalsPendingRes,
    establishmentProposalsPendingRes,
    reconciliationOpenRes,
    paymentReconciliationOpenRes,
    recentPartnersRes,
    recentEstablishmentsRes,
    catalogSellableRes,
    catalogDraftRes,
    catalogProposalPendingRes,
    catalogProposalRejectedRes,
    recentClientsRes,
  ] = await Promise.all([
    supabase.rpc("admin_dashboard_totals", { p_today: todayIso }),
    supabase.rpc("admin_dashboard_referrer_commissions"),
    supabase.from("establishments").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.rpc("admin_dashboard_daily_series", { p_since: since }),
    // Volume = ventes des établissements du partenaire (le vendeur), pas le référent qui a apporté
    // la commande — lecture « qui a généré le plus » du cahier des charges §2, la même que la table
    // « Détail par Hostel » du legacy.
    supabase.rpc("admin_dashboard_top_partners", { p_limit: 8 }),
    // Alerte « propuestas pendientes » : les DEUX tables, comme la pastille de la sidebar
    // (admin/layout.tsx) — sinon l'accueil annonçait moins de propositions que la sidebar.
    supabase.from("product_proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("establishment_proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("pms_reconciliation_entries")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "retrying"]),
    supabase
      .from("payment_reconciliation_entries")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "retrying"]),
    supabase.from("partners").select("id, display_name").order("created_at", { ascending: false }).limit(5),
    supabase
      .from("establishments")
      .select("id, name, partners(display_name)")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("sellable", true),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("sellable", false),
    supabase.from("product_proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("product_proposals").select("id", { count: "exact", head: true }).eq("status", "rejected"),
    // « Clientes recientes » : les clients qui ont commandé le plus récemment, même RPC et même
    // notion de client que /admin/clients (list_clients, réservée à l'admin) — le bloc était
    // jusqu'ici une liste vide figée.
    supabase.rpc("list_clients", { p_sort_key: "last_order_at", p_sort_desc: true, p_limit: 5 }),
  ]);

  // TOUTES les lectures lèvent sur une panne (lib/supabase/checkedRead.ts), pas seulement les
  // agrégats (2026-10-04) : les compteurs des alertes « Pendientes », de la santé du catalogue et
  // les listes récentes étaient gardés en variables puis lus en `?? 0` sans leur `error` — une panne
  // s'affichait « 0 propuestas » ou « nada que conciliar ». Les `?? 0` ci-dessous ne lisent donc
  // plus jamais qu'une absence réelle.
  checkedRead(totalsRes, "admin_dashboard_totals");
  checkedRead(referrerCommissionsRes, "admin_dashboard_referrer_commissions");
  checkedRead(establishmentsCountRes, "establishments (activos)");
  checkedRead(dailySeriesRes, "admin_dashboard_daily_series");
  checkedRead(topPartnersRes, "admin_dashboard_top_partners");
  checkedRead(productProposalsPendingRes, "product_proposals (pendientes)");
  checkedRead(establishmentProposalsPendingRes, "establishment_proposals (pendientes)");
  checkedRead(reconciliationOpenRes, "pms_reconciliation_entries");
  checkedRead(paymentReconciliationOpenRes, "payment_reconciliation_entries");
  checkedRead(recentPartnersRes, "partners (recientes)");
  checkedRead(recentEstablishmentsRes, "establishments (recientes)");
  checkedRead(catalogSellableRes, "products (publicados)");
  checkedRead(catalogDraftRes, "products (borradores)");
  checkedRead(catalogProposalPendingRes, "product_proposals (catálogo, pendientes)");
  checkedRead(catalogProposalRejectedRes, "product_proposals (rechazadas)");
  checkedRead(recentClientsRes, "list_clients");

  const totals = totalsRes.data?.[0];
  const totalRevenue = totals?.revenue_cop ?? 0;
  const totalCommission = (totals?.referrer_commission_cop ?? 0) + (totals?.app_commission_cop ?? 0);

  // Répartition par bénéficiaire (chips, même esprit que « commission par payeur » du legacy) —
  // déjà triée par montant décroissant côté SQL.
  const referrerCommissions = referrerCommissionsRes.data ?? [];

  const topPartners = (topPartnersRes.data ?? []).map((row) => ({
    name: row.partner_display_name,
    total: row.total_cop,
  }));

  // Séries journalières pour les 2 premiers graphiques — un seau par jour dans la fenêtre
  // (`days` déjà calculé par computeDateWindow, cf. import) ; un jour sans vente reste à zéro, et
  // une date de service hors de la fenêtre (une réservation à venir) est ignorée.
  const dailyByDay = new Map((dailySeriesRes.data ?? []).map((row) => [row.date, row]));
  const salesSeries = days.map((day) => ({ day, ventas: dailyByDay.get(day)?.sales_cop ?? 0 }));
  const commissionsSeries = days.map((day) => ({
    day,
    referente: dailyByDay.get(day)?.referrer_commission_cop ?? 0,
    app: dailyByDay.get(day)?.app_commission_cop ?? 0,
  }));

  const catalogHealth = [
    { name: "Publicado", value: catalogSellableRes.count ?? 0 },
    { name: "Borrador", value: catalogDraftRes.count ?? 0 },
    { name: "En revisión", value: catalogProposalPendingRes.count ?? 0 },
    { name: "Rechazado", value: catalogProposalRejectedRes.count ?? 0 },
  ];

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Inicio</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard testId="kpi-revenue" label="Ingresos generados" value={formatCop(totalRevenue)} />
        <KpiCard
          testId="kpi-commissions"
          label="Comisiones generadas"
          value={formatCop(totalCommission)}
          sublabel={
            referrerCommissions.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {referrerCommissions.slice(0, 3).map((row) => (
                  <a
                    key={row.referrer_partner_id}
                    href={`/admin/partners/${row.referrer_partner_id}`}
                    className="rounded bg-surface-secondary px-1.5 py-0.5 text-[11px] hover:underline"
                  >
                    {formatCop(row.referrer_commission_cop)}
                  </a>
                ))}
              </div>
            ) : undefined
          }
        />
        <KpiCard
          testId="kpi-establishments"
          label="Establecimientos activos"
          value={String(establishmentsCountRes.count ?? 0)}
        />
        <KpiCard
          testId="kpi-pending-orders"
          label="Pedidos pendientes de acción"
          value={String(totals?.pending_count ?? 0)}
          sublabel="Fecha de servicio ya pasada, aún sin resolver"
        />
      </div>

      <AdminAlerts
        proposalsPending={(productProposalsPendingRes.count ?? 0) + (establishmentProposalsPendingRes.count ?? 0)}
        reconciliationOpen={reconciliationOpenRes.count ?? 0}
        paymentReconciliationOpen={paymentReconciliationOpenRes.count ?? 0}
      />

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">Ventana:</span>
        <a
          href="/admin?window=30"
          className={windowDays === 30 ? "font-semibold underline" : "text-muted hover:underline"}
          data-testid="window-30"
        >
          30 días
        </a>
        <a
          href="/admin?window=90"
          className={windowDays === 90 ? "font-semibold underline" : "text-muted hover:underline"}
          data-testid="window-90"
        >
          90 días
        </a>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SalesChart data={salesSeries} />
        <CommissionsChart data={commissionsSeries} />
        <TopPartnersChart data={topPartners} />
        <CatalogHealthChart data={catalogHealth} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RecentList
          title="Partners recientes"
          href="/admin/partners"
          items={(recentPartnersRes.data ?? []).map((partner) => ({
            id: partner.id,
            label: partner.display_name,
            href: `/admin/partners/${partner.id}`,
          }))}
        />
        <RecentList
          title="Establecimientos recientes"
          href="/admin/establishments"
          items={(recentEstablishmentsRes.data ?? []).map((establishment) => ({
            id: establishment.id,
            label:
              resolveLocalizedField(asLocalizedField(establishment.name), "es") ?? establishment.id,
            sublabel: establishment.partners?.display_name,
            href: `/admin/establishments/${establishment.id}`,
          }))}
        />
        <RecentList
          title="Clientes recientes"
          href="/admin/clients"
          emptyHint="Ningún cliente todavía."
          items={(recentClientsRes.data ?? []).map((client) => ({
            id: client.client_key,
            label: client.display_name ?? client.email ?? client.client_key,
            sublabel: client.display_name ? client.email : null,
            // client_key n'est pas un uuid (email ou téléphone en repli) : encodé, comme sur
            // /admin/clients.
            href: `/admin/clients/${encodeURIComponent(client.client_key)}`,
          }))}
        />
      </div>
    </div>
  );
}
