import { formatCop } from "@hifago/domain";

// Option 17 % (migration 20261112200000, décision Jérôme du 2026-11-12) : la part des frais Mercado
// Pago de la ligne (order_lines.mp_fee_cop) est retenue sur ce que Hifago reverse. Dite à côté du
// montant — ledger admin, « Mis comisiones », fiche commande — pour que « 17 % » qui ne font pas
// 17 % de la ligne ne ressemble jamais à une erreur. Null : rien de retenu.
export function mercadoPagoFeeNote(mpFeeCop: number | null | undefined): string | null {
  return mpFeeCop != null && mpFeeCop > 0 ? `− ${formatCop(mpFeeCop)} comisión Mercado Pago` : null;
}
