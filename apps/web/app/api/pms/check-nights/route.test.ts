// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPmsFixtureCalls, resetPmsFixtureCalls, setPmsFixtureScenario, startPmsFixtureServer } from "@hifago/e2e-support";

// Cette route ne crée AUCUN booking chez Lobby : elle lit, puis tient la place dans hifago. Seule la
// base est simulée (get_pms_check_payload, hold_pms_nights et release_order_after_pms_refusal sont
// prouvées par pgTAP et tests/concurrency). LobbyPMS est un VRAI serveur HTTP (packages/e2e-support).
const PORT = 34591;
const ORDER_ID = "11111111-1111-4111-8111-111111111111";

type RpcResult = { data: unknown; error: { message: string } | null };

let payloadResult: RpcResult;
let holdResult: RpcResult;
let releaseOk: boolean;
const rpcAppels: { nom: string; args: Record<string, unknown> }[] = [];

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    rpc: async (nom: string, args: Record<string, unknown>): Promise<RpcResult> => {
      rpcAppels.push({ nom, args });
      switch (nom) {
        case "get_pms_check_payload":
          return payloadResult;
        case "hold_pms_nights":
          return holdResult;
        case "release_order_after_pms_refusal":
          return releaseOk
            ? { data: { ok: true, released_lines: 1 }, error: null }
            : { data: null, error: { message: "verrou indisponible" } };
        default:
          return { data: null, error: { message: `rpc inattendue ${nom}` } };
      }
    },
  }),
}));

let close: () => Promise<void>;
let POST: (request: Request) => Promise<Response>;

const appeler = (orderId: unknown = ORDER_ID) =>
  POST(
    new Request("http://localhost/api/pms/check-nights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    })
  );

const payloadOk = (): RpcResult => ({
  data: {
    ok: true,
    groups: [
      {
        establishment_id: "etab",
        api_token: "fake",
        lines: [{ id: "l1", lobby_category_id: 36572, date: "2028-09-01", end_date: "2028-09-03", qty: 2 }],
      },
    ],
  },
  error: null,
});
const appelsNommes = (nom: string) => rpcAppels.filter((appel) => appel.nom === nom);

beforeAll(async () => {
  const server = await startPmsFixtureServer(PORT);
  process.env.LOBBY_API_BASE_URL = server.url;
  close = server.close;
  ({ POST } = await import("./route"));
});
afterAll(async () => {
  delete process.env.LOBBY_API_BASE_URL;
  await close();
});
beforeEach(() => {
  setPmsFixtureScenario({ catalogCategoryIds: [36572] });
  resetPmsFixtureCalls();
  payloadResult = payloadOk();
  holdResult = { data: { ok: true, held_lines: 1, checked_at: "2028-08-01T00:00:00Z" }, error: null };
  releaseOk = true;
  rpcAppels.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("entrée et lecture de la commande", () => {
  it("un orderId qui n'est pas un UUID → 400, rien n'est appelé", async () => {
    const response = await appeler("pas-un-uuid");
    expect(response.status).toBe(400);
    expect(rpcAppels).toEqual([]);
  });

  it("lecture de la commande en erreur → 503 db_error, jamais ok:true", async () => {
    payloadResult = { data: null, error: { message: "base indisponible" } };
    const response = await appeler();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: "db_error", released: false });
    expect(getPmsFixtureCalls()).toBe(0);
  });

  it.each([
    ["order_not_found", 404, false],
    ["order_paid", 409, false],
    ["order_not_active", 409, true],
  ])("motif %s → %s, released=%s, Lobby jamais lu", async (reason, status, released) => {
    payloadResult = { data: { ok: false, reason }, error: null };
    const response = await appeler();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, reason, released });
    expect(getPmsFixtureCalls()).toBe(0);
    expect(appelsNommes("hold_pms_nights")).toEqual([]);
  });

  it("connecteur coupé entre create_order et ici → la commande est défaite (échec fermé)", async () => {
    payloadResult = { data: { ok: false, reason: "pms_unavailable" }, error: null };
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, reason: "pms_unavailable", released: true });
    expect(appelsNommes("release_order_after_pms_refusal")).toHaveLength(1);
  });

  it("aucune nuit à vérifier (toutes déjà bookées) → ok sans lire Lobby ni tenir quoi que ce soit", async () => {
    payloadResult = { data: { ok: true, groups: [] }, error: null };
    const response = await appeler();
    expect(await response.json()).toEqual({ ok: true });
    expect(getPmsFixtureCalls()).toBe(0);
    expect(appelsNommes("hold_pms_nights")).toEqual([]);
  });
});

