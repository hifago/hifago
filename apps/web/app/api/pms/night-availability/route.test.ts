// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPmsFixtureCalls,
  resetPmsFixtureCalls,
  setPmsFixtureScenario,
  startPmsFixtureServer,
} from "@hifago/e2e-support";
import { todayInBogota } from "@hifago/domain";

// LE ROUTE HANDLER LUI-MÊME, exercé pour de vrai. Il ne l'était par RIEN avant le 2026-08-28
// (relevé par la revue adversariale) : le test e2e intercepte `/api/pms/night-availability` au
// niveau NAVIGATEUR (mockPmsNightAvailability), donc ce fichier n'était jamais exécuté, et
// lobbyCallBudget.test.ts n'exerce que des fonctions du domaine. Tous les invariants que ses
// commentaires revendiquent — clé de cache par établissement, échec jamais mémorisé, conversion en
// cupos APRÈS le cache et par produit — n'étaient donc que des affirmations.
//
// Seule la base est simulée (il n'y en a pas dans un test unitaire) ; LobbyPMS, lui, est un VRAI
// serveur HTTP, celui de packages/e2e-support.
const PORT = 34571;
const CATEGORY = 36572;
const OTHER_CATEGORY = 29376;

interface FakeProduct {
  id: string;
  type: string;
  lobby_category_id: number | null;
  establishment_id: string;
  lodging_kind: string | null;
  capacity: number | null;
  sellable?: boolean;
}
interface FakeEstablishment {
  id: string;
  lobby_connector_active: boolean;
  lobby_api_token: string | null;
}

const products = new Map<string, FakeProduct>();
const establishments = new Map<string, FakeEstablishment>();

// Lot B (20260918170000) : la route appelle désormais aussi `service.rpc("sync_pms_availability_month", …)`
// sur une réponse Lobby fraîche — capturé ici pour être affirmé, jamais juste ignoré (un vrai client
// Supabase ne lève jamais synchronement sur un `.rpc()` inconnu ; c'est cette réalité que le `try/
// catch` de la route protège, pas seulement ce faux client de test).
let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

// Tables dont la lecture échoue (panne Supabase) : la route doit le distinguer d'une absence.
const lecturesEnPanne = new Set<string>();

// Reproduit la seule forme de requête que la route émet : .from().select().eq()…maybeSingle() et
// .rpc(nom, args).
vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        maybeSingle: async () => {
          if (lecturesEnPanne.has(table)) return { data: null, error: { message: "panne" } };
          if (table === "products") {
            const product = products.get(String(filters.id));
            // `sellable` est un filtre RÉEL de la route (un produit non publié ne doit pas exposer
            // la disponibilité Lobby en direct) : le faux client doit l'appliquer, sinon le test
            // prouverait le contraire de ce que fait la production.
            if (!product) return { data: null };
            if (filters.sellable === true && product.sellable === false) return { data: null };
            return { data: product };
          }
          return { data: establishments.get(String(filters.id)) ?? null };
        },
      };
      return builder;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { error: null };
    },
  }),
}));

let close: () => Promise<void>;
let GET: (request: Request) => Promise<Response>;

