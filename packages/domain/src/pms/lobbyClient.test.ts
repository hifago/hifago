import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addLobbyProductService,
  cancelLobbyBooking,
  createLobbyBooking,
  getLobbyAvailableRooms,
  getLobbyBookingDetail,
  getLobbyNightAvailability,
  getLobbyRooms,
} from "./lobbyClient";
import { getNightAvailabilityRange } from "./getNightAvailabilityWindow";

// Petit serveur de fixtures node:http, répond aux formes RÉELLES documentées
// (docs/3-integrations/lobby_pms_api.md, racine du dépôt), pas la forme officielle jamais
// observée en prod — c'est exactement ce que lobbyClient.ts doit savoir parser.
let server: Server;
let baseUrl: string;
let lastRequestHeaders: import("node:http").IncomingHttpHeaders = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    lastRequestHeaders = req.headers;
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : {};

      if (req.method === "GET" && url.pathname === "/api/v1/rooms") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ category_id: 9631, name: "VIDPOVO" }], meta: { total_records: 1 } }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/v1/bookings/20653992") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: { id_reserva: 20653992, estatus: "completo" } }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/v1/bookings/404404") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "No query results for model [App\\Models\\Booking]." }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/v1/bookings") {
        if (parsed.category_id === 99999) {
          res.writeHead(422, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error_code: "INPUT_PARAMETERS", error: "The selected category id is invalid." }));
          return;
        }
        // Catégorie « redirigée » : une écriture ne doit jamais suivre un 3xx.
        if (parsed.category_id === 66666) {
          res.writeHead(302, { Location: "/api/v1/rooms" });
          res.end();
          return;
        }
        // Catégorie « en-têtes vite, corps lent » : le timeout doit couvrir AUSSI la lecture du corps.
        if (parsed.category_id === 77777) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.write('{"booking":');
          setTimeout(() => res.end('{"booking_id":20863346,"room_id":488678}}'), 300);
          return;
        }
        // Catégorie « lente » : la réponse arrive après 300 ms (cas du timeout, ci-dessous).
        if (parsed.category_id === 88888) {
          setTimeout(() => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ booking: { booking_id: 20863345, room_id: 488678 } }));
          }, 300);
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ booking: { booking_id: 20863344, room_id: 488678 } }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/v1/booking/add-product-service") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sale: { id: 2321155, total: 135000 } }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/v1/cancel-booking/3324119") {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ cancel_booking: 3324119 }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/v1/cancel-booking/20873561") {
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error_code: "RESTRICTED_RESERVATION" }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "not found in fixture server" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address && typeof address === "object") {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("lobbyClient (vrai fetch contre un serveur de fixtures local)", () => {
  it("getLobbyRooms parse la liste de catégories", async () => {
    const result = await getLobbyRooms(baseUrl, "fake-token");
    expect(result.status).toBe(200);
    expect((result.body as { data: unknown[] }).data).toHaveLength(1);
  });

  it("getLobbyBookingDetail : 200 sur un booking existant", async () => {
    const result = await getLobbyBookingDetail(baseUrl, "fake-token", 20653992);
    expect(result.status).toBe(200);
    expect((result.body as { data: { id_reserva: number } }).data.id_reserva).toBe(20653992);
  });

  it("getLobbyBookingDetail : 404 sur un booking annulé — jamais une exception", async () => {
    const result = await getLobbyBookingDetail(baseUrl, "fake-token", 404404);
    expect(result.status).toBe(404);
  });

  it("createLobbyBooking : succès parse body.booking.booking_id (forme réelle, pas data[].idBooking)", async () => {
    const result = await createLobbyBooking(baseUrl, "fake-token", {
      categoryId: 9631,
      startDate: "2028-09-01",
      endDate: "2028-09-03",
      totalAdults: 2,
      holderName: "Test Holder",
      ratesPerDay: [{ date: "2028-09-01", price: 100000 }, { date: "2028-09-02", price: 100000 }],
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ booking: { booking_id: 20863344, room_id: 488678 } });
  });

  it("createLobbyBooking : catégorie non réservable → 422 INPUT_PARAMETERS, jamais une exception", async () => {
    const result = await createLobbyBooking(baseUrl, "fake-token", {
      categoryId: 99999,
      startDate: "2028-09-01",
      endDate: "2028-09-03",
      totalAdults: 1,
      holderName: "Test Holder",
      ratesPerDay: [],
    });
    expect(result.status).toBe(422);
    expect((result.body as { error_code: string }).error_code).toBe("INPUT_PARAMETERS");
  });

  it("addLobbyProductService : succès", async () => {
    const result = await addLobbyProductService(baseUrl, "fake-token", 20863344, [{ productId: 69899, qty: 1 }]);
    expect(result.status).toBe(200);
    expect((result.body as { sale: { total: number } }).sale.total).toBe(135000);
  });

  it("cancelLobbyBooking : succès sur un booking sans produit attaché", async () => {
    const result = await cancelLobbyBooking(baseUrl, "fake-token", 3324119, "TTC");
    expect(result.status).toBe(201);
  });

  it("cancelLobbyBooking : refus sur un booking avec produit attaché → 422 RESTRICTED_RESERVATION", async () => {
    const result = await cancelLobbyBooking(baseUrl, "fake-token", 20873561, "TTC");
    expect(result.status).toBe(422);
    expect((result.body as { error_code: string }).error_code).toBe("RESTRICTED_RESERVATION");
  });

  const slowBooking = {
    categoryId: 88888,
    startDate: "2028-09-01",
    endDate: "2028-09-02",
    totalAdults: 1,
    holderName: "Test Holder",
    ratesPerDay: [{ date: "2028-09-01", price: 100000 }],
  };

  it("createLobbyBooking : timeoutMs dépassé → TimeoutError (issue inconnue, jamais une réponse)", async () => {
    await expect(createLobbyBooking(baseUrl, "fake-token", slowBooking, undefined, 50)).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("createLobbyBooking : en-têtes reçus mais corps lent → TimeoutError aussi (le délai couvre la lecture du corps)", async () => {
    await expect(
      createLobbyBooking(baseUrl, "fake-token", { ...slowBooking, categoryId: 77777 }, undefined, 100)
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("createLobbyBooking : un 302 n'est PAS suivi (jamais un POST changé en GET) — le statut reste visible", async () => {
    const result = await createLobbyBooking(baseUrl, "fake-token", { ...slowBooking, categoryId: 66666 });
    expect(result.status).toBe(302);
  });

  it("createLobbyBooking : sans timeoutMs, aucun délai imposé — le délai reste opt-in pour chaque appelant", async () => {
    const result = await createLobbyBooking(baseUrl, "fake-token", slowBooking);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ booking: { booking_id: 20863345, room_id: 488678 } });
  });

  it("envoie l'en-tête X-Relay-Secret uniquement si relaySecret est fourni à l'appel", async () => {
    await getLobbyRooms(baseUrl, "fake-token");
    expect(lastRequestHeaders["x-relay-secret"]).toBeUndefined();

    await getLobbyRooms(baseUrl, "fake-token", undefined, "test-relay-secret-value");
    expect(lastRequestHeaders["x-relay-secret"]).toBe("test-relay-secret-value");
  });
});

// Les appels des jobs (Edge Functions, P6) passent un délai par appel : chacun le transmet
// réellement à son fetch. Serveur qui répond à TOUT après 300 ms, délai demandé 50 ms.
describe("lobbyClient — délai par appel des jobs", () => {
  let slowServer: Server;
  let slowUrl: string;

  beforeAll(async () => {
    slowServer = createServer((req, res) => {
      req.resume();
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [] }));
      }, 300);
    });
    await new Promise<void>((resolve) => slowServer.listen(0, "127.0.0.1", resolve));
    const address = slowServer.address();
    if (address && typeof address === "object") slowUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => new Promise<void>((resolve) => slowServer.close(() => resolve())));

  it.each([
    ["getLobbyRooms", (t: number) => getLobbyRooms(slowUrl, "fake-token", undefined, undefined, t)],
    ["getLobbyNightAvailability", (t: number) => getLobbyNightAvailability(slowUrl, "fake-token", 1, "2028-09-01", "2028-09-02", undefined, t)],
    ["getLobbyAvailableRooms", (t: number) => getLobbyAvailableRooms(slowUrl, "fake-token", "2028-09-01", "2028-09-02", undefined, t)],
    ["getLobbyBookingDetail", (t: number) => getLobbyBookingDetail(slowUrl, "fake-token", 1, undefined, t)],
    ["cancelLobbyBooking", (t: number) => cancelLobbyBooking(slowUrl, "fake-token", 1, "expired", undefined, undefined, t)],
  ])("%s : timeoutMs dépassé → TimeoutError", async (_nom, appel) => {
    await expect(appel(50)).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("getNightAvailabilityRange : délai dépassé → échec `unreachable`, jamais une exception", async () => {
    const result = await getNightAvailabilityRange(slowUrl, "fake-token", ["2028-09-01", "2028-09-02"], undefined, 50);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.kind).toBe("unreachable");
  });
});
