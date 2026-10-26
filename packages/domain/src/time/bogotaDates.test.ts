import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OPERATION_TIME_ZONE,
  addDaysIso,
  formatDateInBogota,
  formatDateTimeInBogota,
  isoDateToLocalMidnight,
  nowIsoInstant,
  nowTimeInBogota,
  startOfTodayInBogota,
  startTimeHasPassed,
  todayInBogota,
} from "./bogotaDates";

// L'INSTANT DE RÉFÉRENCE de tout ce lot : 2026-08-28, 2 h 30 UTC. À Guatapé il est encore le 27,
// 21 h 30. Toute la campagne du 2026-08-28 tient dans cet écart d'un jour, tous les soirs entre 19 h
// et minuit heure locale.
const INSTANT = new Date("2026-08-28T02:30:00Z");

// TÉMOINS — les deux expressions exactes qui étaient dans le code de production avant ce lot. Elles
// sont reproduites ici plutôt que décrites, pour que chaque test prouve un ÉCART mesuré au lieu
// d'affirmer une amélioration. Si un jour l'un de ces témoins cesse de différer du correctif, c'est
// que le test a cessé de tester quelque chose — et il le dira.
const temoinDateUtc = (instant: Date) => instant.toISOString().slice(0, 10);
const temoinJourNavigateur = (instant: Date) => new Date(instant).getDate();

describe("startOfTodayInBogota", () => {
  // La machine de développement de ce projet est réglée sur America/Bogota : c'est précisément
  // pourquoi personne n'a jamais vu ce bug en local. Un test qui tourne dans le fuseau de Guatapé ne
  // peut RIEN prouver sur les trois formulaires de réservation, qui prenaient le jour du NAVIGATEUR.
  // On force donc le processus à Paris — le fuseau du visiteur européen du grief.
  const tzOriginal = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Europe/Paris";
  });
  afterAll(() => {
    // `process.env.TZ = tzOriginal` écrirait la CHAÎNE "undefined" quand la variable n'était pas
    // posée (mesuré) — Node la lit alors comme un fuseau invalide. `delete` restaure vraiment.
    if (tzOriginal === undefined) delete process.env.TZ;
    else process.env.TZ = tzOriginal;
  });

  it("rend le jour de Guatapé, pas celui du navigateur (le visiteur européen à 2 h du matin)", () => {
    const midnight = startOfTodayInBogota(INSTANT);
    expect(midnight.getFullYear()).toBe(2026);
    expect(midnight.getMonth()).toBe(7); // août
    expect(midnight.getDate()).toBe(27);

    // TÉMOIN : sans le correctif, `{ before: new Date() }` désignait le 28 — le 27 partait barré et
    // non cliquable pour ce visiteur, alors qu'à Guatapé la nuit du 27 était encore réservable.
    expect(temoinJourNavigateur(INSTANT)).toBe(28);
    expect(temoinJourNavigateur(INSTANT)).not.toBe(midnight.getDate());
  });

  it("est bien minuit LOCAL — c'est ce que compare react-day-picker, jamais un instant UTC", () => {
    const midnight = startOfTodayInBogota(INSTANT);
    expect(midnight.getHours()).toBe(0);
    expect(midnight.getMinutes()).toBe(0);
    expect(midnight.getSeconds()).toBe(0);
    expect(midnight.getMilliseconds()).toBe(0);
  });

  it("coïncide avec le navigateur en journée — l'écart n'apparaît que le soir, d'où sa longévité", () => {
    const enJournee = new Date("2026-08-28T15:00:00Z");
    expect(startOfTodayInBogota(enJournee).getDate()).toBe(temoinJourNavigateur(enJournee));
  });
});

describe("isoDateToLocalMidnight", () => {
  it("rend minuit local de la date demandée, quel que soit le fuseau du processus", () => {
    const d = isoDateToLocalMidnight("2026-12-23");
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 12, 23]);
    expect(d.getHours()).toBe(0);
  });

  it("refuse une date malformée au lieu de fabriquer un Invalid Date", () => {
    expect(() => isoDateToLocalMidnight("2026-12-3")).toThrow(RangeError);
  });
});