// Un mois calculé depuis la date de Bogotá, jamais une constante figée qui périmerait le test.
// ⚠️ Depuis le 2026-08-28, l'horizon produit vaut SIX mois (RESERVATION_HORIZON_MONTHS) : un offset
// au-delà de 6 se fait refuser en 400 `month_out_of_range` par la route, avant toute lecture. Les
// deux tests ci-dessous employaient 7 et 8 du temps où le garde était à 36 mois ; ils partagent
// désormais le même mois, ce qui est sans effet puisque chacun crée son propre établissement et que
// la clé de cache porte `${establishmentId}:${month}`.
function monthAhead(offset: number): string {
  const [year, month] = todayInBogota().split("-").map(Number);
  const index = year * 12 + (month - 1) + offset;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function call(productId: string, month: string) {
  return GET(new Request(`http://localhost/api/pms/night-availability?productId=${productId}&month=${month}`));
}

let seq = 0;
// Identifiants au format UUID : la route refuse (400) tout `productId` qui n'en est pas un, comme
// reserve-nights. Le préfixe distingue établissements (e…) et produits (b…) à la lecture des logs.
const uuidDeTest = (prefixe: "e" | "b", n: number) =>
  `${prefixe}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function freshEstablishment(token = "fake-token"): string {
  // Un établissement NEUF par test : le cache de la route est un module-level singleton, deux tests
  // qui partagent une clé se contamineraient — exactement le piège relevé dans le journal du
  // 2026-08-27 entre deux specs partageant un enregistrement seedé.
  const id = uuidDeTest("e", (seq += 1));
  establishments.set(id, { id, lobby_connector_active: true, lobby_api_token: token });
  return id;
}

function addProduct(establishmentId: string, overrides: Partial<FakeProduct> = {}): string {
  const id = uuidDeTest("b", (seq += 1));
  products.set(id, {
    id,
    type: "lodging",
    lobby_category_id: CATEGORY,
    establishment_id: establishmentId,
    lodging_kind: null,
    capacity: null,
    sellable: true,
    ...overrides,
  });
  return id;
}

beforeAll(async () => {
  const server = await startPmsFixtureServer(PORT);
  process.env.LOBBY_API_BASE_URL = server.url;
  close = server.close;
  ({ GET } = await import("./route"));
});

afterAll(async () => {
  delete process.env.LOBBY_API_BASE_URL;
  await close();
});

beforeEach(() => {
  lecturesEnPanne.clear();
  resetPmsFixtureCalls();
  setPmsFixtureScenario({ catalogCategoryIds: [CATEGORY, OTHER_CATEGORY] });
  rpcCalls = [];
});

describe("lot B — la réponse Lobby fraîche nourrit le miroir de disponibilité", () => {
  it("une réponse fraîche (cache miss) écrit le miroir AVEC les lignes du catalogue Lobby", async () => {
    const establishmentId = freshEstablishment();
    const productId = addProduct(establishmentId);
    const month = monthAhead(1);

    expect((await call(productId, month)).status).toBe(200);

    const writes = rpcCalls.filter((c) => c.name === "sync_pms_availability_month");
    expect(writes).toHaveLength(1);
    expect(writes[0].args.p_establishment_id).toBe(establishmentId);
    expect(writes[0].args.p_month).toBe(month);
    const rows = writes[0].args.p_rows as { category_id: number; date: string }[];
    // Toutes les catégories cotées par Lobby, pas seulement celle du produit demandé — c'est le
    // même catalogue que le cron écrirait, jamais une vue partielle réservée à ce visiteur.
    expect(rows.some((r) => r.category_id === CATEGORY)).toBe(true);
    expect(rows.some((r) => r.category_id === OTHER_CATEGORY)).toBe(true);
  });

  it("un second appel servi par le cache (même établissement, même mois) n'écrit PAS de nouveau", async () => {
    const establishmentId = freshEstablishment();
    const first = addProduct(establishmentId);
    const second = addProduct(establishmentId, { lobby_category_id: OTHER_CATEGORY });
    const month = monthAhead(1);

    await call(first, month);
    await call(second, month);

    expect(rpcCalls.filter((c) => c.name === "sync_pms_availability_month")).toHaveLength(1);
  });
});

describe("le cache porte l'établissement et le mois, plus le produit", () => {
  it("deux produits du MÊME établissement et du même mois : UN seul appel Lobby", async () => {
    const establishmentId = freshEstablishment();
    const first = addProduct(establishmentId);
    const second = addProduct(establishmentId, { lobby_category_id: OTHER_CATEGORY });
    const month = monthAhead(2);

    expect((await call(first, month)).status).toBe(200);
    expect((await call(second, month)).status).toBe(200);
    // C'est TOUT le gain de R1, et il n'était prouvé nulle part au niveau de la route.
    expect(getPmsFixtureCalls("/api/v2/available-rooms")).toBe(1);
  });

  it("deux ÉTABLISSEMENTS différents ne se partagent jamais une lecture, même catégorie identique", async () => {
    // `lobby_category_id` est un entier LOCAL à chaque compte Lobby : sans le préfixe
    // établissement, le second visiteur recevrait la disponibilité du premier.
    const month = monthAhead(3);
    const a = addProduct(freshEstablishment());
    const b = addProduct(freshEstablishment());

    expect((await call(a, month)).status).toBe(200);
    expect((await call(b, month)).status).toBe(200);
    expect(getPmsFixtureCalls("/api/v2/available-rooms")).toBe(2);
  });
});

describe("la conversion en cupos est PAR PRODUIT, après le cache", () => {
  it("deux produits sur la MÊME catégorie et des capacités différentes ne se contaminent pas", async () => {
    // Le risque que R1 crée : ce qui est en cache appartient à l'établissement, donc multiplier
    // avant le cache écrirait la conversion du premier visiteur sur tous les suivants.
    const establishmentId = freshEstablishment();
    const month = monthAhead(4);
    setPmsFixtureScenario({ catalogCategoryIds: [CATEGORY], nightAvailabilityByDate: {} });

    const dortoir = addProduct(establishmentId, { lodging_kind: "dorm", capacity: 4 });
    const privee = addProduct(establishmentId, { lodging_kind: "private", capacity: 4 });

    const dortoirBody = (await (await call(dortoir, month)).json()) as { nights: { capacity: number }[] };
    const priveeBody = (await (await call(privee, month)).json()) as { nights: { capacity: number }[] };

    // Lobby cote 5 unités (défaut de la fixture). Un dortoir se vend au LIT (5 × 4 = 20 cupos),
    // une privée à l'UNITÉ (5).
    expect(dortoirBody.nights[0].capacity).toBe(20);
    expect(priveeBody.nights[0].capacity).toBe(5);
    // …et le second produit n'a rien redemandé à Lobby.
    expect(getPmsFixtureCalls("/api/v2/available-rooms")).toBe(1);
  });
});

describe("un échec n'est jamais mémorisé", () => {
  it("deux requêtes successives en échec = deux appels Lobby, jamais un échec resservi 60 s", async () => {
    const establishmentId = freshEstablishment();
    const productId = addProduct(establishmentId);
    const month = monthAhead(5);
    const firstNight = `${month}-01`;
    setPmsFixtureScenario({
      catalogCategoryIds: [CATEGORY],
      nightAvailabilityByDate: { [firstNight]: { status: 500 } },
    });

    expect((await call(productId, month)).status).toBe(502);
    expect((await call(productId, month)).status).toBe(502);
    // Le cache n'évince que sur promesse REJETÉE : c'est l'exception PmsAvailabilityError qui rend
    // l'échec non mémorisable. Si elle disparaissait, ce compteur tomberait à 1 et une panne
    // passagère deviendrait une panne d'une minute pour tous les visiteurs de l'instance.
    expect(getPmsFixtureCalls("/api/v2/available-rooms")).toBe(2);
  });

  it("un 429 de Lobby ressort en HTTP 429, avec Retry-After", async () => {
    const establishmentId = freshEstablishment();
    const productId = addProduct(establishmentId);
    const month = monthAhead(6);
    setPmsFixtureScenario({
      catalogCategoryIds: [CATEGORY],
      nightAvailabilityByDate: { [`${month}-01`]: { status: 429 } },
    });

    const response = await call(productId, month);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ ok: false, reason: "pms_rate_limited" });
  });
});

describe("une catégorie non cotée n'est jamais lue comme « complet »", () => {
  it("JAMAIS cotée sur le mois → 502 typé, jamais un calendrier vide et muet", async () => {
    const establishmentId = freshEstablishment();
    const productId = addProduct(establishmentId, { lobby_category_id: 999999 });
    const response = await call(productId, monthAhead(1));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false, reason: "pms_category_not_quoted" });
  });

  it("cotée SAUF une nuit → les autres nuits sont servies, l'inconnue est simplement absente", async () => {
    // Correctif de granularité du 2026-08-28 : refuser le mois entier pour une nuit lointaine non
    // cotée rendait inaccessibles trente nuits parfaitement connues. La nuit omise reste non
    // sélectionnable à l'écran, donc la sûreté est identique.
    const establishmentId = freshEstablishment();
    const productId = addProduct(establishmentId);
    const month = monthAhead(1);
    const trou = `${month}-15`;
    setPmsFixtureScenario({
      catalogCategoryIds: [CATEGORY],
      nightAvailabilityByDate: { [trou]: { availableByCategory: { [OTHER_CATEGORY]: 3 } } },
    });

    const response = await call(productId, month);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; nights: { date: string }[] };
    expect(body.ok).toBe(true);
    expect(body.nights.some((night) => night.date === trou)).toBe(false);
    expect(body.nights.length).toBeGreaterThan(25);
  });
});

describe("les paramètres sont validés avant toute lecture", () => {
  it("un mois inexistant est un 400, pas un 502 ni un faux succès", async () => {
    const productId = addProduct(freshEstablishment());
    // `2026-13` levait dans nightsOfMonth → 502 pms_unreachable + pile en console ;
    // `2026-00` rendait `{ok:true, nights:[]}`, un succès sur un mois qui n'existe pas.
    for (const month of ["2026-13", "2026-00", "2026-99"]) {
      const response = await call(productId, month);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ reason: "invalid_params" });
    }
    expect(getPmsFixtureCalls("/api/v2/available-rooms")).toBe(0);
  });

  it("un mois passé ou hors horizon est refusé sans toucher à Lobby", async () => {
    const productId = addProduct(freshEstablishment());
    for (const month of [monthAhead(-1), monthAhead(400)]) {
      const response = await call(productId, month);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ reason: "month_out_of_range" });
    }
    expect(getPmsFixtureCalls("/api/v2/available-rooms")).toBe(0);
  });

  it("un productId malformé est un 400, jamais une « panne » réessayable", async () => {
    const espion = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await call("pas-un-uuid%0Aligne-forgee", monthAhead(2));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, reason: "invalid_params" });
    expect(espion).not.toHaveBeenCalled();
    expect(getPmsFixtureCalls("/api/v2/available-rooms")).toBe(0);
    espion.mockRestore();
  });

  it("un produit non publié n'expose pas la disponibilité Lobby en direct", async () => {
    const productId = addProduct(freshEstablishment(), { sellable: false });
    const response = await call(productId, monthAhead(2));
    expect(response.status).toBe(404);
    expect(getPmsFixtureCalls("/api/v2/available-rooms")).toBe(0);
  });

  it("connecteur coupé : 200 avec un motif, jamais une panne", async () => {
    const establishmentId = freshEstablishment();
    establishments.set(establishmentId, {
      id: establishmentId,
      lobby_connector_active: false,
      lobby_api_token: null,
    });
    const productId = addProduct(establishmentId);
    const response = await call(productId, monthAhead(2));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: false, reason: "connector_inactive" });
    expect(getPmsFixtureCalls("/api/v2/available-rooms")).toBe(0);
  });
});

// Une lecture en panne n'est jamais une absence : ni « produit introuvable » (404), ni « connecteur
// coupé » (non réessayable, et son texte renvoie vers l'établissement). 503, motif réessayable.
describe("une panne de lecture n'est jamais une absence", () => {
  it.each([["products"], ["establishments"]])(
    "lecture de %s en panne → 503 réessayable, sans appel Lobby",
    async (table) => {
      const productId = addProduct(freshEstablishment());
      lecturesEnPanne.add(table);
      const response = await call(productId, monthAhead(2));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, reason: "availability_unavailable" });
      expect(getPmsFixtureCalls("/api/v2/available-rooms")).toBe(0);
    }
  );
});

