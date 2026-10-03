import { addDaysIso, todayInBogota } from "@hifago/domain";
import type { OrderForDisplay, OrderLineForDisplay } from "@/lib/orders/getOrderByToken";
import type { PendingOrderForViewer } from "@/lib/orders/getPendingOrdersForViewer";

// Commandes de l'écran de résultat `/reserva/[token]` (2026-10-01). Une commande par état que
// `deriveOrderState` (lib/orders/orderState.ts) sait produire, retrouvée par son JETON : une story
// n'a qu'à passer `token` en params. Les montants sont cohérents (acompte = 30 % du total).

const hoy = todayInBogota();
const dia = (desplazamiento: number) => addDaysIso(hoy, desplazamiento);

function linea(parcial: Partial<OrderLineForDisplay> & Pick<OrderLineForDisplay, "id" | "productName">): OrderLineForDisplay {
  return {
    establishmentName: "Casa Kayam",
    establishmentSlug: "casa-kayam",
    establishmentContactUrl: "https://wa.me/573001112244",
    date: dia(12),
    endDate: null,
    durationDays: null,
    slotStartTime: null,
    qty: 2,
    totalCop: 90000,
    acompteCop: 27000,
    status: "reserved",
    ...parcial,
  };
}

function pedido(parcial: Partial<OrderForDisplay> & Pick<OrderForDisplay, "id" | "reference" | "lines">): OrderForDisplay {
  return {
    paymentStatus: "unpaid",
    holderName: "Laura Restrepo",
    holderPhone: "+573001112233",
    holderEmail: "laura@ejemplo.co",
    totalCop: parcial.lines.reduce((total, l) => total + l.totalCop, 0),
    acompteCop: parcial.lines.reduce((total, l) => total + l.acompteCop, 0),
    paymentReceivedNotHonored: false,
    refundStatus: null,
    ...parcial,
  };
}

const LINEAS_VIAJE: OrderLineForDisplay[] = [
  linea({ id: "r-1", productName: "Caminata a la cascada", date: dia(12) }),
  linea({
    id: "r-2",
    productName: "Glamping con vista a la Piedra",
    date: dia(12),
    endDate: dia(14),
    qty: 1,
    totalCop: 400000,
    acompteCop: 120000,
  }),
  linea({
    id: "r-3",
    productName: "Kayak en el embalse",
    establishmentName: "Casa del Embalse",
    establishmentSlug: "casa-del-embalse",
    establishmentContactUrl: null,
    date: dia(13),
    slotStartTime: "10:00:00",
    totalCop: 40000,
    acompteCop: 12000,
  }),
];

/** Le jeton est la clé de lecture : `/reserva/<token>`. */
export const PEDIDOS_POR_TOKEN: Record<string, OrderForDisplay> = {
  "token-por-pagar": pedido({ id: "o-50", reference: "HFG-000050", lines: LINEAS_VIAJE }),
  "token-o-nueva": pedido({ id: "o-nueva", reference: "HFG-000051", lines: LINEAS_VIAJE }),
  "token-pagado": pedido({ id: "o-52", reference: "HFG-000052", paymentStatus: "paid", lines: LINEAS_VIAJE }),
  "token-confirmando": pedido({ id: "o-53", reference: "HFG-000053", paymentStatus: "pending", lines: LINEAS_VIAJE }),
  "token-gratis": pedido({
    id: "o-54",
    reference: "HFG-000054",
    lines: [linea({ id: "r-41", productName: "Media maratón entre zócalos y colores", date: dia(26), qty: 1, totalCop: 0, acompteCop: 0 })],
  }),
  "token-no-honrado": pedido({
    id: "o-55",
    reference: "HFG-000055",
    paymentStatus: "pending",
    paymentReceivedNotHonored: true,
    lines: LINEAS_VIAJE.map((l) => ({ ...l, status: "superseded" })),
  }),
  "token-reembolsado": pedido({
    id: "o-56",
    reference: "HFG-000056",
    paymentStatus: "refunded",
    refundStatus: "approved",
    lines: LINEAS_VIAJE.map((l) => ({ ...l, status: "cancelled_by_provider" })),
  }),
  "token-expirado": pedido({
    id: "o-57",
    reference: "HFG-000057",
    lines: LINEAS_VIAJE.map((l) => ({ ...l, status: "expired" })),
  }),
  "token-anulado": pedido({
    id: "o-58",
    reference: "HFG-000058",
    lines: LINEAS_VIAJE.map((l) => ({ ...l, status: "cancelled_by_client" })),
  }),
  "token-mixto": pedido({
    id: "o-59",
    reference: "HFG-000059",
    paymentStatus: "paid",
    holderPhone: null,
    lines: [LINEAS_VIAJE[0], { ...LINEAS_VIAJE[1], status: "cancelled_by_client" }, LINEAS_VIAJE[2]],
  }),
};

export const PEDIDOS_PENDIENTES: PendingOrderForViewer[] = [
  { id: "o-50", reference: "HFG-000050", accessToken: "token-por-pagar" },
];
