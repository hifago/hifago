// @vitest-environment node
import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setPmsFixtureScenario, startPmsFixtureServer } from "@hifago/e2e-support";

// LE VERDICT DE CETTE ROUTE EST CE QUI DÉCIDE SI LE CLIENT EST DÉBITÉ. Elle est attendue AVANT
// confirmation et AVANT encaissement : chacune de ses branches vaut de l'argent — d'où ce fichier, et
// d'où le fait que les invariants y soient vérifiés par MUTATION (cf. journal), pas seulement par
// des tests verts.
//
// Seule la base est simulée (les RPC claim / record / release, prouvées pour de vrai par pgTAP et
// par tests/concurrency). LobbyPMS est un VRAI serveur HTTP (packages/e2e-support), parce que c'est
// là que vivent les cas qui comptent : un 422 sur `POST /bookings`, ou pas de réponse du tout.
const PORT = 34573;
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const LODGING_LINE = "22222222-2222-4222-8222-222222222222";
const ACTIVITY_LINE = "33333333-3333-4333-8333-333333333333";
const CLAIMED_AT = "2029-01-01T10:00:00.123456+00:00";
const FIXTURE_BOOKING_ID = "90000001"; // réponse par défaut de pmsFixtureServer

type RpcResult = { data: unknown; error: { message: string } | null };

let claimResult: RpcResult;
let recordResults: RpcResult[];
let releaseOk: boolean;
let recordThrows: boolean;
const reconciliations: Record<string, unknown>[] = [];
const rpcAppels: { nom: string; args: Record<string, unknown> }[] = [];

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      return {
        insert: async (row: Record<string, unknown>) => {
          if (table === "pms_reconciliation_entries") reconciliations.push(row);
          return { data: null, error: null };
        },
      };
    },
    rpc: async (nom: string, args: Record<string, unknown>): Promise<RpcResult> => {
      rpcAppels.push({ nom, args });
      switch (nom) {
        case "claim_order_for_pms_booking":
          return claimResult;
        case "record_pms_booking":
          if (recordThrows) throw new Error("connexion perdue");
          return recordResults.shift() ?? { data: { ok: true }, error: null };
        case "release_order_after_pms_refusal":
          return releaseOk
            ? { data: { ok: true, released_lines: 1 }, error: null }
            : { data: null, error: { message: "verrou indisponible" } };
        case "release_pms_reserve_claim":
          return { data: { ok: true, released: true }, error: null };
        default:
          return { data: null, error: { message: `rpc inattendue ${nom}` } };
      }
    },
  }),
}));

let close: () => Promise<void>;
let fixtureUrl: string;
let POST: (request: Request) => Promise<Response>;

