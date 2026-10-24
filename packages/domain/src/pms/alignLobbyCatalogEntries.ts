import type { LobbyCatalogEntry, LobbyNightPrices, LobbyNightRestrictions } from "./parseLobbyNightCatalog.ts";

export interface NightCatalogRow {
  date: string;
  /** categoryId → unités libres. Absente = catégorie non cotée par Lobby cette nuit-là. */
  availableByCategory: Map<number, number>;
  /** categoryId → `restrictions` relevées (jamais appliquées). Absente = Lobby n'en pose aucune. */
  restrictionsByCategory: Map<number, LobbyNightRestrictions>;
  /** categoryId → prix Lobby par occupation (2026-10-23). Absente = aucun prix lisible cette nuit-là. */
  pricesByCategory: Map<number, LobbyNightPrices>;
}

export type CatalogAlignment =
  | { ok: true; nights: NightCatalogRow[] }
  | { ok: false; reason: CatalogAlignmentFailure; detail: string };

export type CatalogAlignmentFailure = "missing_date" | "duplicate_date" | "incomplete_coverage";

/**
 * Rapproche ce que Lobby a RENDU de ce qu'on lui a DEMANDÉ, et refuse de deviner quand ça ne tombe
 * pas juste.
 *
 * C'EST ICI QUE SE JOUE LE PIÈGE de l'élargissement de `end_date`. Une réponse qui couvre plusieurs
 * nuits ne peut être étiquetée que par les dates qu'elle porte : recopier la liste demandée sur les
 * enregistrements reçus, dans l'ordre, produirait un calendrier d'apparence normale et faux. Cette
 * fonction n'a donc qu'une seule façon d'associer une ligne à un jour — le champ `date` de la
 * ligne — et une seule façon d'échouer : bruyamment.
 *
 * ⚠️ ON ÉCARTE AVANT DE VALIDER, ET CET ORDRE EST LE CORRECTIF DU 2026-08-28 (revue adversariale).
 * `end_date` étant INCLUSIF (mesuré) et la production envoyant « dernière nuit + 1 », il arrive
 * SYSTÉMATIQUEMENT un enregistrement qu'on n'a pas demandé : le 1er du mois suivant. La première
 * version validait `missing_date`/`duplicate_date` sur TOUS les enregistrements reçus, puis
 * filtrait — donc cette nuit surnuméraire avait un DROIT DE VETO sur le mois entier. Trente et une
 * nuits parfaites plus une anomalie sur une nuit dont on n'a que faire, et l'écran affichait
 * « indisponible » partout. Or le 1er du mois suivant est précisément la borne où un PMS a le plus
 * de raisons de se comporter autrement (tarifs non chargés, période fermée). Ce qu'on n'a pas
 * demandé ne peut plus rien casser.
 *
 * Un enregistrement SANS date est écarté de la même façon, et pour la même raison : il ne porte
 * aucune identité utilisable, donc il ne peut ni servir ni condamner. S'il décrivait une nuit
 * demandée, cette nuit manquera à l'appel et la vérification de couverture le dira — c'est elle
 * qui fait foi, jamais un comptage d'enregistrements.
 *
 * L'UNIQUE EXCEPTION, et sa justification. Une réponse qui contient EXACTEMENT UN enregistrement
 * sans date, alors qu'on a demandé EXACTEMENT UNE nuit, est étiquetée avec cette nuit-là. Il n'y a
 * alors ni index, ni ordre, ni ambiguïté : une seule ligne ne peut correspondre qu'à la seule nuit
 * demandée. C'est aussi la forme sur laquelle la production a tourné jusqu'au 2026-08-28.
 * ⚠️ Elle est ATTEIGNABLE en production, contrairement à ce que laissait entendre la première
 * rédaction : `nightsOfMonth(mois courant, aujourd'hui)` ne rend qu'une nuit LE DERNIER JOUR DE
 * CHAQUE MOIS. Sous le comportement mesuré (plage honorée, bornes datées) Lobby rend deux
 * enregistrements datés ce jour-là et l'exception n'est pas prise ; elle ne sert que si Lobby
 * dévie.
 *
 * EFFET DE BORD UTILE, ET IL EST GRATUIT : cette fonction rend le code INDIFFÉRENT à la question
 * « `end_date` est-il inclusif ou exclusif ? ». La sonde du 2026-08-28 a répondu INCLUSIF, à
 * l'inverse de ce que supposait la production — et rien n'a bougé, parce qu'aucune ligne n'est
 * jamais étiquetée par son rang.
 */
export function alignLobbyCatalogEntries(
  entries: LobbyCatalogEntry[],
  requestedNights: string[]
): CatalogAlignment {
  if (entries.length === 1 && entries[0].date === null && requestedNights.length === 1) {
    return {
      ok: true,
      nights: [
        {
          date: requestedNights[0],
          availableByCategory: entries[0].availableByCategory,
          restrictionsByCategory: entries[0].restrictionsByCategory,
          pricesByCategory: entries[0].pricesByCategory,
        },
      ],
    };
  }

  const requested = new Set(requestedNights);
  const byDate = new Map<string, LobbyCatalogEntry>();
  let undated = 0;

  for (const entry of entries) {
    if (entry.date === null) {
      undated += 1;
      continue;
    }
    // Nuit rendue mais non demandée (typiquement la borne `end_date` inclusive) : écartée, sans
    // droit de regard sur le reste.
    if (!requested.has(entry.date)) continue;
    // Deux enregistrements pour la MÊME nuit DEMANDÉE : on ne sait pas lequel fait foi, et choisir
    // au hasard reviendrait à parier sur une disponibilité. Refuser est la seule réponse honnête.
    if (byDate.has(entry.date)) {
      return { ok: false, reason: "duplicate_date", detail: `date ${entry.date} rendue deux fois` };
    }
    byDate.set(entry.date, entry);
  }

  const missing = requestedNights.filter((night) => !byDate.has(night));
  if (missing.length > 0) {
    // `missing_date` plutôt qu'`incomplete_coverage` quand des enregistrements non datés traînent :
    // c'est la cause la plus probable du trou, et la distinction est ce qui rend le log utile.
    return undated > 0
      ? {
          ok: false,
          reason: "missing_date",
          detail: `${missing.length} nuit(s) demandée(s) absente(s) (première : ${missing[0]}), et ${undated} enregistrement(s) sans date`,
        }
      : {
          ok: false,
          reason: "incomplete_coverage",
          detail: `${missing.length} nuit(s) demandée(s) absente(s) de la réponse (première : ${missing[0]})`,
        };
  }

  // L'ordre suit la demande, pas la réponse : les appelants en aval (calendrier, cache) supposent
  // une fenêtre ordonnée, et rien ne garantit que Lobby trie.
  return {
    ok: true,
    nights: requestedNights.map((date) => {
      const entry = byDate.get(date) as LobbyCatalogEntry;
      return {
        date,
        availableByCategory: entry.availableByCategory,
        restrictionsByCategory: entry.restrictionsByCategory,
        pricesByCategory: entry.pricesByCategory,
      };
    }),
  };
}
