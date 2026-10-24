import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bookClaimedOrder, type BookContext, type BookStore, type ClaimedOrder, type RecordOutcome } from "./bookClaimedOrder";

// Faux Lobby « impoli » : chaque scénario programme la réponse de POST /bookings par catégorie.
type Behaviour = (call: number, body: Record<string, unknown>) => { status: number; body?: unknown; hang?: boolean; drop?: boolean };
let server: Server;
let baseUrl: string;
let behaviours = new Map<number, Behaviour>();
let bookingCalls: Record<string, unknown>[] = [];
let serviceCalls: Record<string, unknown>[] = [];
let nextBookingId = 1000;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === "/api/v1/bookings") {
        bookingCalls.push(body);
        const behaviour = behaviours.get(body.category_id as number);
        const answer = behaviour
          ? behaviour(bookingCalls.filter((c) => c.category_id === body.category_id).length, body)
          : { status: 200, body: { booking: { booking_id: nextBookingId++, room_id: 1 } } };
        if (answer.drop) return void req.socket.destroy();
        if (answer.hang) return;
        res.writeHead(answer.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(answer.body ?? {}));
        return;
      }
      if (req.url === "/api/v1/booking/add-product-service") {
        serviceCalls.push(body);
        const refuse = body.booking_id === 4242;
        res.writeHead(refuse ? 422 : 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(refuse ? { error_code: "INPUT_PARAMETERS" } : { sale: { id: 1 } }));
        return;
      }
      res.writeHead(404).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

let recorded: { lineId: string; bookingId: string }[] = [];
let reconciliations: { lineId: string; detail: string }[] = [];
let recordOutcome: (lineId: string) => RecordOutcome = () => "ok";

const store: BookStore = {
  async recordBooking(lineId, bookingId) {
    recorded.push({ lineId, bookingId });
    return recordOutcome(lineId);
  },
  async recordReconciliation(lineId, detail) {
    reconciliations.push({ lineId, detail });
  },
};

let callTimeout: () => number | null;
const ctx = (): BookContext => ({
  baseUrl,
  nextCallTimeout: () => callTimeout(),
  redact: (text) => text.replace(/SECRET/g, "***"),
});

beforeEach(() => {
  behaviours = new Map();
  bookingCalls = [];
  serviceCalls = [];
  recorded = [];
  reconciliations = [];
  recordOutcome = () => "ok";
  callTimeout = () => 2_000;
  nextBookingId = 1000;
});

function lodging(id: string, category: number, over: Partial<ClaimedOrder["groups"][0]["lodging_lines"][0]> = {}) {
  return {
    id,
    product_id: `p-${id}`,
    date: "2028-09-01",
    end_date: "2028-09-03",
    qty: 2,
    holder_name: "Ana Prueba",
    holder_email: "ana@example.com",
    holder_phone: "+573001112233",
    total_cop: 500_000,
    acompte_cop: 100_000,
    lobby_category_id: category,
    ...over,
  };
}

const orderOf = (...lines: ReturnType<typeof lodging>[]): ClaimedOrder => ({
  attribution_code: null,
  attribution_source: null,
  groups: [{ establishment_id: "e1", api_token: "tok", lodging_lines: lines, activity_lines: [] }],
});