const appeler = (orderId: unknown = ORDER_ID) =>
  POST(
    new Request("http://localhost/api/pms/reserve-nights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    })
  );

const ligneLogement = () => ({
  id: LODGING_LINE,
  product_id: "prod-lodging",
  date: "2028-09-01",
  end_date: "2028-09-03",
  qty: 2,
  holder_name: "Holder",
  holder_email: "h@test.local",
  holder_phone: null,
  total_cop: 200000,
  lobby_category_id: 36572,
});

const claimOk = (groups: unknown[]): RpcResult => ({
  data: { ok: true, claimed_at: CLAIMED_AT, attribution_code: null, attribution_source: null, groups },
  error: null,
});
const groupe = (overrides: Record<string, unknown> = {}) => ({
  establishment_id: "etab",
  api_token: "fake",
  lodging_lines: [ligneLogement()],
  activity_lines: [],
  ...overrides,
});
const appelsNommes = (nom: string) => rpcAppels.filter((appel) => appel.nom === nom);

beforeAll(async () => {
  const server = await startPmsFixtureServer(PORT);
  fixtureUrl = server.url;
  close = server.close;
  ({ POST } = await import("./route"));
});

afterAll(async () => {
  delete process.env.LOBBY_API_BASE_URL;
  await close();
});

beforeEach(() => {
  process.env.LOBBY_API_BASE_URL = fixtureUrl;
  delete process.env.LOBBY_RESERVE_TIMEOUT_MS;
  setPmsFixtureScenario({});
  claimResult = claimOk([groupe()]);
  recordResults = [];
  releaseOk = true;
  recordThrows = false;
  rpcAppels.length = 0;
  reconciliations.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("entrée et claim", () => {
  it("un orderId qui n'est pas un UUID → 400, rien n'est appelé", async () => {
    const response = await appeler("pas-un-uuid");
    expect(response.status).toBe(400);
    expect(rpcAppels).toEqual([]);
  });

  it("claim en erreur → 503 db_error, released:false — jamais ok:true sur une panne", async () => {
    claimResult = { data: null, error: { message: "base indisponible" } };
    const response = await appeler();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: "db_error", released: false });
    expect(rpcAppels.map((appel) => appel.nom)).toEqual(["claim_order_for_pms_booking"]);
  });

  it("commande payée → 409 order_paid, Lobby jamais appelé, rien de relâché", async () => {
    claimResult = { data: { ok: false, reason: "order_paid" }, error: null };
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, reason: "order_paid", released: false });
    expect(appelsNommes("record_pms_booking")).toEqual([]);
    expect(appelsNommes("release_order_after_pms_refusal")).toEqual([]);
  });

  it("claim déjà tenu par un autre appel → 409 pms_claim_in_progress, rien de relâché", async () => {
    claimResult = { data: { ok: false, reason: "claim_in_progress" }, error: null };
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, reason: "pms_claim_in_progress", released: false });
    expect(appelsNommes("release_order_after_pms_refusal")).toEqual([]);
  });

  it("connecteur coupé depuis create_order → commande relâchée, 409 pms_unavailable", async () => {
    claimResult = { data: { ok: false, reason: "pms_unavailable" }, error: null };
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, reason: "pms_unavailable", released: true });
    expect(appelsNommes("release_order_after_pms_refusal")).toHaveLength(1);
  });

  it("une commande SANS ligne à réserver chez Lobby → 200, aucun claim à rendre", async () => {
    claimResult = { data: { ok: true, claimed_at: null, groups: [] }, error: null };
    const response = await appeler();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(rpcAppels.map((appel) => appel.nom)).toEqual(["claim_order_for_pms_booking"]);
  });
});

describe("Lobby accepte", () => {
  it("enregistre le booking SOUS le claim, répond ok:true, ne relâche rien et rend le claim", async () => {
    const response = await appeler();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(appelsNommes("record_pms_booking")).toEqual([
      {
        nom: "record_pms_booking",
        args: {
          p_order_id: ORDER_ID,
          p_claimed_at: CLAIMED_AT,
          p_order_line_id: LODGING_LINE,
          p_pms_booking_id: FIXTURE_BOOKING_ID,
        },
      },
    ]);
    expect(appelsNommes("release_order_after_pms_refusal")).toEqual([]);
    expect(appelsNommes("release_pms_reserve_claim")).toEqual([
      { nom: "release_pms_reserve_claim", args: { p_order_id: ORDER_ID, p_claimed_at: CLAIMED_AT } },
    ]);
    expect(reconciliations).toEqual([]);
  });

  it("le claim est rendu même quand l'enregistrement lève une exception (finally)", async () => {
    recordThrows = true;
    await expect(appeler()).rejects.toThrow("connexion perdue");
    expect(appelsNommes("release_pms_reserve_claim")).toHaveLength(1);
  });
});

