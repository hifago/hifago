// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LOBBY_AVAILABILITY_OBSERVED_2026_08_27,
  LOBBY_ROOMS_OBSERVED_2026_08_26,
  LOBBY_SERVICES_OBSERVED_2026_08_26,
  setPmsFixtureScenario,
  startPmsFixtureServer,
} from "@hifago/e2e-support";
import {
  getLobbyAvailableRooms,
  getLobbyProducts,
  getLobbyRooms,
  parseLobbyAvailabilityContract,
  parseLobbyRooms,
  parseLobbyServices,
  type LobbyRoomCategory,
  type LobbyService,
} from "@hifago/domain";
import { collectLobbyPages } from "./lobbyEstablishment";

// Ce fichier existe pour une raison précise : les constantes « forme observée » de
// pmsFixtureServer.ts n'étaient consommées par AUCUN test. Le /simplify du 2026-08-26 l'a relevé —
// elles se présentaient comme le contrat de référence LobbyPMS tout en n'étant opposables à rien,
// et le commentaire du module affirmait le contraire. Elles sont désormais load-bearing : la chaîne
// complète est exercée sur du VRAI HTTP, fixture → lobbyClient → parseur → pagination.
//
// Ce que ça verrouille, et qui casserait en silence sinon : la sémantique du couple
// capacity × quantity (opposée entre une privée et un dortoir), le rejet des langues non éditables,
// et le fait qu'une catégorie sans contenu éditorial reste une catégorie valide.

const PORT = 45311;
let fixtureUrl: string;
let close: () => Promise<void>;

beforeAll(async () => {
  const server = await startPmsFixtureServer(PORT);
  fixtureUrl = server.url;
  close = server.close;
  setPmsFixtureScenario({
    rooms: LOBBY_ROOMS_OBSERVED_2026_08_26,
    services: LOBBY_SERVICES_OBSERVED_2026_08_26,
    availableRoomsCatalog: LOBBY_AVAILABILITY_OBSERVED_2026_08_27,
  });
});

afterAll(async () => {
  await close();
});

async function collectAllRoomIds(): Promise<number[]> {
  const collected = await collectLobbyPages<LobbyRoomCategory>(
    (page) => getLobbyRooms(fixtureUrl, "jeton-de-fixture", page),
    parseLobbyRooms,
    (category) => category.categoryId,
  );
  if (!collected.ok) throw new Error(`la fixture a répondu ${collected.status}`);
  return collected.items.map((category) => category.categoryId);
}