describe("bookClaimedOrder", () => {
  it("réserve chaque nuit avec `payment` = l'acompte encaissé et la note « Anticipo pagado »", async () => {
    const result = await bookClaimedOrder(orderOf(lodging("l1", 10)), store, ctx());

    expect(result).toEqual({ kind: "booked", warnings: [] });
    expect(bookingCalls).toHaveLength(1);
    expect(bookingCalls[0].payment).toBe(100_000);
    expect(bookingCalls[0].note).toContain("Anticipo pagado en hifago: $100.000 — saldo: $400.000");
    expect(recorded).toEqual([{ lineId: "l1", bookingId: "1000" }]);
  });

  it("n'envoie pas `payment` quand aucun acompte n'a été encaissé, et jamais plus que le total", async () => {
    await bookClaimedOrder(orderOf(lodging("l1", 10, { acompte_cop: 0 })), store, ctx());
    expect("payment" in bookingCalls[0]).toBe(false);

    bookingCalls = [];
    await bookClaimedOrder(orderOf(lodging("l2", 10, { acompte_cop: 900_000 })), store, ctx());
    expect(bookingCalls[0].payment).toBe(500_000);
  });

  it("refus 422 avec payment : UN seul nouvel essai sans payment ; s'il passe, remise à saisir à la main", async () => {
    behaviours.set(10, (call) =>
      call === 1
        ? { status: 422, body: { error_code: "INPUT_PARAMETERS" } }
        : { status: 200, body: { booking: { booking_id: 777, room_id: 1 } } }
    );
    const result = await bookClaimedOrder(orderOf(lodging("l1", 10)), store, ctx());

    expect(result.kind).toBe("booked");
    expect(bookingCalls).toHaveLength(2);
    expect(bookingCalls[0].payment).toBe(100_000);
    expect("payment" in bookingCalls[1]).toBe(false);
    expect(recorded).toEqual([{ lineId: "l1", bookingId: "777" }]);
    expect(reconciliations).toHaveLength(1);
    expect(reconciliations[0].detail).toContain("remise à saisir à la main");
    expect(reconciliations[0].detail).toContain("100000");
  });

  it("refus 422 aux DEUX essais : `refused`, deux appels exactement, rien d'enregistré", async () => {
    behaviours.set(10, () => ({ status: 422, body: { error_code: "INPUT_PARAMETERS" } }));
    const result = await bookClaimedOrder(orderOf(lodging("l1", 10)), store, ctx());

    expect(result).toMatchObject({ kind: "refused", lineId: "l1" });
    expect(bookingCalls).toHaveLength(2);
    expect(recorded).toEqual([]);
  });

  it("refus 422 sans payment à envoyer : un seul appel (pas de second essai inutile)", async () => {
    behaviours.set(10, () => ({ status: 422, body: {} }));
    const result = await bookClaimedOrder(orderOf(lodging("l1", 10, { acompte_cop: 0 })), store, ctx());
    expect(result.kind).toBe("refused");
    expect(bookingCalls).toHaveLength(1);
  });

  it("issue inconnue (connexion coupée) : `unknown`, JAMAIS de second essai", async () => {
    behaviours.set(10, () => ({ status: 200, drop: true }));
    const result = await bookClaimedOrder(orderOf(lodging("l1", 10)), store, ctx());

    expect(result).toMatchObject({ kind: "unknown", lineId: "l1" });
    expect((result as { detail: string }).detail).toContain("hifago order_line l1");
    expect(bookingCalls).toHaveLength(1);
    // L'entrée est écrite TOUT DE SUITE, avant que l'appelant ne résolve la demande.
    expect(reconciliations).toHaveLength(1);
    expect(reconciliations[0].detail).toContain("commande PAYÉE — issue inconnue");
    expect(reconciliations[0].detail).toContain("hifago order_line l1");
  });

  it("5xx : issue inconnue, jamais retentée ; 2xx sans booking_id : idem", async () => {
    behaviours.set(10, () => ({ status: 502, body: { error: "bad gateway" } }));
    behaviours.set(11, () => ({ status: 200, body: { ok: true } }));
    expect((await bookClaimedOrder(orderOf(lodging("a", 10)), store, ctx())).kind).toBe("unknown");
    expect((await bookClaimedOrder(orderOf(lodging("b", 11)), store, ctx())).kind).toBe("unknown");
    expect(bookingCalls).toHaveLength(2);
  });

  it("autre 4xx (relais, quota, jeton) : panne, on réessaiera — jamais un refus métier", async () => {
    behaviours.set(10, () => ({ status: 429, body: { message: "Too Many Attempts." } }));
    const result = await bookClaimedOrder(orderOf(lodging("l1", 10)), store, ctx());
    expect(result.kind).toBe("outage");
    expect(bookingCalls).toHaveLength(1);
  });

  it("budget épuisé : `not_attempted`, aucun appel parti", async () => {
    callTimeout = () => null;
    const result = await bookClaimedOrder(orderOf(lodging("l1", 10)), store, ctx());
    expect(result).toMatchObject({ kind: "not_attempted", lineId: "l1" });
    expect(bookingCalls).toHaveLength(0);
  });

  it("D8 : les bookings obtenus sont gardés quand une nuit suivante est refusée", async () => {
    behaviours.set(11, () => ({ status: 422, body: {} }));
    const result = await bookClaimedOrder(orderOf(lodging("l1", 10), lodging("l2", 11)), store, ctx());

    expect(result).toMatchObject({ kind: "refused", lineId: "l2" });
    expect(recorded).toEqual([{ lineId: "l1", bookingId: "1000" }]);
  });

  it("booking créé mais non enregistré : `unrecorded` (un humain doit l'annuler)", async () => {
    recordOutcome = () => "not_recorded";
    const result = await bookClaimedOrder(orderOf(lodging("l1", 10)), store, ctx());
    expect(result).toMatchObject({ kind: "unrecorded", lineId: "l1" });
    expect(reconciliations[0].detail).toContain("NON enregistré");
  });

  it("bail repris par un autre appel : `claim_lost`, on s'arrête sans conclure", async () => {
    recordOutcome = () => "claim_stale";
    const result = await bookClaimedOrder(orderOf(lodging("l1", 10), lodging("l2", 11)), store, ctx());
    expect(result.kind).toBe("claim_lost");
    expect(bookingCalls).toHaveLength(1);
  });

  it("ligne annulée entre-temps : avertissement, les autres lignes se réservent", async () => {
    recordOutcome = (lineId) => (lineId === "l1" ? "line_not_reserved" : "ok");
    const result = await bookClaimedOrder(orderOf(lodging("l1", 10), lodging("l2", 11)), store, ctx());
    expect(result.kind).toBe("booked");
    expect(bookingCalls).toHaveLength(2);
    expect((result as { warnings: string[] }).warnings[0]).toContain("mis en annulation");
  });

  it("ligne inexploitable (pas de catégorie Lobby) : refus sans appel", async () => {
    const result = await bookClaimedOrder(orderOf(lodging("l1", 10, { lobby_category_id: null })), store, ctx());
    expect(result.kind).toBe("refused");
    expect(bookingCalls).toHaveLength(0);
  });

  it("activités rattachées au booking de la nuit ; une activité refusée ne bloque pas la confirmation", async () => {
    const order: ClaimedOrder = {
      groups: [
        {
          establishment_id: "e1",
          api_token: "tok",
          lodging_lines: [lodging("n1", 10)],
          activity_lines: [{ id: "a1", product_id: "pa", qty: 2, lobby_product_id: 55 }],
        },
      ],
    };
    const ok = await bookClaimedOrder(order, store, ctx());
    expect(ok.kind).toBe("booked");
    expect(serviceCalls[0]).toMatchObject({ booking_id: 1000, items: [{ product_id: 55, cant: 2 }] });
    expect(recorded).toEqual([
      { lineId: "n1", bookingId: "1000" },
      { lineId: "a1", bookingId: "1000" },
    ]);

    // Passage de reprise : la nuit était déjà bookée, le groupe porte son booking principal (4242,
    // que le faux Lobby refuse pour add-product-service).
    recorded = [];
    const retry: ClaimedOrder = {
      groups: [
        {
          establishment_id: "e1",
          api_token: "tok",
          primary_booking_id: "4242",
          lodging_lines: [],
          activity_lines: [{ id: "a2", product_id: "pa", qty: 1, lobby_product_id: 55 }],
        },
      ],
    };
    const refused = await bookClaimedOrder(retry, store, ctx());
    expect(refused.kind).toBe("booked");
    expect(reconciliations.at(-1)).toMatchObject({ lineId: "a2" });
    expect(reconciliations.at(-1)?.detail).toContain("add-product-service refusé");
  });

  it("activité sans nuit pour son établissement : avertissement, aucun appel, aucune entrée", async () => {
    const order: ClaimedOrder = {
      groups: [
        {
          establishment_id: "e1",
          api_token: "tok",
          lodging_lines: [],
          activity_lines: [{ id: "a1", product_id: "pa", qty: 1, lobby_product_id: 55 }],
        },
      ],
    };
    const result = await bookClaimedOrder(order, store, ctx());
    expect(result.kind).toBe("booked");
    expect(serviceCalls).toHaveLength(0);
    expect(reconciliations).toEqual([]);
  });
});
