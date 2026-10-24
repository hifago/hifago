import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDaysIso } from "../time/bogotaDates";
import { checkOrderNights, nightsOfLine, type CheckGroup } from "./checkOrderNights";

// Faux Lobby : `available` donne les unités libres par (catégorie, nuit) ; une nuit absente de la
// table est « non cotée ». `mode` rejoue la panne.
let server: Server;
let baseUrl: string;
let calls: { start: string; end: string }[] = [];
let mode: "ok" | "down" | "rate_limited" = "ok";
let available: Record<string, Record<string, number>> = {};

function nightsBetween(start: string, endInclusive: string): string[] {
  const out: string[] = [];
  for (let night = start; night <= endInclusive; night = addDaysIso(night, 1)) out.push(night);
  return out;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const start = url.searchParams.get("start_date") ?? "";
    const end = url.searchParams.get("end_date") ?? "";
    calls.push({ start, end });
    if (mode === "down") return void res.writeHead(503).end('{"message":"down"}');
    if (mode === "rate_limited") return void res.writeHead(429, { "Retry-After": "30" }).end('{"message":"Too Many Attempts."}');
    const records = nightsBetween(start, end).map((night) => ({
      date: night,
      categories: Object.entries(available)
        .filter(([, byNight]) => night in byNight)
        .map(([category, byNight]) => ({ category_id: Number(category), available_rooms: byNight[night] })),
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: records }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  calls = [];
  mode = "ok";
  available = { "10": { "2028-09-01": 3, "2028-09-02": 1, "2028-09-03": 0 }, "11": { "2028-09-01": 5, "2028-09-02": 5 } };
});

const group = (lines: CheckGroup["lines"]): CheckGroup => ({ establishment_id: "e1", api_token: "tok", lines });

describe("nightsOfLine", () => {
  it("compte les nuits [date, départ) : la nuit du départ n'en est pas une", () => {
    expect(nightsOfLine("2028-09-01", "2028-09-03")).toEqual(["2028-09-01", "2028-09-02"]);
    expect(nightsOfLine("2028-09-01", "2028-09-01")).toEqual([]);
  });
});

describe("checkOrderNights", () => {
  it("lit Lobby à chaud et rend un instantané par établissement, catégorie et nuit", async () => {
    const before = Date.now();
    const result = await checkOrderNights(
      [group([{ id: "l1", lobby_category_id: 10, date: "2028-09-01", end_date: "2028-09-03", qty: 1 }])],
      { baseUrl }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot).toEqual({ e1: { "10": { "2028-09-01": 3, "2028-09-02": 1 } } });
    expect(Date.parse(result.readAt)).toBeGreaterThanOrEqual(before);
    expect(calls).toHaveLength(1);
  });

  it("un complet (0) reste 0 — jamais confondu avec une nuit non cotée, qui est absente", async () => {
    const result = await checkOrderNights(
      [group([{ id: "l1", lobby_category_id: 10, date: "2028-09-02", end_date: "2028-09-05", qty: 1 }])],
      { baseUrl }
    );
    if (!result.ok) throw new Error("lecture attendue");
    // 09-03 : cotée à 0 (complet) ; 09-04 : non cotée → absente.
    expect(result.snapshot.e1["10"]).toEqual({ "2028-09-02": 1, "2028-09-03": 0 });
  });

  it("deux lignes de catégories différentes : un seul appel pour l'établissement", async () => {
    const result = await checkOrderNights(
      [
        group([
          { id: "l1", lobby_category_id: 10, date: "2028-09-01", end_date: "2028-09-02", qty: 1 },
          { id: "l2", lobby_category_id: 11, date: "2028-09-01", end_date: "2028-09-03", qty: 1 },
        ]),
      ],
      { baseUrl }
    );
    if (!result.ok) throw new Error("lecture attendue");
    expect(Object.keys(result.snapshot.e1).sort()).toEqual(["10", "11"]);
    expect(calls).toHaveLength(1);
  });

  it("panne de Lobby : échec typé avec l'établissement, jamais un instantané partiel", async () => {
    mode = "down";
    const result = await checkOrderNights(
      [group([{ id: "l1", lobby_category_id: 10, date: "2028-09-01", end_date: "2028-09-02", qty: 1 }])],
      { baseUrl }
    );
    expect(result).toMatchObject({ ok: false, establishmentId: "e1", failure: { kind: "rejected", status: 503 } });
  });

  it("quota (429) : nommé comme tel", async () => {
    mode = "rate_limited";
    const result = await checkOrderNights(
      [group([{ id: "l1", lobby_category_id: 10, date: "2028-09-01", end_date: "2028-09-02", qty: 1 }])],
      { baseUrl }
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "rate_limited", retryAfterSeconds: 30 } });
  });

  it("au-delà de 31 nuits, plusieurs fenêtres — toutes lues", async () => {
    available = { "10": Object.fromEntries(nightsBetween("2028-09-01", "2028-11-15").map((n) => [n, 2])) };
    const result = await checkOrderNights(
      [group([{ id: "l1", lobby_category_id: 10, date: "2028-09-01", end_date: "2028-11-10", qty: 1 }])],
      { baseUrl }
    );
    if (!result.ok) throw new Error("lecture attendue");
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(result.snapshot.e1["10"])).toHaveLength(70);
  });

  it("aucune ligne : aucun appel", async () => {
    const result = await checkOrderNights([], { baseUrl });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