describe("Lobby refuse une NUIT — le cas du 422", () => {
  beforeEach(() => {
    setPmsFixtureScenario({ createBookingStatus: 422, createBookingBody: { error_code: "INPUT_PARAMETERS" } });
  });

  it("relâche la commande et répond 409 pms_refused — donc rien n'est encaissé", async () => {
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, reason: "pms_refused", released: true });
    expect(appelsNommes("release_order_after_pms_refusal")).toHaveLength(1);
    expect(appelsNommes("release_order_after_pms_refusal")[0].args.p_order_id).toBe(ORDER_ID);
    expect(appelsNommes("record_pms_booking")).toEqual([]);
  });

  it("n'écrit AUCUNE entrée de réconciliation : l'incident est défait, pas à traiter", async () => {
    // pms_reconciliation_entries déclenche notify_all_admins SANS dédup : une entrée par refus
    // enverrait un e-mail « à traiter » pour quelque chose que personne ne peut ni ne doit traiter.
    await appeler();
    expect(reconciliations).toEqual([]);
  });

  it("⚠️ si le relâchement ÉCHOUE, l'entrée de réconciliation redevient la bonne réponse", async () => {
    releaseOk = false;
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, reason: "pms_refused", released: false });
    expect(reconciliations).toHaveLength(1);
    expect(reconciliations[0]).toMatchObject({ order_line_id: LODGING_LINE });
    expect(String(reconciliations[0].detail)).toContain("relâchement impossible");
  });
});

describe("issue INCONNUE chez Lobby — jamais traitée comme un simple refus", () => {
  let silencieux: Server;
  let silencieuxUrl: string;

  beforeAll(async () => {
    // Accepte la connexion et ne répond jamais : un Lobby qui a peut-être créé le booking.
    silencieux = createServer(() => {});
    await new Promise<void>((resolve) => silencieux.listen(0, "127.0.0.1", resolve));
    const address = silencieux.address();
    silencieuxUrl = address && typeof address === "object" ? `http://127.0.0.1:${address.port}` : "";
  });

  afterAll(async () => {
    silencieux.closeAllConnections();
    await new Promise<void>((resolve) => silencieux.close(() => resolve()));
  });

  it("timeout sur POST /bookings → relâche, 409 pms_unreachable, ET une entrée de réconciliation avec la clé de la note", async () => {
    process.env.LOBBY_API_BASE_URL = silencieuxUrl;
    process.env.LOBBY_RESERVE_TIMEOUT_MS = "100";
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, reason: "pms_unreachable", released: true });
    expect(appelsNommes("release_order_after_pms_refusal")).toHaveLength(1);
    // Écrite MÊME relâchée : le booking a pu être créé, seul un humain peut vérifier dans Lobby.
    expect(reconciliations).toHaveLength(1);
    expect(reconciliations[0]).toMatchObject({ order_line_id: LODGING_LINE });
    expect(String(reconciliations[0].detail)).toContain(`hifago order_line ${LODGING_LINE}`);
    expect(String(reconciliations[0].detail)).toContain("TimeoutError");
    expect(appelsNommes("release_pms_reserve_claim")).toHaveLength(1);
  });

  it("booking créé mais enregistrement impossible (deux fois) → l'entrée porte le numéro du booking", async () => {
    recordResults = [
      { data: null, error: { message: "base indisponible" } },
      { data: null, error: { message: "base indisponible" } },
    ];
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, reason: "pms_unreachable", released: true });
    expect(appelsNommes("record_pms_booking")).toHaveLength(2);
    expect(reconciliations).toHaveLength(1);
    expect(String(reconciliations[0].detail)).toContain(`booking ${FIXTURE_BOOKING_ID}`);
  });

  it("une seule panne de l'enregistrement est rattrapée par la nouvelle tentative", async () => {
    recordResults = [{ data: null, error: { message: "coupure brève" } }, { data: { ok: true }, error: null }];
    const response = await appeler();
    expect(response.status).toBe(200);
    expect(appelsNommes("record_pms_booking")).toHaveLength(2);
    expect(reconciliations).toEqual([]);
  });

  it("claim perdu au moment d'enregistrer → 409 pms_claim_in_progress, la commande n'est PAS défaite", async () => {
    recordResults = [{ data: { ok: false, reason: "claim_stale" }, error: null }];
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, reason: "pms_claim_in_progress", released: false });
    expect(appelsNommes("release_order_after_pms_refusal")).toEqual([]);
  });
});

