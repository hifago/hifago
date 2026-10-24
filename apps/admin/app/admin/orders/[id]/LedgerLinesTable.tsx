"use client";

import { asLocalizedField, resolveLocalizedField, formatCop, displayLineStatus, type OrderPaymentState } from "@hifago/domain";
import { Chip, SimpleTable, SimpleTableBody, SimpleTableCell, SimpleTableHead, SimpleTableHeader, SimpleTableRow } from "@hifago/ui";
import { deriveLedgerEntry, type LedgerState } from "@/lib/commission/deriveLedgerEntry";
import { lineStatusChipColor, lineStatusLabel } from "@/lib/orders/paymentDisplayLabels";

// Extrait de page.tsx (Server Component) — Table/Table.ScrollContainer de @hifago/ui imbriquant un
// <Chip> côté client crashait le build ("Table.Content n'accepte jamais... depuis un Server
// Component", cf. hifago/CLAUDE.md §11) ; migré vers SimpleTable (reflow carte sous md, règle
// transverse non négociable) au passage — page.tsx ne fait plus que fetcher et passer `lines`.

const LEDGER_STATE_LABELS: Record<LedgerState, string> = {
  estimated: "Estimado",
  earned: "Ganado",
  redistributed: "Redistribuido",
  voided: "Anulado",
};

const LEDGER_STATE_CHIP_COLOR: Record<
  LedgerState,
  "default" | "accent" | "success" | "warning" | "danger"
> = {
  estimated: "default",
  earned: "accent",
  redistributed: "warning",
  voided: "danger",
};

export type OrderLineQueryRow = {
  id: string;
  date: string;
  qty: number;
  status: string;
  total_cop: number;
  acompte_cop: number;
  referrer_commission_cop: number;
  app_commission_cop: number;
  commission_case: string;
  product_name: unknown;
};

export function LedgerLinesTable({
  lines,
  paymentState,
}: {
  lines: OrderLineQueryRow[];
  /** Le paiement de la commande : une ligne `reserved` d'une commande qui l'attend s'affiche « Pendiente de pago ». */
  paymentState: OrderPaymentState;
}) {
  return (
    <SimpleTable data-testid="ledger-table" aria-label="Detalle de la comisión por línea">
      <SimpleTableHeader>
        <SimpleTableRow>
          <SimpleTableHead>Producto</SimpleTableHead>
          <SimpleTableHead>Fecha</SimpleTableHead>
          <SimpleTableHead>Cantidad</SimpleTableHead>
          <SimpleTableHead>Estado</SimpleTableHead>
          <SimpleTableHead>Parte app</SimpleTableHead>
          <SimpleTableHead>Parte referente</SimpleTableHead>
          <SimpleTableHead>Parte prestador</SimpleTableHead>
          <SimpleTableHead>Estado de comisión</SimpleTableHead>
        </SimpleTableRow>
      </SimpleTableHeader>
      <SimpleTableBody>
        {lines.length > 0 ? (
          lines.map((line) => {
            const entry = deriveLedgerEntry({
              commissionCase: line.commission_case,
              totalCop: line.total_cop,
              acompteCop: line.acompte_cop,
              referrerCommissionCop: line.referrer_commission_cop,
              appCommissionCop: line.app_commission_cop,
              lineStatus: line.status,
            });
            return (
              <SimpleTableRow key={line.id} id={line.id} data-testid={`ledger-line-${line.id}`}>
                <SimpleTableCell data-label="Producto">
                  {resolveLocalizedField(asLocalizedField(line.product_name), "es") ?? "—"}
                </SimpleTableCell>
                <SimpleTableCell data-label="Fecha">{line.date}</SimpleTableCell>
                <SimpleTableCell data-label="Cantidad">{line.qty}</SimpleTableCell>
                <SimpleTableCell data-label="Estado">
                  <Chip variant="soft" color={lineStatusChipColor(displayLineStatus(line.status, paymentState))}>
                    {lineStatusLabel(displayLineStatus(line.status, paymentState))}
                  </Chip>
                </SimpleTableCell>
                <SimpleTableCell data-label="Parte app" data-testid={`app-due-${line.id}`}>
                  {formatCop(entry.appDueCop)}
                </SimpleTableCell>
                <SimpleTableCell data-label="Parte referente" data-testid={`referrer-due-${line.id}`}>
                  {formatCop(entry.referrerDueCop)}
                </SimpleTableCell>
                <SimpleTableCell data-label="Parte prestador" data-testid={`provider-due-${line.id}`}>
                  {formatCop(entry.providerDueCop)}
                </SimpleTableCell>
                <SimpleTableCell data-label="Estado de comisión">
                  <Chip
                    variant="soft"
                    color={LEDGER_STATE_CHIP_COLOR[entry.state]}
                    data-testid={`ledger-state-${line.id}`}
                  >
                    {LEDGER_STATE_LABELS[entry.state]}
                  </Chip>
                </SimpleTableCell>
              </SimpleTableRow>
            );
          })
        ) : (
          <SimpleTableRow id="empty">
            <SimpleTableCell colSpan={8} className="text-center text-muted">
              Ninguna línea en este pedido.
            </SimpleTableCell>
          </SimpleTableRow>
        )}
      </SimpleTableBody>
    </SimpleTable>
  );
}