describe("Contrat LobbyPMS observé — GET /rooms de bout en bout", () => {
  async function collectRooms() {
    const collected = await collectLobbyPages<LobbyRoomCategory>(
      (page) => getLobbyRooms(fixtureUrl, "jeton-de-fixture", page),
      parseLobbyRooms,
      (category) => category.categoryId,
    );
    if (!collected.ok) throw new Error(`la fixture a répondu ${collected.status}`);
    return collected.items;
  }

  it("traverse HTTP et ressort les 3 catégories, sans doublon", async () => {
    const categories = await collectRooms();
    expect(categories.map((c) => c.categoryId)).toEqual([29376, 9631, 49823]);
  });

  // LE piège du couple : une privée est capacity:2 × quantity:3 (trois chambres de deux personnes),
  // un dortoir capacity:1 × quantity:8 (huit lits d'une personne). Les intervertir inverserait
  // l'information publiée au client.
  it("ne confond jamais capacity (occupants d'UNE unité) et quantity (nombre d'unités)", async () => {
    const categories = await collectRooms();
    const glamping = categories.find((c) => c.categoryId === 29376)!;
    const vidpovo = categories.find((c) => c.categoryId === 9631)!;

    expect(glamping.kind).toBe("private");
    expect([glamping.capacity, glamping.quantity]).toEqual([2, 3]);

    expect(vidpovo.kind).toBe("dorm");
    expect([vidpovo.capacity, vidpovo.quantity]).toEqual([1, 8]);
  });

  it("normalise le vocabulaire espagnol de Lobby (privada / compartida)", async () => {
    const categories = await collectRooms();
    expect(categories.map((c) => [c.rawType, c.kind])).toEqual([
      ["privada", "private"],
      ["compartida", "dorm"],
      ["privada", "private"],
    ]);
  });

  // Les langues que l'éditeur hifago ne sait pas afficher sont SIGNALÉES, jamais écrites : les
  // écrire produirait une valeur publiée par repli mais invisible et non supprimable dans l'éditeur.
  it("n'importe jamais une langue non éditable, et la signale", async () => {
    const glamping = (await collectRooms()).find((c) => c.categoryId === 29376)!;
    expect(Object.keys(glamping.descriptions).sort()).toEqual(["en", "es"]);
    expect(glamping.unsupportedLangs).toEqual(["fr", "pt"]);
  });

  // Cas réel : 2 des 6 catégories du compte n'ont ni description ni photo. C'est nominal, pas une
  // anomalie — la carte de prévisualisation doit rester lisible dessus.
  it("accepte une catégorie sans aucun contenu éditorial", async () => {
    const camper = (await collectRooms()).find((c) => c.categoryId === 49823)!;
    expect(camper.descriptions).toEqual({});
    expect(camper.photos).toEqual([]);
    expect(camper.capacity).toBe(4);
    expect(camper.roomLabels).toEqual(["Habitación 1", "Habitación 2"]);
  });

  it("expose les photos comme de simples URLs", async () => {
    const glamping = (await collectRooms()).find((c) => c.categoryId === 29376)!;
    expect(glamping.photos).toHaveLength(2);
    expect(glamping.photos[0]).toMatch(/^https:\/\/app\.lobbypms\.com\//);
  });
});

// La sonde de contrat (C1/C5), exercée sur du vrai HTTP comme les deux autres describes. Elle
// rejoue désormais la charge utile RÉELLEMENT OBSERVÉE le 2026-08-27 (relevé en préprod via le
// relais) : ces assertions verrouillent donc deux réponses acquises, pas deux hypothèses.
describe("Sonde de contrat — GET /available-rooms sans category_id", () => {
  async function probe() {
    const response = await getLobbyAvailableRooms(fixtureUrl, "jeton-de-fixture", "2026-09-26", "2026-09-27");
    expect(response.status).toBe(200);
    return parseLobbyAvailabilityContract(response.body);
  }

  // C1, RÉFUTÉ le 2026-08-27 et verrouillé ici. L'hypothèse était : « Lobby ne cote que les
  // catégories réservables, donc la réponse EST le filtre ». Le compte réel cote les SIX, avec une
  // signature de champs identique et une disponibilité non nulle partout — y compris 18013 et
  // 49823, qui refusaient un booking en 422 le 2026-07-06. Cette réponse ne discrimine rien.
  // Ce test existe pour qu'on ne réessaie pas : s'il devient faux un jour, c'est que Lobby a
  // changé, et C1 redevient une piste.
  it("ne discrimine RIEN : toutes les catégories cotées, une seule signature de champs", async () => {
    const contract = await probe();
    const byValue = (a: number, b: number) => a - b;
    const known = (await collectAllRoomIds()).sort(byValue);

    expect([...contract.categoryIds].sort(byValue)).toEqual([9629, 9631, 18013, 29376, 36572, 49823]);
    expect(known.filter((id) => !contract.categoryIds.includes(id))).toEqual([]);
    expect(new Set(contract.categories.map((c) => c.keys.join(","))).size).toBe(1);
    expect(contract.categories.every((c) => (c.availableRooms ?? 0) > 0)).toBe(true);
  });

  // C5, RÉPONDU. `restrictions` existe bien — il n'avait jamais été observé — et vaut {0,0,0} sur
  // les six. Aucune contrainte sur ce compte : n'appliquer que si > 0 reste la bonne règle, et
  // c'est maintenant un constat, plus une précaution.
  it("porte `restrictions` sur toutes les catégories, toutes à zéro (C5)", async () => {
    const contract = await probe();
    expect(contract.categories.every((c) => c.restrictions !== null)).toBe(true);
    for (const category of contract.categories) {
      expect(category.restrictions).toEqual({ min_stay: 0, max_stay: 0, lead_days: 0 });
    }
  });

  // Constat non cherché, et qui vaut d'être gelé : Lobby cote UN plan, avec autant de prix que la
  // capacité d'une unité — GLAMPING (capacity 2) → 2 prix, CAMPER Van (capacity 4) → 4, les
  // dortoirs (capacity 1) → 1. Ses prix sont donc par NIVEAU D'OCCUPATION, un modèle que hifago
  // n'a pas (unit = per_person | per_two | per_house). Ce constat fondait « Lobby n'est jamais la
  // source du prix », révisé le 2026-10-23 (prix public = prix Lobby, au niveau d'occupation exact :
  // spec 24 §0) ; le contrat nocturne, lui, COMPTE toujours ces prix sans les lire.
  it("expose un plan par catégorie, avec un prix par niveau d'occupation", async () => {
    const contract = await probe();
    const byId = new Map(contract.categories.map((c) => [c.categoryId, c]));
    expect(contract.categories.every((c) => c.planCount === 1)).toBe(true);
    expect(byId.get(9631)!.priceCount).toBe(1);
    expect(byId.get(29376)!.priceCount).toBe(2);
    expect(byId.get(49823)!.priceCount).toBe(4);
  });
});

describe("Contrat LobbyPMS observé — GET /products de bout en bout", () => {
  it("ne renvoie qu'identifiant, nom, prix et stock — jamais de photo ni de capacité", async () => {
    const collected = await collectLobbyPages<LobbyService>(
      (page) => getLobbyProducts(fixtureUrl, "jeton-de-fixture", page),
      parseLobbyServices,
      (service) => service.serviceId,
    );
    if (!collected.ok) throw new Error(`la fixture a répondu ${collected.status}`);

    expect(collected.items).toHaveLength(3);
    const yoga = collected.items.find((s) => s.serviceId === 494426)!;
    expect(yoga.name).toBe("YOGA session");
    expect(yoga.valueCop).toBe(22000);
    expect(yoga.infiniteInventory).toBe(true);
    expect(yoga.stock).toBeNull();
    // La raison pour laquelle lier une ACTIVITÉ à un service ne peut rien rapatrier d'autre : ces
    // champs n'existent pas sur cette ressource, aucun compte n'en fournira (spec 24 §11.3).
    expect(Object.keys(yoga).sort()).toEqual([
      "infiniteInventory",
      "name",
      "serviceId",
      "stock",
      "valueCop",
    ]);
  });
});
