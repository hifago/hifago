// Lecture À CHAUD de LobbyPMS pour les nuits d'une commande, avant qu'on tienne la place
// (hold_pms_nights) — le cœur de /api/pms/check-nights. LECTURE SEULE : depuis le 2026-10-23, aucune
// écriture n'atteint Lobby avant le paiement (spec 21 §8.1).
//
// Pas de cache : une disponibilité lue il y a dix minutes ne dit rien de la dernière unité. C'est
// `getNightAvailabilityRange` appelée directement, jamais la couche TTL de la route
// night-availability. Un appel par fenêtre de 31 nuits et par établissement (la page de Lobby fait
// 100 enregistrements).
//
// Le résultat est un INSTANTANÉ au format de hold_pms_nights :
//   { "<établissement>": { "<catégorie Lobby>": { "YYYY-MM-DD": unités libres } } }
// Les unités Lobby sont converties par `pmsUnitsToCupos` (1 unité = 1 cupo, lot 1 du 2026-10-23), la
// même conversion que night-availability : le hold compare des quantités de même nature que
// `order_lines.qty`. Une nuit que Lobby ne cote pas est ABSENTE de l'instantané : la base la refuse (`not_quoted`),
// jamais lue comme « complet » ni comme « libre ».
//
// `readAt` est pris AVANT l'envoi de la première requête de lecture : un booking enregistré après cet
// instant a pu ne pas être vu par la lecture, et la base le compte alors « en vol » (marge
// d'horloge comprise).
import { addDaysIso } from "../time/bogotaDates.ts";
import { pmsUnitsToCupos } from "../products/lodgingCupos.ts";
import { getNightAvailabilityRange, pickCategoryNights, type PmsFailure } from "./getNightAvailabilityWindow.ts";

export interface CheckLine {
  id: string;
  lobby_category_id: number;
  date: string;
  end_date: string;
  qty: number;
}

export interface CheckGroup {
  establishment_id: string;
  api_token: string;
  lines: CheckLine[];
}

export type NightsSnapshot = Record<string, Record<string, Record<string, number>>>;

export type CheckResult =
  | { ok: true; snapshot: NightsSnapshot; readAt: string }
  | { ok: false; failure: PmsFailure; establishmentId: string };

// Fenêtre maximale d'un appel : 31 nuits tiennent dans la page de 100 enregistrements de Lobby avec
// la marge de la nuit « dernière + 1 » (end_date inclusif).
const WINDOW_NIGHTS = 31;

/** Les nuits [date, end_date) d'une ligne : la dernière nuit est celle qui précède le départ. */
export function nightsOfLine(date: string, endDate: string): string[] {
  const nights: string[] = [];
  for (let night = date; night < endDate; night = addDaysIso(night, 1)) nights.push(night);
  return nights;
}

export async function checkOrderNights(
  groups: CheckGroup[],
  options: { baseUrl: string; relaySecret?: string; timeoutMs?: number; now?: () => Date }
): Promise<CheckResult> {
  const readAt = (options.now ?? (() => new Date()))().toISOString();
  const snapshot: NightsSnapshot = {};

  for (const group of groups) {
    const wanted = new Set<string>();
    for (const line of group.lines) for (const night of nightsOfLine(line.date, line.end_date)) wanted.add(night);
    if (wanted.size === 0) continue;

    // Nuits contiguës de la première à la dernière : alignLobbyCatalogEntries exige que ce qu'on
    // demande soit une plage continue. Les nuits non voulues au milieu coûtent un enregistrement.
    const sorted = [...wanted].sort();
    const span: string[] = [];
    for (let night = sorted[0]; night <= sorted[sorted.length - 1]; night = addDaysIso(night, 1)) span.push(night);

    const categories = new Set(group.lines.map((line) => line.lobby_category_id));
    const forEstablishment: Record<string, Record<string, number>> = {};
    for (const category of categories) forEstablishment[String(category)] = {};

    for (let i = 0; i < span.length; i += WINDOW_NIGHTS) {
      const window = span.slice(i, i + WINDOW_NIGHTS);
      const result = await getNightAvailabilityRange(
        options.baseUrl,
        group.api_token,
        window,
        options.relaySecret,
        options.timeoutMs
      );
      if (!result.ok) return { ok: false, failure: result.failure, establishmentId: group.establishment_id };

      for (const category of categories) {
        const { nights } = pickCategoryNights(result.nights, category);
        for (const night of nights) {
          if (wanted.has(night.date)) forEstablishment[String(category)][night.date] = pmsUnitsToCupos(night.capacity);
        }
      }
    }
    snapshot[group.establishment_id] = forEstablishment;
  }

  return { ok: true, snapshot, readAt };
}
