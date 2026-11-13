"use client";

import { Chip, DataList, type DataListAction, type DataListColumn, type DataListSort } from "@hifago/ui";
import { formatCop } from "@hifago/domain";
import { COMMISSIONS_FILTERS } from "@/lib/lists/filters";
import { COMMISSION_STATE_LABELS } from "./commissionStateLabels";

// Spec 19 §0 Tranche 0 — vocabulaire réel de ledger_entries.status (check constraint, migration
// 20260818120000), plus « Pagada » que l'ancienne dérivation (deriveLedgerEntry) ne pouvait
// structurellement jamais produire. Mapping direct sur l'ancien vocabulaire déjà validé
// (cahier des charges socio §3c) pour préserver les libellés déjà vus par les référents :
// estimated↔estimated, due↔« earned » (ganada, pas encore payée), void↔« redistributed »
// (redirigée au prestataire — no_show/cancelled_by_client), reversed↔« voided » (annulation
// prestataire, rien n'a été vendu).
export type CommissionRow = {
  id: string;
  date: string;
  productName: string;
  establishmentName: string;
  holderName: string;
  referrerPct: number;
  totalCop: number;
  referrerCommissionCop: number;
  /** Frais Mercado Pago retenus (option 17 %), ou null. */
  feeNote: string | null;
  state: "estimated" | "due" | "paid" | "reversed" | "void";
};

export type CommissionTotals = { estimated: number; due: number; paid: number; void: number };

export type CommissionsTableProps = {
  rows: CommissionRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: DataListSort;
  filterValues: Record<string, string>;
  extraParams: Record<string, string>;
  totals: CommissionTotals;
};

// Chip (pas Badge) : le Badge de HeroUI v3 est un indicateur d'ancrage pour Avatar/icône (dot ou
// compteur positionné via Badge.Anchor), pas une étiquette de statut autonome dans une cellule de
// tableau — Chip est l'équivalent direct de l'ancien Badge shadcn ici. `color` porte le sens
// sémantique de chaque état (success = acquis/payé, warning = réattribué ailleurs, danger = exclu,
// default = encore incertain) là où l'ancien variant shadcn n'était que visuel. Labels dans
// commissionStateLabels.ts (partagé avec le filtre "Estado" et la fiche détail, jamais dupliqués).
const STATE_META: Record<
  CommissionRow["state"],
  { variant: "primary" | "secondary" | "tertiary" | "soft"; color: "default" | "accent" | "success" | "warning" | "danger" }
> = {
  estimated: { variant: "soft", color: "default" },
  due: { variant: "primary", color: "success" },
  paid: { variant: "primary", color: "accent" },
  void: { variant: "soft", color: "warning" },
  reversed: { variant: "soft", color: "danger" },
};

// Filtres date/état (retour Jérôme, 2026-08-20) — migré vers DataList (spec 10, pagination/tri/
// filtres serveur), même patron que ReservationsTable.tsx/OrdersTable.tsx — y compris son lien de
// ligne par défaut (`${basePath}/${id}`), qui pointe désormais vers une vraie fiche détail
// (`commissions/[id]/page.tsx`, nouvelle). Colonnes embarquées (Producto/Establecimiento/Cliente/
// % referido) restent non triables, comme dans OrdersTable.tsx — seule `created_at` (colonne propre
// à ledger_entries, jamais affichée) sert de tri serveur, cf. lib/lists/sortable-columns.ts.
// `totals` vient de page.tsx (agrégé sur TOUTES les entrées filtrées, pas seulement la page
// affichée — sinon un total mentirait dès la page 2).
export function CommissionsTable({
  rows,
  page,
  pageSize,
  totalCount,
  sort,
  filterValues,
  extraParams,
  totals,
}: CommissionsTableProps) {
  const columns: DataListColumn<CommissionRow>[] = [
    { id: "date", header: "Fecha" },
    { id: "productName", header: "Producto" },
    { id: "establishmentName", header: "Establecimiento" },
    { id: "holderName", header: "Cliente" },
    { id: "totalCop", header: "Monto total", align: "right", cell: (row) => formatCop(row.totalCop) },
    {
      id: "referrerPct",
      header: "% referido",
      align: "right",
      cell: (row) => `${Math.round(row.referrerPct * 100)}%`,
    },
    {
      id: "referrerCommissionCop",
      header: "Comisión referente",
      align: "right",
      cell: (row) => (
        <span className="flex flex-col items-end">
          <span data-testid={`referrer-commission-${row.id}`}>{formatCop(row.referrerCommissionCop)}</span>
          {row.feeNote ? (
            <span className="text-xs text-muted" data-testid={`referrer-commission-fee-${row.id}`}>
              {row.feeNote}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "state",
      header: "Estado",
      cell: (row) => (
        <Chip
          variant={STATE_META[row.state].variant}
          color={STATE_META[row.state].color}
          data-testid={`commission-state-${row.id}`}
        >
          {COMMISSION_STATE_LABELS[row.state]}
        </Chip>
      ),
    },
  ];

  // "Ver detalle" explicite (spec 10, retour Jérôme sur TagsList.tsx : le lien de ligne furtif par
  // défaut de DataList est en pratique injoignable/invisible) — le clic sur la ligne reste un
  // raccourci silencieux vers la même fiche, jamais retiré, mais plus le seul chemin.
  const actions: DataListAction<CommissionRow>[] = [
    {
      id: "view",
      label: "Ver detalle",
      href: (row) => `/partner/commissions/${row.id}`,
      testId: (row) => `view-commission-link-${row.id}`,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* "reversed" (Excluida, annulation prestataire) reste hors totaux, comme l'ancien "voided" —
          rien n'est dû à personne dans ce cas, un total afficherait un montant qui n'existe pas. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="commission-totals">
        <div className="rounded-lg border bg-surface p-4">
          <p className="text-sm text-muted">Estimado</p>
          <p className="text-lg font-semibold" data-testid="total-estimated">
            {formatCop(totals.estimated)}
          </p>
        </div>
        <div className="rounded-lg border bg-surface p-4">
          <p className="text-sm text-muted">Ganado, por pagar</p>
          <p className="text-lg font-semibold" data-testid="total-earned">
            {formatCop(totals.due)}
          </p>
        </div>
        <div className="rounded-lg border bg-surface p-4">
          <p className="text-sm text-muted">Pagado</p>
          <p className="text-lg font-semibold" data-testid="total-paid">
            {formatCop(totals.paid)}
          </p>
        </div>
        <div className="rounded-lg border bg-surface p-4">
          <p className="text-sm text-muted">Reasignado</p>
          <p className="text-lg font-semibold" data-testid="total-redistributed">
            {formatCop(totals.void)}
          </p>
        </div>
      </div>

      <DataList
        rows={rows}
        getRowId={(row) => row.id}
        columns={columns}
        actions={actions}
        basePath="/partner/commissions"
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        sort={sort}
        filters={COMMISSIONS_FILTERS}
        filterValues={filterValues}
        extraParams={extraParams}
        ariaLabel="Mis comisiones"
        rowTestIdPrefix="commission"
        emptyMessage="Ninguna comisión todavía."
        emptyTestId="no-commissions"
      />
    </div>
  );
}