describe("addDaysIso", () => {
  it("avance et recule sur des dates civiles, sans jamais consulter de fuseau", () => {
    expect(addDaysIso("2026-12-23", 1)).toBe("2026-12-24");
    expect(addDaysIso("2026-12-23", -1)).toBe("2026-12-22");
    expect(addDaysIso("2026-12-23", 0)).toBe("2026-12-23");
  });

  it("franchit les frontières de mois, d'année et un 29 février", () => {
    expect(addDaysIso("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29"); // 2028 est bissextile
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01"); // 2026 ne l'est pas
  });

  it("reproduit les fenêtres réelles du dépôt (+180 vitrine, −30/+183 agenda socio)", () => {
    expect(addDaysIso("2026-08-27", 180)).toBe("2027-02-23");
    expect(addDaysIso("2026-08-27", -30)).toBe("2026-07-28");
    expect(addDaysIso("2026-08-27", 183)).toBe("2027-02-26");
  });

  it("rend le même résultat quel que soit le fuseau du processus — c'est ce qui la rend sûre", () => {
    const tzOriginal = process.env.TZ;
    const attendu = addDaysIso("2026-12-23", 1);
    for (const tz of ["Europe/Paris", "Pacific/Kiritimati", "Pacific/Midway", "UTC"]) {
      process.env.TZ = tz;
      expect(addDaysIso("2026-12-23", 1)).toBe(attendu);
    }
    if (tzOriginal === undefined) delete process.env.TZ;
    else process.env.TZ = tzOriginal;
    expect(attendu).toBe("2026-12-24");
  });

  it("refuse une date malformée plutôt que de rendre \"Invalid Date\" tronqué", () => {
    expect(() => addDaysIso("28/08/2026", 1)).toThrow(RangeError);
    expect(() => addDaysIso("", 1)).toThrow(RangeError);
  });
});

describe("nowIsoInstant", () => {
  it("rend l'instant COMPLET, jamais une date civile — c'est là toute la distinction", () => {
    expect(nowIsoInstant(INSTANT)).toBe("2026-08-28T02:30:00.000Z");
    // Le témoin, lui, est le geste interdit : tronquer ce même instant pour en tirer un jour.
    expect(temoinDateUtc(INSTANT)).toBe("2026-08-28");
    expect(todayInBogota(INSTANT)).toBe("2026-08-27");
  });
});

describe("la chaîne complète, sur le grief du 2026-08-28", () => {
  it("todayInBogota + addDaysIso donnent la fenêtre que le code de production calculait faux", () => {
    const aujourdhui = todayInBogota(INSTANT);
    expect(aujourdhui).toBe("2026-08-27");
    expect(addDaysIso(aujourdhui, 180)).toBe("2027-02-23");

    // TÉMOIN : l'ancien code partait de la date UTC. Toute la fenêtre glissait d'un jour, et le
    // plancher `gte("date", todayIso)` excluait la journée en cours du catalogue.
    const ancien = temoinDateUtc(INSTANT);
    expect(ancien).toBe("2026-08-28");
    expect(ancien).not.toBe(aujourdhui);
  });
});

describe("formatDateInBogota / formatDateTimeInBogota", () => {
  // Une commande passée à Guatapé le 27 août 2026 à 20 h 15 : created_at = 2026-08-28T01:15:00Z.
  const COMMANDE = "2026-08-28T01:15:00Z";

  const tzOriginal = process.env.TZ;
  beforeAll(() => {
    // Le fuseau des serveurs Vercel, c'est-à-dire l'endroit où ces chaînes sont réellement rendues.
    process.env.TZ = "UTC";
  });
  afterAll(() => {
    if (tzOriginal === undefined) delete process.env.TZ;
    else process.env.TZ = tzOriginal;
  });

  it("rend le jour de Guatapé alors que le processus est en UTC", () => {
    expect(formatDateInBogota(COMMANDE, "es")).toBe("27/8/2026");
    // TÉMOIN : l'expression exacte des dix-sept sites d'avant.
    expect(new Date(COMMANDE).toLocaleDateString("es")).toBe("28/8/2026");
  });

  it("rend aussi l'heure locale correcte, pas une heure absurde du matin", () => {
    // ⚠️ Ne jamais comparer ces chaînes à un littéral écrit à la main : ICU sépare « 8:15:00 » de
    // « p. m. » par une espace insécable ÉTROITE (U+202F), invisible à la relecture — deux chaînes
    // rigoureusement identiques à l'œil échouent alors sur `toBe`. On normalise les espaces.
    const espaces = (v: string) => v.replace(/\s/g, " ");
    expect(espaces(formatDateTimeInBogota(COMMANDE, "es-CO"))).toBe("27/8/2026, 8:15:00 p. m.");
    // TÉMOIN : « Creada el 28/8/2026, 1:15:00 a. m. » pour une réservation de 20 h 15.
    expect(espaces(new Date(COMMANDE).toLocaleString("es-CO"))).toBe("28/8/2026, 1:15:00 a. m.");
  });

  it("conserve EXACTEMENT le format d'origine — seul le fuseau de projection change", () => {
    // Contrôle : une machine réglée sur Guatapé, sans option, rend la même chaîne.
    process.env.TZ = "America/Bogota";
    expect(new Date(COMMANDE).toLocaleDateString("es")).toBe(formatDateInBogota(COMMANDE, "es"));
    expect(new Date(COMMANDE).toLocaleString("es-CO")).toBe(formatDateTimeInBogota(COMMANDE, "es-CO"));
    process.env.TZ = "UTC";
  });

  it("accepte un Date, une chaîne ISO ou un epoch, et une locale absente", () => {
    const attendu = formatDateInBogota(COMMANDE, "es");
    expect(formatDateInBogota(new Date(COMMANDE), "es")).toBe(attendu);
    expect(formatDateInBogota(Date.parse(COMMANDE), "es")).toBe(attendu);
    expect(formatDateInBogota(COMMANDE)).toMatch(/2026/); // locale du runtime, fuseau imposé
  });
});

// ── Repris de todayInBogota.test.ts lors de la fusion des deux modules (2026-08-28). Le helper
// local `utcDay` de ce fichier-là a été remplacé par `temoinDateUtc` ci-dessus, rigoureusement
// identique — un seul témoin pour tout le module.
describe("todayInBogota", () => {
  it("rend encore la veille quand UTC est déjà passé au lendemain (le bug de 19 h)", () => {
    // 2026-12-24T02:30:00Z = 23 décembre, 21 h 30 à Guatapé. Un client qui ouvre le calendrier à ce
    // moment-là doit encore pouvoir voir la nuit du 23 — c'est le grief mesuré du 2026-08-28.
    const instant = new Date("2026-12-24T02:30:00Z");
    expect(todayInBogota(instant)).toBe("2026-12-23");
    expect(temoinDateUtc(instant)).toBe("2026-12-24");
  });

  it("bascule à minuit heure locale, pas à minuit UTC", () => {
    expect(todayInBogota(new Date("2026-12-24T04:59:59Z"))).toBe("2026-12-23");
    expect(todayInBogota(new Date("2026-12-24T05:00:00Z"))).toBe("2026-12-24");
  });

  it("coïncide avec UTC en journée — le bug n'était visible que le soir, d'où sa longévité", () => {
    const instant = new Date("2026-12-23T15:00:00Z");
    expect(todayInBogota(instant)).toBe(temoinDateUtc(instant));
  });

  it("rend toujours un yyyy-MM-dd zéro-padé, comparable par chaîne", () => {
    // Les comparaisons du domaine sont lexicographiques (`iso >= notBeforeIso` dans nightsOfMonth) :
    // un mois ou un jour non padé casserait l'ordre en silence.
    expect(todayInBogota(new Date("2026-01-05T18:00:00Z"))).toBe("2026-01-05");
    expect(todayInBogota(new Date("2026-01-05T04:00:00Z"))).toBe("2026-01-04");
  });

  it("expose le fuseau sous forme de constante, pour que personne ne le retape", () => {
    expect(OPERATION_TIME_ZONE).toBe("America/Bogota");
  });
});

// ── Ajouté le 2026-08-28 : les deux débordements d'`addDaysIso`, trouvés par la session du
// connecteur PMS dans son jumeau `addOneDay` puis reproduits ici. Les deux témoins ci-dessous
// rejouent l'implémentation FAUTIVE — sans eux, ces tests affirmeraient une correction au lieu de
// prouver un écart.
describe("addDaysIso — les deux débordements de l'ancre Date.UTC", () => {
  // L'implémentation exacte d'avant le 2026-08-28.
  const temoinAncienneAncre = (dateIso: string, days: number): string => {
    const [y, m, d] = dateIso.split("-").map(Number);
    const anchor = new Date(Date.UTC(y, m - 1, d));
    anchor.setUTCDate(anchor.getUTCDate() + days);
    return anchor.toISOString().slice(0, 10);
  };

  it("ne remappe plus les années à deux chiffres (Date.UTC(1, …) vaut 1901, pas l'an 1)", () => {
    expect(temoinAncienneAncre("0001-01-01", -1)).toBe("1900-12-31"); // faux de dix-neuf siècles
    expect(addDaysIso("0001-01-02", -1)).toBe("0001-01-01");
    expect(addDaysIso("0099-12-31", 1)).toBe("0100-01-01");
  });

  it("refuse de sortir du domaine yyyy-MM-dd au lieu de rendre \"+010000-01\"", () => {
    expect(temoinAncienneAncre("9999-12-31", 1)).toBe("+010000-01"); // end_date malformé chez Lobby
    expect(() => addDaysIso("9999-12-31", 1)).toThrow(RangeError);
    expect(() => addDaysIso("0001-01-01", -1)).toThrow(RangeError);
    // La borne elle-même reste calculable — on ne rétrécit pas le domaine utile.
    expect(addDaysIso("9999-12-30", 1)).toBe("9999-12-31");
  });
});

describe("nowTimeInBogota / startTimeHasPassed — l'heure compte le jour même", () => {
  // Le grief du 2026-10-24 : à 17 h 10 à Guatapé (22 h 10 UTC), un yoga de 10 h 30 du jour restait
  // réservable. Processus forcé à Paris : l'heure de la MACHINE ne doit jamais entrer en jeu.
  const tzOriginal = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Europe/Paris";
  });
  afterAll(() => {
    process.env.TZ = tzOriginal;
  });
  const A_17H10 = new Date("2026-10-24T22:10:00Z");

  it("rend l'heure de Guatapé, jamais celle de la machine ni d'UTC", () => {
    expect(nowTimeInBogota(A_17H10)).toBe("17:10");
    expect(nowTimeInBogota(new Date("2026-10-25T05:05:00Z"))).toBe("00:05");
  });

  it("refuse une heure du jour déjà passée, accepte une heure à venir", () => {
    expect(startTimeHasPassed("2026-10-24", "10:30:00", A_17H10)).toBe(true);
    expect(startTimeHasPassed("2026-10-24", "17:10", A_17H10)).toBe(true);
    expect(startTimeHasPassed("2026-10-24", "17:11", A_17H10)).toBe(false);
  });

  it("ne touche qu'au jour même : demain reste ouvert, hier est passé, sans heure rien ne change", () => {
    expect(startTimeHasPassed("2026-10-25", "08:00", A_17H10)).toBe(false);
    expect(startTimeHasPassed("2026-10-23", "23:00", A_17H10)).toBe(true);
    expect(startTimeHasPassed("2026-10-24", null, A_17H10)).toBe(false);
  });

  it("à 21 h à Guatapé (déjà le lendemain en UTC), un créneau de 22 h du jour reste ouvert", () => {
    const a21h = new Date("2026-10-25T02:00:00Z");
    expect(startTimeHasPassed("2026-10-24", "22:00", a21h)).toBe(false);
    expect(startTimeHasPassed("2026-10-24", "20:00", a21h)).toBe(true);
  });
});