describe("une ACTIVITÉ refusée ne relâche jamais la commande", () => {
  it("la nuit est réservée chez le partenaire : on garde la commande et on réconcilie l'extra", async () => {
    // ⚠️ L'asymétrie est délibérée. Annuler une nuit bien réservée parce qu'un extra a échoué
    // serait pire que le défaut qu'on corrige : le client perdrait son logement pour une activité.
    claimResult = claimOk([
      groupe({ activity_lines: [{ id: ACTIVITY_LINE, product_id: "prod-activity", qty: 3, lobby_product_id: 494426 }] }),
    ]);
    setPmsFixtureScenario({ addProductServiceStatus: 422, addProductServiceBody: { error_code: "INPUT_PARAMETERS" } });

    const response = await appeler();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    // Seule la nuit est enregistrée ; l'activité refusée part en réconciliation, comme avant.
    expect(appelsNommes("record_pms_booking").map((appel) => appel.args.p_order_line_id)).toEqual([LODGING_LINE]);
    expect(reconciliations).toHaveLength(1);
    expect(reconciliations[0]).toMatchObject({ order_line_id: ACTIVITY_LINE });
  });

  it("une activité acceptée est enregistrée sur le booking principal de sa nuit", async () => {
    claimResult = claimOk([
      groupe({ activity_lines: [{ id: ACTIVITY_LINE, product_id: "prod-activity", qty: 3, lobby_product_id: 494426 }] }),
    ]);
    const response = await appeler();
    expect(response.status).toBe(200);
    expect(appelsNommes("record_pms_booking").map((appel) => [appel.args.p_order_line_id, appel.args.p_pms_booking_id])).toEqual([
      [LODGING_LINE, FIXTURE_BOOKING_ID],
      [ACTIVITY_LINE, FIXTURE_BOOKING_ID],
    ]);
  });
});

// ── Cas ajoutés par la revue adversariale de P4a ────────────────────────────────────────────────
// Un petit Lobby SCRIPTÉ : une réponse par appel (statut, corps, délai), et le journal des appels.
// Le serveur partagé de packages/e2e-support renvoie toujours le même booking, sans délai.
type Scripted = { status: number; body: unknown; delayMs?: number };
let scripted: Server;
let scriptedUrl: string;
let script: Scripted[] = [];
const scriptedCalls: string[] = [];

const ligneNuit = (id: string, date: string) => ({ ...ligneLogement(), id, date, end_date: `${date.slice(0, 8)}${String(Number(date.slice(8)) + 1).padStart(2, "0")}` });
const NUIT_2 = "44444444-4444-4444-8444-444444444444";

