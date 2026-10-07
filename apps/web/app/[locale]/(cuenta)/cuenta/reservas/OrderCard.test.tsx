// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import { loadMessages } from "@/messages";
import type { CancelLineButtonProps } from "./CancelLineButton";
import type { MyOrder, MyOrderLine } from "@/lib/orders/getMyOrders";

// La carte rend `CancelLineButton` pour CHAQUE ligne, annulable ou non : c'est ce qui garde le
// message « Anulaste… » après le rafraîchissement, où la ligne n'est plus annulable. Et elle lui
// passe ce que la base a décidé (`cancellable`), jamais une déduction du statut.

const boutons: CancelLineButtonProps[] = [];

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "es", messages: loadMessages("es"), namespace: namespace as never }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("./CancelLineButton", () => ({
  CancelLineButton: (props: CancelLineButtonProps) => {
    boutons.push(props);
    return null;
  },
}));

const { OrderCard } = await import("./OrderCard");
const { renderToStaticMarkup } = await import("react-dom/server");

function ligne(id: string, status: string, cancellable: boolean): MyOrderLine {
  return {
    id,
    productName: `Producto ${id}`,
    establishmentName: "Casa",
    establishmentSlug: null,
    date: "2026-11-01",
    endDate: null,
    durationDays: null,
    slotStartTime: null,
    qty: 1,
    acompteCop: 10000,
    totalCop: 40000,
    status,
    cancellable,
  };
}

function commande(lines: MyOrderLine[], depositRetainedOnCancel: boolean): MyOrder {
  return {
    id: "o-1",
    reference: "HFG-000001",
    accessToken: "jeton",
    paymentStatus: depositRetainedOnCancel ? "paid" : "unpaid",
    acompteCop: 10000,
    lines,
    paymentReceivedNotHonored: false,
    refundStatus: null,
    depositRetainedOnCancel,
  };
}

async function rendre(order: MyOrder) {
  boutons.length = 0;
  renderToStaticMarkup(await OrderCard({ order, locale: "es" }));
  return boutons.map((b) => ({ id: b.lineId, cancellable: b.cancellable, depositRetained: b.depositRetained }));
}

describe("OrderCard — annulation", () => {
  it("rend le bouton pour chaque ligne, avec la décision de la base", async () => {
    const lignes = [
      ligne("l-1", "reserved", true),
      // `reserved` mais déclarée non annulable par la base : la carte ne la redécide pas.
      ligne("l-2", "reserved", false),
      ligne("l-3", "cancelled_by_client", false),
    ];
    expect(await rendre(commande(lignes, true))).toEqual([
      { id: "l-1", cancellable: true, depositRetained: true },
      { id: "l-2", cancellable: false, depositRetained: true },
      { id: "l-3", cancellable: false, depositRetained: true },
    ]);
  });

  it("commande impayée : aucun acompte retenu n'est annoncé", async () => {
    const resultat = await rendre(commande([ligne("l-1", "reserved", true)], false));
    expect(resultat).toEqual([{ id: "l-1", cancellable: true, depositRetained: false }]);
  });
});
