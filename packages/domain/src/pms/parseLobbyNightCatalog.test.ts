import { describe, expect, it } from "vitest";
import { parseLobbyNightCatalog, type LobbyCatalogEntry } from "./parseLobbyNightCatalog";
import { alignLobbyCatalogEntries } from "./alignLobbyCatalogEntries";
import { pickCategoryNights } from "./getNightAvailabilityWindow";

const GLAMPING = 29376;
const VIDPOVO = 9631;
const GUSTO = 36572;

// Fabrique une entrée COMPLÈTE. `restrictionsByCategory` est devenu obligatoire sur
// LobbyCatalogEntry le 2026-09-18 (miroir de disponibilité, commit 3a55671) ; les cas
// d'alignement ci-dessous ne s'intéressent qu'aux dates et aux dispos, mais un littéral
// incomplet ne compile pas. Le passer par ici évite de répéter une Map vide huit fois — et
// évite surtout qu'un futur champ obligatoire demande huit corrections au lieu d'une.
const entree = (
  date: string | null,
  availableByCategory: Map<number, number>
): LobbyCatalogEntry => ({ date, availableByCategory, restrictionsByCategory: new Map(), pricesByCategory: new Map() });

// Réponse de PLAGE telle qu'elle est HYPOTHÉTIQUEMENT rendue si `available-rooms` honore vraiment
// start_date/end_date (« over a date range » dans la doc, jamais essayé par personne — c'est ce que
// la sonde doit trancher). La forme mono-nuit, elle, est observée.
const rangeBody = (dates: string[], availableByDate: Record<string, number>) => ({
  data: dates.map((date) => ({
    date,
    categories: [
      { category_id: GLAMPING, available_rooms: availableByDate[date] ?? 3 },
      { category_id: VIDPOVO, available_rooms: 8 },
    ],
  })),
});

