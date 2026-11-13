import Link from "next/link";
import { formatCop } from "@hifago/domain";
import { KpiCard } from "@hifago/ui";
import { PayAllButton } from "./PayAllDialog";

export type PayableRow = {
  beneficiaryPartnerId: string;
  beneficiaryName: string;
  dueCount: number;
  dueCop: number;
  estimatedCop: number;
  /** Où virer (partner_payout_accounts) — null si le partenaire ne l'a pas encore enregistré. */
  mercadopagoAccount: string | null;
};

// « Por pagar » en tête de /admin/ledger (20261112190000) : à qui Hifago doit de l'argent
// maintenant, sommé en SQL sur tout le ledger (admin_ledger_payables), jamais sur la page
// affichée. Chaque carte mène à la liste filtrée sur ce bénéficiaire et le statut « A pagar », où
// chaque entrée se règle par « Marcar pagado » — ou se règle d'un coup par « Pagar todo »
// (20261112200000), après un seul virement.
export function PayablesPanel({ rows }: { rows: PayableRow[] }) {
  const totalDue = rows.reduce((sum, row) => sum + row.dueCop, 0);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="payables-heading" data-testid="ledger-payables">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="payables-heading" className="text-lg font-semibold">
          Por pagar
        </h2>
        <span className="text-sm text-muted" data-testid="ledger-payables-total">
          Total: {formatCop(totalDue)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted" data-testid="ledger-payables-empty">
          Nada por pagar por ahora.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <KpiCard
              key={row.beneficiaryPartnerId}
              testId={`ledger-payable-${row.beneficiaryPartnerId}`}
              label={row.beneficiaryName}
              value={formatCop(row.dueCop)}
              sublabel={
                <span className="flex flex-col gap-1">
                  <span>
                    {row.dueCount === 1 ? "1 entrada a pagar" : `${row.dueCount} entradas a pagar`}
                    {row.estimatedCop > 0 ? ` · ${formatCop(row.estimatedCop)} estimado por venir` : ""}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <PayAllButton
                      beneficiaryPartnerId={row.beneficiaryPartnerId}
                      beneficiaryName={row.beneficiaryName}
                      mercadopagoAccount={row.mercadopagoAccount}
                    />
                    <Link
                      href={`/admin/ledger?status=due&beneficiary_partner_id=${row.beneficiaryPartnerId}`}
                      className="font-medium text-foreground underline"
                      data-testid={`ledger-payable-link-${row.beneficiaryPartnerId}`}
                    >
                      Ver y pagar
                    </Link>
                  </span>
                </span>
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
