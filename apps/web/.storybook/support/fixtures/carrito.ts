import { addDaysIso, todayInBogota } from "@hifago/domain";
import type { LineaCarritoFalsa } from "../supabaseFalso";
import { ACTIVIDAD_CAMINATA, ACTIVIDAD_KAYAK, ALOJAMIENTO_GLAMPING, CAMP_ESCALADA } from "./productos";

// Paniers des stories du tunnel (2026-10-01), posés par `simularCarrito` : ce sont des lignes de
// `cart_items`, que `/mi-viaje` et `/pago` relisent jointes aux fiches (support/datos.ts).

const hoy = todayInBogota();
const dia = (desplazamiento: number) => addDaysIso(hoy, desplazamiento);

/** Trois offres, deux établissements : une date, une plage de nuits, un créneau. */
export const CARRITO_VIAJE: LineaCarritoFalsa[] = [
  { productId: ACTIVIDAD_CAMINATA.id, date: dia(12), qty: 2 },
  { productId: ALOJAMIENTO_GLAMPING.id, date: dia(12), endDate: dia(14), qty: 1 },
  { productId: ACTIVIDAD_KAYAK.id, date: dia(13), slotStartTime: "10:00:00", qty: 2 },
];

export const CARRITO_UN_DIA: LineaCarritoFalsa[] = [{ productId: ACTIVIDAD_CAMINATA.id, date: dia(12), qty: 2 }];

/** Un camp de 5 jours SANS hébergement : `/mi-viaje` bloque le paiement. */
export const CARRITO_CAMP_SOLO: LineaCarritoFalsa[] = [{ productId: CAMP_ESCALADA.id, date: dia(7), qty: 2 }];

/** Le même camp, couvert par 4 nuits de glamping (du jour du départ au dernier jour). */
export const CARRITO_CAMP_CON_ALOJAMIENTO: LineaCarritoFalsa[] = [
  ...CARRITO_CAMP_SOLO,
  { productId: ALOJAMIENTO_GLAMPING.id, date: dia(7), endDate: dia(11), qty: 1 },
];
