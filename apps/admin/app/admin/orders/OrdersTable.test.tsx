import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OrderLineRow } from "./OrdersTable";

// Le statut `reserved` d'une LIGNE tient la place pendant le paiement ; il ne dit pas que la commande est
// payée. Une commande dont le paiement a été refusé s'affichait « Reservada » (constaté en prod, le
// 2026-10-24). Ce fichier prouve ce que la liste dit, ligne par ligne, selon le paiement de sa commande.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/orders",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./ChangeStatusDialog", () => ({ ChangeStatusDialog: () => null }));
vi.mock("@/components/ModifyOrderLineDialog", () => ({ ModifyOrderLineDialog: () => null }));

// jsdom n'a pas matchMedia (DataList s'en sert pour replier ses filtres sous md).
window.matchMedia ??= ((query: string) => ({
  matches: true,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  onchange: null,
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const { OrdersTable } = await import("./OrdersTable");

function row(overrides: Partial<OrderLineRow>): OrderLineRow {
  return {
    id: "l1",
    orderId: "o1",
    date: "2026-11-20",
    endDate: null,
    qty: 1,
    status: "reserved",
    paymentState: "paid",
    productName: "Clase de guitarra",
    establishmentName: "Casa Kayam",
    holderName: "gab",
    holderPhone: "+573001112233",
    referrerName: "Directo",
    amount: 55000,
    ...overrides,
  };
}

function afficher(rows: OrderLineRow[]) {
  return render(
    <OrdersTable
      rows={rows}
      page={1}
      pageSize={25}
      totalCount={rows.length}
      sort={{ key: "date", direction: "desc" }}
      filterValues={{}}
      extraParams={{}}
    />
  );
}

// DataList rend une table ET (sous md) des cartes : on lit le premier exemplaire de chaque pastille.
const texte = (testId: string) => screen.getAllByTestId(testId)[0].textContent;

describe("OrdersTable — le statut de la ligne ne se lit plus comme un paiement", () => {
  it("une ligne `reserved` d'une commande SANS PAGO (refusé / jamais fait) n'est plus « Reservada »", () => {
    afficher([row({ paymentState: "unpaid" })]);
    expect(texte("status-badge-l1")).toBe("Pendiente de pago");
    expect(texte("payment-badge-l1")).toBe("Sin pagar");
  });

  it("un paiement en cours chez Mercado Pago : « Pendiente de pago » et « Pago en curso »", () => {
    afficher([row({ paymentState: "in_progress" })]);
    expect(texte("status-badge-l1")).toBe("Pendiente de pago");
    expect(texte("payment-badge-l1")).toBe("Pago en curso");
  });

  it("une commande payée garde « Reservada » et dit « Pagado »", () => {
    afficher([row({ paymentState: "paid" })]);
    expect(texte("status-badge-l1")).toBe("Reservada");
    expect(texte("payment-badge-l1")).toBe("Pagado");
  });

  it("une commande sans acompte dû (evento gratuit / sur place) reste « Reservada », jamais « pendiente »", () => {
    afficher([row({ paymentState: "not_due", amount: 0 })]);
    expect(texte("status-badge-l1")).toBe("Reservada");
    expect(texte("payment-badge-l1")).toBe("Sin anticipo");
  });

  it("une commande remboursée : le paiement le dit, le statut de ligne n'est pas réécrit", () => {
    afficher([row({ paymentState: "refunded", status: "cancelled_by_provider" })]);
    expect(texte("status-badge-l1")).toBe("Anulada (prestador)");
    expect(texte("payment-badge-l1")).toBe("Reembolsado");
  });

  it("une ligne annulée ou expirée d'une commande impayée garde son statut (jamais « pendiente de pago »)", () => {
    afficher([row({ id: "l2", status: "expired", paymentState: "unpaid" })]);
    expect(texte("status-badge-l2")).toBe("Expirada");
  });

  it("état de paiement illisible : la ligne garde son statut brut et le paiement affiche « — »", () => {
    afficher([row({ paymentState: null })]);
    expect(texte("status-badge-l1")).toBe("Reservada");
    expect(screen.queryAllByTestId("payment-badge-l1")).toHaveLength(0);
  });
});
