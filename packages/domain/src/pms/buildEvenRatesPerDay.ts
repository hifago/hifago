export interface RatePerDay {
  date: string;
  price: number;
}

// Répartit totalCop également sur chaque nuit entre startDate (inclus) et endDate (exclu),
// dernière nuit ajustée pour que la somme corresponde EXACTEMENT à totalCop — l'arrondi ne doit
// jamais faire dériver le total envoyé à Lobby du total déjà facturé côté hifago.
//
// Le REPLI depuis le 2026-10-23 : une ligne qui porte sa ventilation par nuit
// (`order_lines.pms_nightly_unit_prices`, figée par create_order depuis le devis Lobby) passe par
// `buildNightlyRatesPerDay` ci-dessous. Une ligne ancienne, ou au prix fixe hifago (interrupteur
// `lobby_dynamic_pricing` éteint), n'a que l'agrégat du séjour : le partage égal reste alors la
// meilleure approximation, sans conséquence sur le prix facturé ni sur la commission.
export function buildEvenRatesPerDay(startDate: string, endDate: string, totalCop: number): RatePerDay[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const nights = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (nights <= 0) return [];

  const base = Math.floor(totalCop / nights);
  const remainder = totalCop - base * nights;
  const rates: RatePerDay[] = [];
  for (let i = 0; i < nights; i++) {
    const day = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    rates.push({
      date: day.toISOString().slice(0, 10),
      price: i === nights - 1 ? base + remainder : base,
    });
  }
  return rates;
}

/** Une nuit de `order_lines.pms_nightly_unit_prices` : le prix d'UNE unité, figé par create_order. */
export interface StoredNightlyUnitPrice {
  date: string;
  unit_price_cop: number;
}

/**
 * Les tarifs envoyés à Lobby nuit par nuit : prix d'une unité × qty, depuis la ventilation figée au
 * moment de la commande — pour qu'un week-end plus cher le reste aussi dans le booking.
 *
 * ⚠️ REPLI sur `buildEvenRatesPerDay` dès que la ventilation ne correspond plus EXACTEMENT à la ligne :
 * absente (ligne ancienne), une nuit manquante ou en trop, une date décalée, un prix non entier, ou
 * une somme ≠ `totalCop` (ligne modifiée après coup par l'admin, au prix fixe). La règle du module
 * tient toujours : jamais un total envoyé à Lobby qui diffère de celui déjà facturé.
 */
export function buildNightlyRatesPerDay(
  startDate: string,
  endDate: string,
  qty: number,
  totalCop: number,
  nightly: readonly StoredNightlyUnitPrice[] | null | undefined
): RatePerDay[] {
  const even = buildEvenRatesPerDay(startDate, endDate, totalCop);
  if (!Array.isArray(nightly) || nightly.length !== even.length || even.length === 0) return even;

  const rates: RatePerDay[] = [];
  for (let i = 0; i < even.length; i++) {
    const night = nightly[i];
    if (
      !night ||
      night.date !== even[i].date ||
      !Number.isInteger(night.unit_price_cop) ||
      night.unit_price_cop <= 0
    ) {
      return even;
    }
    rates.push({ date: even[i].date, price: night.unit_price_cop * qty });
  }
  return rates.reduce((sum, rate) => sum + rate.price, 0) === totalCop ? rates : even;
}
