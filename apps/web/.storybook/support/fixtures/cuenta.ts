import { addDaysIso, todayInBogota } from "@hifago/domain";
import type { MyProfile } from "@/lib/account/getMyProfile";
import { depositRetainedOnCancel, type MyOrder, type MyOrderLine, type MyOrders } from "@/lib/orders/getMyOrders";

// Compte et réservations des stories d'écran (2026-10-01). Les commandes couvrent les HUIT états
// que `deriveOrderState` (lib/orders/orderState.ts) sait produire, et chaque variante de ligne
// (vivante, morte, avec ou sans lien d'établissement, date simple, plage, camp, créneau) : c'est
// l'inventaire du 2026-10-01, pas un échantillon choisi au hasard.

const hoy = todayInBogota();
const dia = (desplazamiento: number) => addDaysIso(hoy, desplazamiento);

export const PERFIL_COMPLETO: MyProfile = {
  email: "laura@ejemplo.co",
  fullName: "Laura Restrepo",
  phone: "+573001112233",
  hasProfessionalCapability: false,
};

export const PERFIL_VACIO: MyProfile = { ...PERFIL_COMPLETO, fullName: "", phone: "" };

export const PERFIL_PROFESIONAL: MyProfile = { ...PERFIL_COMPLETO, hasProfessionalCapability: true };

function linea(parcial: Partial<MyOrderLine> & Pick<MyOrderLine, "id" | "productName">): MyOrderLine {
  return {
    establishmentName: "Casa del Embalse",
    establishmentSlug: "casa-del-embalse",
    date: dia(12),
    endDate: null,
    durationDays: null,
    slotStartTime: null,
    qty: 2,
    acompteCop: 12000,
    totalCop: 40000,
    status: "reserved",
    ...parcial,
    // La règle de la base (`order_line_client_cancellable`) : seule une prestation `reserved`.
    cancellable: parcial.cancellable ?? (parcial.status ?? "reserved") === "reserved",
  };
}

function pedido(parcial: Partial<MyOrder> & Pick<MyOrder, "id" | "reference" | "lines">): MyOrder {
  return {
    accessToken: `token-${parcial.id}`,
    paymentStatus: "paid",
    acompteCop: parcial.lines.reduce((total, l) => total + l.acompteCop, 0),
    paymentReceivedNotHonored: false,
    refundStatus: null,
    ...parcial,
    depositRetainedOnCancel: depositRetainedOnCancel(parcial.paymentStatus ?? "paid"),
  };
}

export const PEDIDO_PAGADO = pedido({
  id: "o-42",
  reference: "HFG-000042",
  lines: [
    linea({ id: "l-421", productName: "Kayak en el embalse", slotStartTime: "10:00:00" }),
    linea({
      id: "l-422",
      productName: "Glamping con vista a la Piedra",
      establishmentName: "Kayam Glamping",
      establishmentSlug: "kayam-glamping",
      date: dia(12),
      endDate: dia(14),
      qty: 1,
      acompteCop: 108000,
      totalCop: 360000,
    }),
  ],
});

export const PEDIDO_SIN_PAGAR = pedido({
  id: "o-43",
  reference: "HFG-000043",
  paymentStatus: "unpaid",
  lines: [linea({ id: "l-431", productName: "Clase de guitarra", date: dia(5), slotStartTime: "17:00:00", qty: 1 })],
});

export const PEDIDO_CONFIRMANDO = pedido({
  id: "o-44",
  reference: "HFG-000044",
  paymentStatus: "pending",
  lines: [
    linea({
      id: "l-441",
      productName: "Camp de escalada — 5 días",
      establishmentSlug: null,
      establishmentName: "Guatapé Climbing",
      date: dia(20),
      durationDays: 5,
      acompteCop: 270000,
      totalCop: 900000,
    }),
  ],
});

export const PEDIDO_CONFIRMADO_GRATIS = pedido({
  id: "o-45",
  reference: "HFG-000045",
  paymentStatus: "unpaid",
  lines: [linea({ id: "l-451", productName: "Kayam's Jam — noche de música", date: dia(3), acompteCop: 0, totalCop: 0 })],
});

export const PEDIDO_PASADO_REALIZADO = pedido({
  id: "o-31",
  reference: "HFG-000031",
  lines: [
    linea({ id: "l-311", productName: "Yoga al amanecer", date: dia(-20), slotStartTime: "06:30:00", status: "fulfilled" }),
    linea({ id: "l-312", productName: "Paseo en jetski", date: dia(-20), slotStartTime: "15:00:00", status: "no_show" }),
  ],
});

export const PEDIDO_ANULADO = pedido({
  id: "o-30",
  reference: "HFG-000030",
  lines: [linea({ id: "l-301", productName: "Partyboat", date: dia(-12), status: "cancelled_by_client" })],
});

export const PEDIDO_EXPIRADO = pedido({
  id: "o-29",
  reference: "HFG-000029",
  paymentStatus: "unpaid",
  lines: [linea({ id: "l-291", productName: "Caminata a la cascada", date: dia(-30), status: "expired" })],
});

export const PEDIDO_REEMBOLSADO = pedido({
  id: "o-28",
  reference: "HFG-000028",
  paymentStatus: "refunded",
  refundStatus: "approved",
  lines: [linea({ id: "l-281", productName: "Clase de DJ", date: dia(-8), status: "cancelled_by_provider" })],
});

export const PEDIDO_PAGO_NO_HONRADO = pedido({
  id: "o-27",
  reference: "HFG-000027",
  paymentStatus: "pending",
  paymentReceivedNotHonored: true,
  lines: [linea({ id: "l-271", productName: "Habitación doble", date: dia(-2), endDate: dia(0), status: "superseded" })],
});

export const MIS_RESERVAS: MyOrders = {
  upcoming: [PEDIDO_PAGADO, PEDIDO_SIN_PAGAR, PEDIDO_CONFIRMANDO, PEDIDO_CONFIRMADO_GRATIS],
  past: [PEDIDO_PASADO_REALIZADO, PEDIDO_ANULADO, PEDIDO_EXPIRADO, PEDIDO_REEMBOLSADO, PEDIDO_PAGO_NO_HONRADO],
};
