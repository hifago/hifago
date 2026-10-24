import { parsePhoneNumber } from "react-phone-number-input";
import { asLocalizedField, OPERATION_TIME_ZONE, resolveLocalizedField } from "@hifago/domain";

// Spec 19 §0 Tranche 1 « contenu de la préférence » — ce que Hifago dit à Mercado Pago de l'acheteur
// et de ce qu'il achète. Module PUR (aucun SDK, aucun réseau, aucune base) : c'est ce qui permet de
// prouver, sans simuler quoi que ce soit, que le montant facturé ne bouge jamais.
//
// POURQUOI (bug du 2026-10-23, `cc_rejected_high_risk` en prod) : la préférence partait presque vide
// — un seul item identique pour toutes les commandes, l'e-mail pour tout `payer`. Mercado Pago
// recommande d'envoyer le maximum de données sur l'acheteur et le produit pour son contrôle de
// risque (doc « improve-payment-approval »). Tout ce qui suit existe déjà en base ; rien n'est
// inventé.
//
// ⚠️ CE QUI N'EST JAMAIS ENVOYÉ, et pourquoi :
//   - `payer.identification` (document d'identité) : Hifago ne le collecte pas — le fabriquer serait
//     pire qu'une absence (Mercado Pago le recoupe avec la carte). Le client le saisit sur la page
//     Mercado Pago.
//   - `payer.address`, `payer.date_created` : idem, aucune source en base.
//   - tout champ « historique d'achat » du payer : Hifago ne peut pas l'affirmer.
// Le Device ID est posé par la page Checkout Pro elle-même : rien à faire de notre côté.

/** Une ligne de commande, telle que `get_order_by_token` la rend — les noms restent bruts (jsonb). */
export interface PreferenceLine {
  id: string;
  /** `jsonb` multilingue (`products.name`) : résolu ici, en espagnol, avec repli. */
  productName: unknown;
  productType: string | null;
  /** `jsonb` multilingue (`establishments.name`), `null` quand la prestation n'a pas d'établissement. */
  establishmentName: unknown;
  /** yyyy-MM-dd — date civile de la prestation. */
  date: string;
  endDate: string | null;
  /** Non nul pour un camp seulement. */
  durationDays: number | null;
  /** `time` Postgres : HH:MM ou HH:MM:SS. */
  slotStartTime: string | null;
  qty: number;
  acompteCop: number;
  status: string;
}

/** Ce que l'API de préférences accepte pour un item (sous-ensemble du `Items` du SDK 3.4.0). */
export interface PreferenceItem {
  id: string;
  title: string;
  description?: string;
  category_id: string;
  quantity: number;
  currency_id: "COP";
  unit_price: number;
  category_descriptor?: { event_date: string };
}

export interface PreferencePayerIdentity {
  name?: string;
  surname?: string;
  phone?: { area_code: string; number: string };
}

/** Titre de l'item agrégé : celui de la préférence d'avant ce lot, conservé comme repli. */
const AGGREGATED_TITLE = "Anticipo de reserva Hifago";

// Bornes de longueur : la doc Mercado Pago n'en donne pas pour ces champs, un titre de plusieurs
// centaines de caractères n'aide personne. Coupées en points de code, jamais au milieu d'un
// caractère composé de deux unités UTF-16.
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 256;

function bounded(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * « Camila Andrea Gómez » → `{ name: "Camila", surname: "Andrea Gómez" }`. Le premier mot est le
 * prénom, le reste le nom : on ne devine pas où commence un nom composé. Un seul mot → `name`
 * seul, jamais un `surname` vide ni inventé.
 */
export function splitHolderName(holderName: string | null | undefined): { name?: string; surname?: string } {
  const [first, ...rest] = clean(holderName).split(" ").filter(Boolean);
  if (!first) return {};
  return rest.length === 0 ? { name: first } : { name: first, surname: rest.join(" ") };
}

/**
 * `+573001234567` → `{ area_code: "57", number: "3001234567" }` : l'indicatif pays et le numéro
 * national, sans « + ». `null` quand le numéro n'est pas analysable ou invalide (donnée ancienne,
 * saisie libre) : le champ est alors omis plutôt que de transmettre une valeur que Mercado Pago
 * recouperait mal. `parsePhoneNumber` est déjà celui de `CheckoutForm` (`isValidPhoneNumber`).
 */
export function toMercadoPagoPhone(
  holderPhone: string | null | undefined
): { area_code: string; number: string } | null {
  const raw = clean(holderPhone);
  if (!raw) return null;
  try {
    const parsed = parsePhoneNumber(raw);
    if (!parsed?.isValid()) return null;
    return { area_code: parsed.countryCallingCode, number: parsed.nationalNumber };
  } catch {
    return null;
  }
}

/** Ce qu'on sait de l'acheteur, hors e-mail (porté à part par `payments.payer_email`). */
export function buildPayerIdentity(
  holderName: string | null | undefined,
  holderPhone: string | null | undefined
): PreferencePayerIdentity {
  const phone = toMercadoPagoPhone(holderPhone);
  return { ...splitHolderName(holderName), ...(phone ? { phone } : {}) };
}

/**
 * Catégories Mercado Pago (`/item_categories`) : `travels` = hôtels et voyages, `tickets` =
 * excursions et événements, `services` pour le reste. Les types de `products.type` : `lodging`,
 * `hotel`, `camp`, `transport` hébergent ou déplacent ; `activity`, `tour`, `evento` se vivent sur place.
 */
export function categoryForProductType(productType: string | null | undefined): string {
  switch (productType) {
    case "lodging":
    case "hotel":
    case "camp":
    case "transport":
      return "travels";
    case "activity":
    case "tour":
    case "evento":
      return "tickets";
    default:
      return "services";
  }
}

// Le décalage de Guatapé À CETTE DATE, lu dans la base de fuseaux du runtime — jamais « −05:00 »
// codé en dur (cf. `packages/domain/src/time/bogotaDates.ts`, la Colombie a connu l'heure d'été).
// Midi UTC tombe le même jour civil à Guatapé : la date ne peut pas basculer pendant la lecture.
const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: OPERATION_TIME_ZONE,
  timeZoneName: "longOffset",
});