describe("lecture à chaud puis hold", () => {
  it("tout est libre : le hold reçoit l'instantané et l'heure de lecture ; AUCUNE écriture chez Lobby", async () => {
    setPmsFixtureScenario({
      nightAvailabilityByDate: {
        "2028-09-01": { availableByCategory: { 36572: 4 } },
        "2028-09-02": { availableByCategory: { 36572: 3 } },
      },
    });
    const response = await appeler();

    expect(await response.json()).toEqual({ ok: true });
    const hold = appelsNommes("hold_pms_nights");
    expect(hold).toHaveLength(1);
    expect(hold[0].args.p_order_id).toBe(ORDER_ID);
    expect(hold[0].args.p_snapshot).toEqual({ etab: { "36572": { "2028-09-01": 4, "2028-09-02": 3 } } });
    expect(Number.isNaN(Date.parse(hold[0].args.p_read_at as string))).toBe(false);
    expect(getPmsFixtureCalls("/api/v1/bookings")).toBe(0);
    expect(getPmsFixtureCalls("/api/v1/booking/add-product-service")).toBe(0);
    expect(appelsNommes("release_order_after_pms_refusal")).toEqual([]);
  });

  it("complet à cause des seules lignes en vol (dispo ≥ demande) → pms_contended, RIEN n'est relâché", async () => {
    holdResult = {
      data: { ok: false, reason: "full", line_id: "l1", night: "2028-09-02", available: 2, in_flight: 1, requested: 2 },
      error: null,
    };
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, reason: "pms_contended", released: false });
    expect(appelsNommes("release_order_after_pms_refusal")).toEqual([]);
  });

  it.each([
    ["dispo < demande, rien en vol", { available: 1, in_flight: 0, requested: 2 }],
    ["dispo < demande, même avec des lignes en vol", { available: 1, in_flight: 1, requested: 2 }],
    ["champs absents (échec fermé)", {}],
  ])("vrai « complet » (%s) → pms_refused, commande défaite", async (_cas, chiffres) => {
    holdResult = { data: { ok: false, reason: "full", line_id: "l1", night: "2028-09-02", ...chiffres }, error: null };
    const response = await appeler();
    expect(await response.json()).toEqual({ ok: false, reason: "pms_refused", released: true });
    expect(appelsNommes("release_order_after_pms_refusal")).toHaveLength(1);
  });

  it.each(["full", "not_quoted"])("hold refusé (%s) → pms_refused, commande défaite", async (reason) => {
    holdResult = { data: { ok: false, reason, line_id: "l1", night: "2028-09-02" }, error: null };
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, reason: "pms_refused", released: true });
    expect(appelsNommes("release_order_after_pms_refusal")).toHaveLength(1);
  });

  it("hold refusé et relâchement impossible → released:false (l'écran dit « estamos liberando »)", async () => {
    holdResult = { data: { ok: false, reason: "full" }, error: null };
    releaseOk = false;
    const response = await appeler();
    expect(await response.json()).toEqual({ ok: false, reason: "pms_refused", released: false });
  });

  it("connecteur coupé entre la lecture et le hold → pms_unavailable, commande défaite", async () => {
    holdResult = { data: { ok: false, reason: "pms_unavailable" }, error: null };
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, reason: "pms_unavailable", released: true });
    expect(appelsNommes("release_order_after_pms_refusal")).toHaveLength(1);
  });

  it("lecture périmée côté base → pms_unreachable, jamais présenté comme une indisponibilité", async () => {
    holdResult = { data: { ok: false, reason: "stale_read" }, error: null };
    const response = await appeler();
    expect(await response.json()).toEqual({ ok: false, reason: "pms_unreachable", released: true });
  });

  it("hold en erreur de base → 503 db_error, la commande n'est PAS défaite", async () => {
    holdResult = { data: null, error: { message: "boom" } };
    const response = await appeler();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: "db_error", released: false });
    expect(appelsNommes("release_order_after_pms_refusal")).toEqual([]);
  });

  it("Lobby injoignable (500) → pms_unreachable, commande défaite, hold jamais appelé", async () => {
    setPmsFixtureScenario({ nightAvailabilityByDate: { "2028-09-01": { status: 500 } } });
    const response = await appeler();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, reason: "pms_unreachable", released: true });
    expect(appelsNommes("hold_pms_nights")).toEqual([]);
    expect(appelsNommes("release_order_after_pms_refusal")).toHaveLength(1);
  });

  it("un hold ok n'est jamais confondu avec un hold sans motif connu", async () => {
    holdResult = { data: { ok: false, reason: "inconnu" }, error: null };
    const response = await appeler();
    expect(response.status).toBe(503);
    expect(appelsNommes("release_order_after_pms_refusal")).toEqual([]);
  });
});
