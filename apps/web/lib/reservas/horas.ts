import { PER_HOUR_SLOT_MINUTES } from "@hifago/domain";
import type { CartLine } from "@/lib/cart/CartContext";

// Spec 43 — une activité À L'HEURE, côté fiche. Le miroir de `public.order_line_slot_units` :
// une ligne de N heures à partir de S prend 1 place sur chacun des créneaux S, S+1h, …, S+(N-1)h,
// tous d'une heure, jamais au-delà de minuit. create_order reste seul juge (CLAUDE.md §4.5) : ces
// calculs ne servent qu'à ne proposer que ce qui a une chance de passer.

/** "HH:MM" ou "HH:MM:SS" → minutes depuis minuit. */
function enMinutes(heure: string): number {
  const [h, m] = heure.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

/** Minutes depuis minuit → "HH:MM". */
export function enHHMM(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** L'heure de fin d'une plage de `heures` heures à partir de `debut` ("HH:MM"). */
export function finDePlage(debut: string, heures: number): string {
  return enHHMM(enMinutes(debut) + heures * 60);
}

/** Les heures ("HH:MM") couvertes par une plage — vide au-delà de minuit, comme en base. */
export function heuresCouvertes(debut: string, heures: number): string[] {
  const depart = enMinutes(debut);
  const out: string[] = [];
  for (let i = 0; i < heures; i += 1) {
    const fin = depart + (i + 1) * 60;
    if (fin > 24 * 60) break;
    out.push(enHHMM(depart + i * 60));
  }
  return out;
}

/**
 * Places déjà prises dans le PANIER, heure par heure, pour ce produit : clé `date|HH:MM`. Une ligne à
 * l'heure de 3 h compte 1 sur chacune de ses 3 heures — jamais 3 sur la première.
 */
export function ocupacionCarritoPorHora(lineas: CartLine[], productId: string): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const linea of lineas) {
    if (linea.productId !== productId || !linea.slotStartTime) continue;
    for (const heure of heuresCouvertes(linea.slotStartTime, linea.qty)) {
      const clave = `${linea.date}|${heure}`;
      mapa.set(clave, (mapa.get(clave) ?? 0) + 1);
    }
  }
  return mapa;
}

export type CreneauHoraire = {
  /** "HH:MM" ou "HH:MM:SS" */
  debut: string;
  dureeMinutes: number;
  /** Places restantes, panier compris. */
  restantes: number;
};

/**
 * Pour chaque heure de début : combien d'heures consécutives libres à partir d'elle (0 si elle-même
 * est pleine ou ne dure pas une heure). Une heure manquante ou pleine arrête la plage.
 */
export function heuresLibresDepuis(creneaux: CreneauHoraire[]): Map<string, number> {
  const parDebut = new Map<number, CreneauHoraire>();
  for (const creneau of creneaux) parDebut.set(enMinutes(creneau.debut), creneau);
  const libre = (minutes: number) => {
    const creneau = parDebut.get(minutes);
    return Boolean(creneau && creneau.dureeMinutes === PER_HOUR_SLOT_MINUTES && creneau.restantes >= 1);
  };
  const out = new Map<string, number>();
  for (const creneau of creneaux) {
    const depart = enMinutes(creneau.debut);
    let n = 0;
    while (depart + (n + 1) * 60 <= 24 * 60 && libre(depart + n * 60)) n += 1;
    out.set(enHHMM(depart), n);
  }
  return out;
}