describe("revue adversariale — motifs du claim, classement des réponses, ordre et budget", () => {
  beforeAll(async () => {
    scripted = createServer((req, res) => {
      scriptedCalls.push(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
      const reponse = script.shift() ?? { status: 200, body: { booking: { booking_id: 1, room_id: 1 } } };
      req.resume();
      req.on("end", () => {
        setTimeout(() => {
          res.writeHead(reponse.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(reponse.body));
        }, reponse.delayMs ?? 0);
      });
    });
    await new Promise<void>((resolve) => scripted.listen(0, "127.0.0.1", resolve));
    const address = scripted.address();
    scriptedUrl = address && typeof address === "object" ? `http://127.0.0.1:${address.port}` : "";
  });

  afterAll(async () => {
    scripted.closeAllConnections();
    await new Promise<void>((resolve) => scripted.close(() => resolve()));
  });

  beforeEach(() => {
    process.env.LOBBY_API_BASE_URL = scriptedUrl;
    delete process.env.LOBBY_RESERVE_BUDGET_MS;
    script = [];
    scriptedCalls.length = 0;
  });

  afterEach(() => {
    delete process.env.LOBBY_RESERVE_BUDGET_MS;
  });

  it("commande inconnue → 404 order_not_found, released:false", async () => {
    claimResult = { data: { ok: false, reason: "order_not_found" }, error: null };
    const response = await appeler();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, reason: "order_not_found", released: false });
  });

  it("commande déjà défaite (plus aucune ligne vivante) → 409 order_not_active, jamais un 200", async () => {
    claimResult = { data: { ok: false, reason: "order_not_active" }, error: null };
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, reason: "order_not_active", released: true });
  });

  it("connecteur coupé ET relâchement impossible → released:false (jamais un « libéré » mensonger)", async () => {
    claimResult = { data: { ok: false, reason: "pms_unavailable" }, error: null };
    releaseOk = false;
    const response = await appeler();
    expect(await response.json()).toEqual({ ok: false, reason: "pms_unavailable", released: false });
  });

  it("5xx de Lobby → issue INCONNUE : entrée de réconciliation, pms_unreachable, jamais « no disponible »", async () => {
    script = [{ status: 502, body: { message: "Bad Gateway" } }];
    const response = await appeler();
    expect(await response.json()).toMatchObject({ ok: false, reason: "pms_unreachable", released: true });
    expect(reconciliations).toHaveLength(1);
    expect(String(reconciliations[0].detail)).toContain(`hifago order_line ${LODGING_LINE}`);
  });

  it("2xx sans booking_id exploitable → issue INCONNUE, entrée de réconciliation", async () => {
    script = [{ status: 200, body: { ok: true } }];
    const response = await appeler();
    expect(await response.json()).toMatchObject({ reason: "pms_unreachable", released: true });
    expect(reconciliations).toHaveLength(1);
  });

  it("302 (jamais suivi : une écriture n'est pas redirigée) → issue INCONNUE, entrée de réconciliation", async () => {
    script = [{ status: 302, body: {} }];
    const response = await appeler();
    expect(await response.json()).toMatchObject({ reason: "pms_unreachable", released: true });
    expect(reconciliations).toHaveLength(1);
  });

  it.each([403, 404, 429])("%i (relais, quota, route) → panne SANS booking : pms_unreachable, aucune entrée", async (status) => {
    script = [{ status, body: { message: "refusé avant Lobby" } }];
    const response = await appeler();
    expect(await response.json()).toMatchObject({ ok: false, reason: "pms_unreachable", released: true });
    expect(reconciliations).toEqual([]);
  });

  it("connexion refusée (requête jamais partie) → pms_unreachable, aucune entrée « peut-être créé »", async () => {
    const ferme = createServer();
    await new Promise<void>((resolve) => ferme.listen(0, "127.0.0.1", resolve));
    const address = ferme.address();
    const port = address && typeof address === "object" ? address.port : 0;
    await new Promise<void>((resolve) => ferme.close(() => resolve()));
    process.env.LOBBY_API_BASE_URL = `http://127.0.0.1:${port}`;
    const response = await appeler();
    expect(await response.json()).toMatchObject({ ok: false, reason: "pms_unreachable", released: true });
    expect(reconciliations).toEqual([]);
  });

  it("une issue inconnue est écrite AVANT le relâchement (une coupure ensuite ne l'efface pas)", async () => {
    script = [{ status: 500, body: { message: "erreur" } }];
    const ordre: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((message: unknown) => {
      if (typeof message === "string" && message.includes("échec PMS")) ordre.push("réconciliation");
      if (typeof message === "string" && message.includes("relâchement")) ordre.push("relâchement");
    });
    await appeler();
    spy.mockRestore();
    expect(ordre[0]).toBe("réconciliation");
  });

  it("deux nuits, la première refusée → la seconde n'est JAMAIS demandée à Lobby", async () => {
    claimResult = claimOk([groupe({ lodging_lines: [ligneNuit(LODGING_LINE, "2028-09-01"), ligneNuit(NUIT_2, "2028-09-05")] })]);
    script = [{ status: 422, body: { error_code: "INPUT_PARAMETERS" } }];
    const response = await appeler();
    expect(await response.json()).toMatchObject({ reason: "pms_refused", released: true });
    expect(scriptedCalls.filter((path) => path === "/api/v1/bookings")).toHaveLength(1);
  });

  it("budget épuisé → la nuit suivante n'est pas envoyée, commande défaite, aucune entrée", async () => {
    process.env.LOBBY_RESERVE_TIMEOUT_MS = "100";
    process.env.LOBBY_RESERVE_BUDGET_MS = "150";
    claimResult = claimOk([groupe({ lodging_lines: [ligneNuit(LODGING_LINE, "2028-09-01"), ligneNuit(NUIT_2, "2028-09-05")] })]);
    script = [{ status: 200, body: { booking: { booking_id: 7001, room_id: 1 } }, delayMs: 70 }];
    const response = await appeler();
    expect(await response.json()).toMatchObject({ reason: "pms_unreachable", released: true });
    expect(scriptedCalls.filter((path) => path === "/api/v1/bookings")).toHaveLength(1);
    expect(reconciliations).toEqual([]);
  });

  it("deux nuits réservées → l'activité est rattachée au PREMIER booking de l'établissement", async () => {
    claimResult = claimOk([
      groupe({
        lodging_lines: [ligneNuit(LODGING_LINE, "2028-09-01"), ligneNuit(NUIT_2, "2028-09-05")],
        activity_lines: [{ id: ACTIVITY_LINE, product_id: "prod-activity", qty: 1, lobby_product_id: 494426 }],
      }),
    ]);
    script = [
      { status: 200, body: { booking: { booking_id: 7001, room_id: 1 } } },
      { status: 200, body: { booking: { booking_id: 7002, room_id: 1 } } },
      { status: 200, body: { sale: { id: 1, total: 0 } } },
    ];
    const response = await appeler();
    expect(response.status).toBe(200);
    expect(appelsNommes("record_pms_booking").map((appel) => [appel.args.p_order_line_id, appel.args.p_pms_booking_id])).toEqual([
      [LODGING_LINE, "7001"],
      [NUIT_2, "7002"],
      [ACTIVITY_LINE, "7001"],
    ]);
  });

  it("already_booked : la nuit est déjà réservée par un autre booking → ni relâchement ni échec", async () => {
    script = [{ status: 200, body: { booking: { booking_id: 7001, room_id: 1 } } }];
    recordResults = [{ data: { ok: false, reason: "already_booked" }, error: null }];
    const response = await appeler();
    expect(response.status).toBe(200);
    expect(appelsNommes("release_order_after_pms_refusal")).toEqual([]);
  });

  it("line_not_reserved : la ligne est morte entre-temps → commande défaite, pms_refused, aucune entrée", async () => {
    script = [{ status: 200, body: { booking: { booking_id: 7001, room_id: 1 } } }];
    recordResults = [{ data: { ok: false, reason: "line_not_reserved" }, error: null }];
    const response = await appeler();
    expect(await response.json()).toMatchObject({ reason: "pms_refused", released: true });
    expect(reconciliations).toEqual([]);
  });

  it("activité sans réponse → la commande reste confirmée, l'extra part en réconciliation", async () => {
    process.env.LOBBY_RESERVE_TIMEOUT_MS = "100";
    claimResult = claimOk([
      groupe({ activity_lines: [{ id: ACTIVITY_LINE, product_id: "prod-activity", qty: 1, lobby_product_id: 494426 }] }),
    ]);
    script = [
      { status: 200, body: { booking: { booking_id: 7001, room_id: 1 } } },
      { status: 200, body: { sale: { id: 1, total: 0 } }, delayMs: 500 },
    ];
    const response = await appeler();
    expect(response.status).toBe(200);
    expect(reconciliations).toHaveLength(1);
    expect(reconciliations[0]).toMatchObject({ order_line_id: ACTIVITY_LINE });
    expect(String(reconciliations[0].detail)).toContain("PEUT-ÊTRE ajouté");
  });
});