function bogotaOffset(dateIso: string): string | null {
  const noon = new Date(`${dateIso}T12:00:00Z`);
  if (Number.isNaN(noon.getTime())) return null;
  const name = offsetFormatter.formatToParts(noon).find((part) => part.type === "timeZoneName")?.value;
  const match = name ? /^GMT([+-]\d{2}:\d{2})$/.exec(name) : null;
  return match ? match[1] : null;
}

/** `time` Postgres → HH:MM:SS, ou `null` si la valeur n'a pas cette forme. */
function normalizedTime(time: string | null): string | null {
  const match = time ? /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(time) : null;
  return match ? `${match[1]}:${match[2]}:${match[3] ?? "00"}` : null;
}

/** La prestation, à l'heure de Guatapé, en ISO 8601 avec décalage explicite ; `null` si la date est illisible. */
function eventDate(line: PreferenceLine): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(line.date)) return null;
  const offset = bogotaOffset(line.date);
  if (!offset) return null;
  return `${line.date}T${normalizedTime(line.slotStartTime) ?? "00:00:00"}.000${offset}`;
}

function describeLine(line: PreferenceLine): string {
  const parts = [line.endDate ? `${line.date} al ${line.endDate}` : line.date];
  if (line.durationDays) parts.push(`${line.durationDays} días`);
  const time = normalizedTime(line.slotStartTime);
  if (time) parts.push(`a las ${time.slice(0, 5)}`);
  parts.push(`cantidad ${line.qty}`);
  return bounded(parts.join(" · "), DESCRIPTION_MAX);
}

function lineTitle(line: PreferenceLine): string {
  const product = clean(resolveLocalizedField(asLocalizedField(line.productName), "es")) || "reserva";
  const establishment = clean(resolveLocalizedField(asLocalizedField(line.establishmentName), "es"));
  return bounded(establishment ? `Anticipo – ${product} · ${establishment}` : `Anticipo – ${product}`, TITLE_MAX);
}

/** Un item par ligne `reserved` dont l'acompte est un entier COP strictement positif. */
function itemOfLine(line: PreferenceLine): PreferenceItem | null {
  if (line.status !== "reserved") return null;
  // Un acompte nul (evento gratuit, payable sur place) ne coûte rien : le porter en `unit_price: 0`
  // ferait refuser la préférence, et l'omettre ne change pas la somme.
  if (!Number.isInteger(line.acompteCop) || line.acompteCop <= 0) return null;
  const category = categoryForProductType(line.productType);
  // `category_descriptor` est le bloc « industrie » de Mercado Pago (voyage, billetterie) : hors de
  // `travels` et `tickets`, il n'a pas de sens, donc on ne l'envoie pas.
  const date = category === "services" ? null : eventDate(line);
  return {
    id: line.id,
    title: lineTitle(line),
    description: describeLine(line),
    category_id: category,
    quantity: 1,
    currency_id: "COP",
    unit_price: line.acompteCop,
    ...(date ? { category_descriptor: { event_date: date } } : {}),
  };
}

export function sumOfItems(items: readonly PreferenceItem[]): number {
  return items.reduce((total, item) => total + item.unit_price * item.quantity, 0);
}

/**
 * L'item unique qui porte tout l'acompte — le repli quand le détail des lignes manque ou ne tombe
 * pas juste. Son `id` est `payments.id` (comme avant ce lot) ; la référence `HFG-…`, quand on la
 * connaît, le distingue d'une commande à l'autre.
 */
export function aggregatedItem(args: {
  paymentId: string;
  amountCop: number;
  reference?: string | null;
}): PreferenceItem {
  const reference = clean(args.reference);
  return {
    id: args.paymentId,
    title: AGGREGATED_TITLE,
    ...(reference ? { description: bounded(`Reserva ${reference}`, DESCRIPTION_MAX) } : {}),
    // Une commande dont on ne sait plus le détail reste une réservation de séjour/expérience.
    category_id: "travels",
    quantity: 1,
    currency_id: "COP",
    unit_price: args.amountCop,
  };
}

/**
 * Les items de la préférence : le détail des lignes `reserved`, ou l'item agrégé.
 *
 * ⚠️ INVARIANT — la somme des items égale `payments.amount_cop` EXACTEMENT. Le montant facturé est
 * celui de la base (`create_payment_intent` : somme des acomptes des lignes `reserved`), jamais
 * celui que ce détail reconstitue. Dès que les deux divergent — ligne annulée entre-temps,
 * acompte non entier, lecture partielle —, on repart sur l'item agrégé : mieux vaut une préférence
 * moins riche qu'un client qui paie un autre montant que celui promis (et que le webhook refuserait,
 * `amount_mismatch`).
 */
export function buildPreferenceItems(args: {
  paymentId: string;
  amountCop: number;
  reference?: string | null;
  lines: readonly PreferenceLine[] | null | undefined;
}): PreferenceItem[] {
  const items = (args.lines ?? []).flatMap((line) => {
    const item = itemOfLine(line);
    return item ? [item] : [];
  });
  if (items.length > 0 && sumOfItems(items) === args.amountCop) return items;
  return [aggregatedItem(args)];
}
