import { loadReconciliationPage } from "@/lib/reconciliation/loadReconciliationPage";
import { ReconciliationList } from "./ReconciliationList";
import { PaymentReconciliationList } from "./PaymentReconciliationList";

// Lecture et mise en forme dans lib/reconciliation/loadReconciliationPage.ts : une panne y lève
// (écran d'erreur), jamais deux listes vides qui diraient « rien à réconcilier ».
export default async function AdminReconciliationPage() {
  const { paymentRows, rows } = await loadReconciliationPage();

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Reconciliación</h1>
      <section className="flex flex-col gap-4" aria-labelledby="reconciliation-pagos">
        <h2 id="reconciliation-pagos" className="text-xl font-semibold">
          Pagos
        </h2>
        <PaymentReconciliationList rows={paymentRows} />
      </section>
      <section className="flex flex-col gap-4" aria-labelledby="reconciliation-pms">
        <h2 id="reconciliation-pms" className="text-xl font-semibold">
          PMS
        </h2>
        <ReconciliationList rows={rows} />
      </section>
    </div>
  );
}