describe("parseLobbyNightCatalog — le piège de l'index", () => {
  // ⚠️ LE TEST QUI JUSTIFIE TOUT CE MODULE. Il porte un TÉMOIN : l'implémentation naïve, celle qui
  // était en place jusqu'au 2026-08-28 (`data[0]` + étiquetage par la date demandée). Les deux
  // tournent sur la MÊME charge utile. Sans le témoin, ce test passerait tout aussi bien avec le
  // code fautif — il ne prouverait rien.
  it("lit CHAQUE enregistrement d'une plage, et n'écrit jamais le premier jour sur tout le mois", () => {
    const dates = ["2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-25"];
    // Le 21 est libre, les suivants non : exactement le cas où l'erreur coûte de l'argent, puisque
    // le calendrier afficherait « disponible » sur des nuits pleines.
    const body = rangeBody(dates, {
      "2026-12-21": 3,
      "2026-12-22": 0,
      "2026-12-23": 0,
      "2026-12-24": 1,
      "2026-12-25": 0,
    });

    const parsed = parseLobbyNightCatalog(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const aligned = alignLobbyCatalogEntries(parsed.entries, dates);
    expect(aligned.ok).toBe(true);
    if (!aligned.ok) return;
    expect(aligned.nights.map((night) => night.availableByCategory.get(GLAMPING))).toEqual([3, 0, 0, 1, 0]);

    // TÉMOIN — l'ancien idiome, reproduit littéralement. Il rend un calendrier d'apparence
    // parfaitement normale : 5 nuits, toutes étiquetées, toutes « disponibles ». Et faux 4 fois sur 5.
    type EnregistrementLobby = {
      date: string;
      categories: { category_id: number; available_rooms: number }[];
    };
    const naif = dates.map((date) => {
      // `as` assumé : on reproduit ici un idiome qui n'était JUSTEMENT pas typé — le réécrire
      // proprement lui ferait perdre ce qu'il est là pour démontrer.
      const root = (Array.isArray(body.data) ? body.data[0] : body) as EnregistrementLobby;
      const category = root.categories.find((entry) => entry.category_id === GLAMPING);
      return { date, available: category?.available_rooms ?? 0 };
    });
    expect(naif.map((night) => night.available)).toEqual([3, 3, 3, 3, 3]);
    expect(naif).toHaveLength(5); // ⚠️ même longueur, mêmes dates : rien ne signale l'erreur.
  });

  it("refuse une plage dont un enregistrement ne porte pas de date, plutôt que de compter les rangs", () => {
    const body = {
      data: [
        { date: "2026-12-21", categories: [{ category_id: GLAMPING, available_rooms: 3 }] },
        { categories: [{ category_id: GLAMPING, available_rooms: 0 }] },
      ],
    };
    const parsed = parseLobbyNightCatalog(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries[1].date).toBeNull();

    const aligned = alignLobbyCatalogEntries(parsed.entries, ["2026-12-21", "2026-12-22"]);
    expect(aligned).toMatchObject({ ok: false, reason: "missing_date" });
  });

  it("refuse une réponse qui ne couvre pas toutes les nuits demandées", () => {
    const parsed = parseLobbyNightCatalog(rangeBody(["2026-12-21", "2026-12-22"], {}));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const aligned = alignLobbyCatalogEntries(parsed.entries, ["2026-12-21", "2026-12-22", "2026-12-23"]);
    expect(aligned).toMatchObject({ ok: false, reason: "incomplete_coverage" });
  });

  it("refuse deux enregistrements pour la même date plutôt que d'en élire un", () => {
    const parsed = parseLobbyNightCatalog(rangeBody(["2026-12-21", "2026-12-21"], {}));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(alignLobbyCatalogEntries(parsed.entries, ["2026-12-21"])).toMatchObject({
      ok: false,
      reason: "duplicate_date",
    });
  });

  it("⚠️ la nuit surnuméraire n'a AUCUN droit de veto : 31 nuits parfaites + une anomalie hors demande", () => {
    // LE DÉFAUT CORRIGÉ LE 2026-08-28 (revue adversariale). `end_date` étant inclusif et la
    // production envoyant « dernière nuit + 1 », il arrive SYSTÉMATIQUEMENT un enregistrement non
    // demandé : le 1er du mois suivant — précisément la borne où un PMS a le plus de raisons de se
    // comporter autrement. La première version validait AVANT de filtrer, donc cette nuit-là
    // pouvait condamner le mois entier.
    const nights = ["2026-12-21", "2026-12-22"];
    const bons = nights.map((date) => entree(date, new Map([[GLAMPING, 3]])));

    // (a) la nuit en trop n'est pas datée
    expect(
      alignLobbyCatalogEntries([...bons, entree(null, new Map())], nights)
    ).toMatchObject({ ok: true });

    // (b) la nuit en trop est rendue DEUX FOIS
    const surplus = entree("2026-12-23", new Map([[GLAMPING, 1]]));
    const aligned = alignLobbyCatalogEntries([...bons, surplus, surplus], nights);
    expect(aligned.ok).toBe(true);
    if (!aligned.ok) return;
    expect(aligned.nights.map((night) => night.date)).toEqual(nights);
  });

  it("mais un doublon sur une nuit DEMANDÉE échoue toujours — on ne parie pas sur une dispo", () => {
    const doublon = entree("2026-12-21", new Map([[GLAMPING, 3]]));
    expect(alignLobbyCatalogEntries([doublon, doublon], ["2026-12-21"])).toMatchObject({
      ok: false,
      reason: "duplicate_date",
    });
  });

  it("un enregistrement non daté qui EMPORTE une nuit demandée échoue, et le dit", () => {
    // L'enregistrement sans date est écarté ; c'est la vérification de COUVERTURE qui tranche, et
    // elle nomme la cause probable plutôt que de compter les enregistrements.
    const aligned = alignLobbyCatalogEntries(
      [
        entree("2026-12-21", new Map([[GLAMPING, 3]])),
        entree(null, new Map([[GLAMPING, 0]])),
      ],
      ["2026-12-21", "2026-12-22"]
    );
    expect(aligned).toMatchObject({ ok: false, reason: "missing_date" });
    if (aligned.ok) return;
    expect(aligned.detail).toContain("2026-12-22");
  });

  it("écarte une nuit rendue mais non demandée — donc `end_date` inclusif ne décale rien", () => {
    // Si Lobby s'avère INCLUSIF, une demande 21→22 pour la seule nuit du 21 rend deux
    // enregistrements. Le 22 est écarté, le 21 reste correct. C'est ce qui empêche la question
    // inclusif/exclusif de pouvoir décaler une grille en silence.
    const parsed = parseLobbyNightCatalog(rangeBody(["2026-12-21", "2026-12-22"], { "2026-12-22": 0 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const aligned = alignLobbyCatalogEntries(parsed.entries, ["2026-12-21"]);
    expect(aligned.ok).toBe(true);
    if (!aligned.ok) return;
    expect(aligned.nights).toHaveLength(1);
    expect(aligned.nights[0].date).toBe("2026-12-21");
    expect(aligned.nights[0].availableByCategory.get(GLAMPING)).toBe(3);
  });
});

describe("parseLobbyNightCatalog — forme mono-nuit observée", () => {
  it("lit le catalogue entier d'une nuit : 6 catégories en une réponse", () => {
    // Signature de la réponse OBSERVÉE le 2026-08-27 (compte Casa Kayam, appel sans category_id).
    const body = {
      date: "2026-09-26",
      categories: [
        { category_id: 9629, available_rooms: 4 },
        { category_id: VIDPOVO, available_rooms: 8 },
        { category_id: 18013, available_rooms: 12 },
        { category_id: GLAMPING, available_rooms: 3 },
        { category_id: GUSTO, available_rooms: 6 },
        { category_id: 49823, available_rooms: 2 },
      ],
    };
    const parsed = parseLobbyNightCatalog(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].date).toBe("2026-09-26");
    expect(parsed.entries[0].availableByCategory.size).toBe(6);
    expect(parsed.entries[0].availableByCategory.get(GUSTO)).toBe(6);
  });

  it("une catégorie ABSENTE n'est pas une catégorie à zéro", () => {
    const parsed = parseLobbyNightCatalog({
      date: "2026-09-26",
      categories: [{ category_id: VIDPOVO, available_rooms: 0 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Cotée à 0 = « complet », une réponse pleine et entière.
    expect(parsed.entries[0].availableByCategory.get(VIDPOVO)).toBe(0);
    // Absente = Lobby ne dit rien de cette catégorie. La distinction porte tout le dossier.
    expect(parsed.entries[0].availableByCategory.has(GUSTO)).toBe(false);
  });

  it("étiquette avec la nuit demandée quand la réponse ne porte aucune date — et seulement là", () => {
    const parsed = parseLobbyNightCatalog({ categories: [{ category_id: GUSTO, available_rooms: 5 }] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const aligned = alignLobbyCatalogEntries(parsed.entries, ["2026-12-23"]);
    expect(aligned).toMatchObject({ ok: true });
    if (!aligned.ok) return;
    expect(aligned.nights[0].date).toBe("2026-12-23");

    // Deux nuits demandées : l'exception ne s'applique plus, la réponse sans date est refusée.
    expect(alignLobbyCatalogEntries(parsed.entries, ["2026-12-23", "2026-12-24"])).toMatchObject({
      ok: false,
      reason: "missing_date",
    });
  });

  it("préfère la valeur la plus basse quand une catégorie apparaît deux fois", () => {
    const parsed = parseLobbyNightCatalog({
      date: "2026-09-26",
      categories: [
        { category_id: GUSTO, available_rooms: 6 },
        { category_id: GUSTO, available_rooms: 1 },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Sur-vendre est la seule erreur qui coûte de l'argent : à défaut de savoir laquelle fait foi,
    // on garde la plus prudente.
    expect(parsed.entries[0].availableByCategory.get(GUSTO)).toBe(1);
  });

  it("tolère un horodatage complet et n'en garde que le jour", () => {
    const parsed = parseLobbyNightCatalog({
      date: "2026-09-26 00:00:00",
      categories: [{ category_id: GUSTO, available_rooms: 6 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries[0].date).toBe("2026-09-26");
  });

  it("refuse un corps sans `categories[]` — jamais une fenêtre vide qui passerait pour un complet", () => {
    expect(parseLobbyNightCatalog(null).ok).toBe(false);
    expect(parseLobbyNightCatalog({ message: "Too Many Attempts." }).ok).toBe(false);
    expect(parseLobbyNightCatalog({ data: [{ date: "2026-09-26" }] }).ok).toBe(false);
    expect(parseLobbyNightCatalog({ date: "2026-09-26", categories: {} }).ok).toBe(false);
  });

  it("une disponibilité ILLISIBLE n'est pas un zéro : la catégorie est NON COTÉE", () => {
    // ⚠️ CORRIGÉ LE 2026-08-28 APRÈS REVUE. La première version rendait 0 — c'est-à-dire
    // « complet » — pour un champ absent, `null` ou `""`. Une nuit devenait donc non réservable
    // SANS un seul log, ce qui est exactement le silence que ce lot existe pour supprimer, et
    // contredit la règle du dossier : un échec de LECTURE n'est pas une disponibilité.
    const parsed = parseLobbyNightCatalog({
      date: "2026-09-26",
      categories: [
        { category_id: GUSTO, available_rooms: "beaucoup" },
        { category_id: VIDPOVO },
        { category_id: 9629, available_rooms: null },
        { category_id: 18013, available_rooms: "" },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const byCategory = parsed.entries[0].availableByCategory;
    for (const id of [GUSTO, VIDPOVO, 9629, 18013]) {
      expect(byCategory.has(id)).toBe(false);
    }
  });

  it("une valeur négative reste bornée à 0 — celle-là EST lisible, elle dit « complet »", () => {
    const parsed = parseLobbyNightCatalog({
      date: "2026-09-26",
      categories: [{ category_id: VIDPOVO, available_rooms: -3 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries[0].availableByCategory.get(VIDPOVO)).toBe(0);
  });

  it("tronque une valeur fractionnaire — jamais une demi-place à vendre", () => {
    // `available_rooms` compte des unités physiques. Un 2.5 deviendrait 2.5 cupos (une unité Lobby =
    // un cupo, pmsUnitsToCupos), donc une demi-place mise en vente.
    const parsed = parseLobbyNightCatalog({
      date: "2026-09-26",
      categories: [{ category_id: VIDPOVO, available_rooms: 2.5 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries[0].availableByCategory.get(VIDPOVO)).toBe(2);
  });

  it("ignore une entrée sans `category_id` plutôt que d'inventer la catégorie 0", () => {
    // `Number(null)` vaut 0. Sans garde, cette entrée créerait une catégorie FANTÔME numéro 0 — à
    // laquelle un produit pourrait réellement se raccrocher, `isPmsBacked` acceptant
    // `lobby_category_id = 0` (il ne teste que `!= null`).
    const parsed = parseLobbyNightCatalog({
      date: "2026-09-26",
      categories: [{ category_id: null, available_rooms: 7 }, { available_rooms: 7 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries[0].availableByCategory.size).toBe(0);
  });
});

describe("restrictions{min_stay, max_stay, lead_days} — relevées, jamais appliquées", () => {
  // ⚠️ CE QUE CES TESTS GARDENT, c'est un SILENCE qu'on vient de supprimer. Ces trois champs
  // existaient dans les réponses de Lobby sans qu'aucun parseur du chemin de réservation ne les
  // regarde. Ils valent {0,0,0} sur les six catégories de Casa Kayam (observé le 2026-08-27,
  // reconfirmé par la sonde du 2026-08-28) : aujourd'hui ils ne changent donc RIEN, et c'est
  // précisément la raison de les lire maintenant plutôt que le jour où ils compteront.
  const nuit = (categories: unknown[]) => ({ date: "2026-09-26", categories });

  it("lit la forme OBSERVÉE {0,0,0} — présente, et sans contrainte active", () => {
    const parsed = parseLobbyNightCatalog(
      nuit([{ category_id: GUSTO, available_rooms: 6, restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 } }])
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries[0].restrictionsByCategory.get(GUSTO)).toEqual({
      minStay: 0,
      maxStay: 0,
      leadDays: 0,
    });

    const aligned = alignLobbyCatalogEntries(parsed.entries, ["2026-09-26"]);
    expect(aligned.ok).toBe(true);
    if (!aligned.ok) return;
    // {0,0,0} = Lobby dit explicitement « aucune contrainte » : rien à signaler.
    expect(pickCategoryNights(aligned.nights, GUSTO).restrictedNights).toEqual([]);
  });

  it("une contrainte NON NULLE remonte jusqu'à l'appelant, nuit par nuit", () => {
    // Le jour où un établissement en pose une, le calendrier laisserait choisir une nuit que
    // POST /bookings refusera en 422 — sans que rien ne relie la cause à l'effet. C'est ce lien
    // que ce relevé rétablit, sans rien décider : il n'ampute aucune disponibilité.
    const parsed = parseLobbyNightCatalog({
      data: [
        nuit([{ category_id: GUSTO, available_rooms: 6, restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 } }]),
        {
          date: "2026-09-27",
          categories: [
            { category_id: GUSTO, available_rooms: 6, restrictions: { min_stay: 3, max_stay: 0, lead_days: 0 } },
          ],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const aligned = alignLobbyCatalogEntries(parsed.entries, ["2026-09-26", "2026-09-27"]);
    expect(aligned.ok).toBe(true);
    if (!aligned.ok) return;

    const picked = pickCategoryNights(aligned.nights, GUSTO);
    expect(picked.restrictedNights).toEqual([
      { date: "2026-09-27", restrictions: { minStay: 3, maxStay: 0, leadDays: 0 } },
    ]);
    // ⚠️ ET LA DISPONIBILITÉ EST INTACTE : relever n'est pas appliquer. Traduire un `min_stay` en
    // disponibilité serait un arbitrage produit (refuser la sélection ? échouer au paiement ?
    // afficher la contrainte ?), et ce module n'arbitre pas.
    expect(picked.nights).toHaveLength(2);
    expect(picked.missingDates).toEqual([]);
  });

  it("`restrictions` absent : la catégorie n'en porte pas, on n'en invente pas", () => {
    const parsed = parseLobbyNightCatalog(nuit([{ category_id: GUSTO, available_rooms: 6 }]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries[0].restrictionsByCategory.has(GUSTO)).toBe(false);
  });

  it("un champ illisible reste `null`, jamais 0 — « rien dit » n'est pas « pas de contrainte »", () => {
    const parsed = parseLobbyNightCatalog(
      nuit([{ category_id: GUSTO, available_rooms: 6, restrictions: { min_stay: "", lead_days: 2 } }])
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries[0].restrictionsByCategory.get(GUSTO)).toEqual({
      minStay: null,
      maxStay: null,
      leadDays: 2,
    });
  });

  it("un objet `restrictions` totalement illisible n'est pas inscrit du tout", () => {
    const parsed = parseLobbyNightCatalog(
      nuit([{ category_id: GUSTO, available_rooms: 6, restrictions: { min_stay: null, autre: "x" } }])
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Ne rien inscrire évite de faire croire à une observation qu'on n'a pas faite.
    expect(parsed.entries[0].restrictionsByCategory.has(GUSTO)).toBe(false);
  });
});

describe("parseLobbyNightCatalog — les prix Lobby (prix public, 2026-10-23)", () => {
  // Forme de la doc Lobby (dépôt legacy, docs/3-integrations/lobby_pms_api.md) : `plans[].prices[]`,
  // `{people, value}`, `value` parfois en chaîne (« 120000.00 »).
  const corps = (plans: unknown) => ({
    date: "2026-11-07",
    categories: [{ category_id: GLAMPING, available_rooms: 3, plans }],
  });
  const prixDe = (plans: unknown) => {
    const parsed = parseLobbyNightCatalog(corps(plans));
    return parsed.ok ? parsed.entries[0].pricesByCategory.get(GLAMPING) : "illisible";
  };

  it("lit `value` par niveau d'occupation, nombre ou chaîne", () => {
    expect(
      prixDe([{ name: "STANDARD_RATE", prices: [{ people: 1, value: 120000 }, { people: 2, value: "180000.00" }] }])
    ).toEqual({ 1: 120_000, 2: 180_000 });
  });

  it("STANDARD_RATE d'abord, sinon le premier plan qui porte des prix", () => {
    expect(
      prixDe([
        { name: "PROMO", prices: [{ people: 1, value: 90000 }] },
        { name: "STANDARD_RATE", prices: [{ people: 1, value: 120000 }] },
      ])
    ).toEqual({ 1: 120_000 });
    expect(
      prixDe([
        { name: "STANDARD_RATE", prices: [] },
        { name: "PROMO", prices: [{ people: 1, value: 90000 }] },
      ])
    ).toEqual({ 1: 90_000 });
  });

  it("absent, illisible ou ≤ 0 : omis — jamais un prix fabriqué, jamais une nuit gratuite", () => {
    expect(prixDe([])).toBeUndefined();
    expect(prixDe(undefined)).toBeUndefined();
    expect(
      prixDe([
        {
          name: "STANDARD_RATE",
          prices: [
            { people: 1, value: 0 },
            { people: 2, value: "" },
            { people: 3, value: "abc" },
            { people: 4, price: 50000 },
            { people: 0, value: 10000 },
            { people: 1.5, value: 10000 },
          ],
        },
      ])
    ).toBeUndefined();
  });

  it("une occupation cotée deux fois à deux prix différents est retirée, jamais tranchée", () => {
    expect(
      prixDe([{ name: "STANDARD_RATE", prices: [{ people: 1, value: 1000 }, { people: 1, value: 2000 }, { people: 2, value: 3000 }] }])
    ).toEqual({ 2: 3000 });
  });

  it("le prix suit la catégorie jusqu'au catalogue aligné (miroir, devis)", () => {
    const parsed = parseLobbyNightCatalog(corps([{ name: "STANDARD_RATE", prices: [{ people: 1, value: 120000 }] }]));
    if (!parsed.ok) throw new Error("illisible");
    const aligned = alignLobbyCatalogEntries(parsed.entries, ["2026-11-07"]);
    expect(aligned.ok && aligned.nights[0].pricesByCategory.get(GLAMPING)).toEqual({ 1: 120_000 });
  });
});
