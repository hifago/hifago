"use client";

import { asLocalizedField, resolveLocalizedField, formatCop, displayLineStatus, type OrderPaymentState } from "@hifago/domain";
import { Chip, SimpleTable, SimpleTableBody, SimpleTableCell, SimpleTableHead, SimpleTableHeader, SimpleTableRow } from "@hifago/ui";
import { deriveLedgerEntry } from "@/lib/commission/deriveLedgerEntry";
import { mercadoPagoFeeNote } from "@/lib/commission/mercadoPagoFeeNote";
import { lineStatusChipColor, lineStatusLabel } from "@/lib/orders/paymentDisplayLabels";
import { statusChip } from "@/components/status-chip";
import { LEDGER_STATUS_CHIP_STYLE, LEDGER_STATUS_LABELS } from "../../ledger/ledgerStatusLabels";

// Extrait de page.tsx (Server Component) — Table/Table.ScrollContainer de @hifago/ui imbriquant un
// <Chip> côté client crashait le build ("Table.Content n'accepte jamais... depuis un Server
// Component", cf. hifago/CLAUDE.md §11) ; migré vers SimpleTable (reflow carte sous md, règle
// transverse non négociable) au passage — page.tsx ne fait plus que fetcher et passer `lines`.

// « Estado de comisión » (révisé le 2026-11-12, migration 20261112200000) : le statut RÉEL de
// l'entrée du ledger, dans le même vocabulaire que /admin/ledger — « Pagada » compris. Une
// compensation d'annulation (A3) se nomme comme telle ; une ligne sans entrée n'a pas de commission.
function commissionLabel(display: ReturnType<typeof deriveLedgerEntry>["display"]): string {
  if (display.kind === "none") return "Sin comisión";
  const status = LEDGER_STATUS_LABELS[display.status] ?? display.status;
  return display.kind === "compensation" ? `Compensación · ${status}` : status;
}

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
  mp_fee_cop: number | null;
  commission_entry_status: string | null;
  commission_entry_amount_cop: number | null;
  compensation_entry_status: string | null;
  compensation_entry_amount_cop: number | null;
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
              totalCop: line.total_cop,
              acompteCop: line.acompte_cop,
              referrerCommissionCop: line.referrer_commission_cop,
              appCommissionCop: line.app_commission_cop,
              lineStatus: line.status,
              commissionEntry:
                line.commission_entry_status != null
                  ? { status: line.commission_entry_status, amountCop: line.commission_entry_amount_cop ?? 0 }
                  : null,
              compensationEntry:
                line.compensation_entry_status != null
                  ? { status: line.compensation_entry_status, amountCop: line.compensation_entry_amount_cop ?? 0 }
                  : null,
            });
            const feeNote = mercadoPagoFeeNote(line.mp_fee_cop);
            const chip = statusChip(
              LEDGER_STATUS_CHIP_STYLE,
              entry.display.kind === "none" ? "" : entry.display.status
            );
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
                <SimpleTableCell data-label="Parte referente">
                  <span className="flex flex-col items-end text-right md:items-start md:text-left">
                    <span data-testid={`referrer-due-${line.id}`}>{formatCop(entry.referrerDueCop)}</span>
                    {feeNote ? (
                      <span className="text-xs text-muted" data-testid={`referrer-fee-${line.id}`}>
                        {feeNote}
                      </span>
                    ) : null}
                  </span>
                </SimpleTableCell>
                <SimpleTableCell data-label="Parte prestador" data-testid={`provider-due-${line.id}`}>
                  {formatCop(entry.providerDueCop)}
                </SimpleTableCell>
                <SimpleTableCell data-label="Estado de comisión">
                  <Chip variant={chip.variant} color={chip.color} data-testid={`ledger-state-${line.id}`}>
                    {commissionLabel(entry.display)}
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
