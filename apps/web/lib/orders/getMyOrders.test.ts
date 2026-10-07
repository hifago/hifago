// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// `cancellable` vient de la base (list_my_orders, règle de cancel_order_line) et n'est jamais
// déduit ici ; « l'acompte reste acquis » ne vaut que pour une commande encaissée.

const reponse = vi.hoisted(() => ({ valeur: { data: null as unknown, error: null as unknown } }));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({ rpc: async () => reponse.valeur }),
}));

const { depositRetainedOnCancel, getMyOrders } = await import("./getMyOrders");

function ligne(id: string, extra: Record<string, unknown>) {
  return {
    id,
    product_name: { es: "Kayak" },
    establishment_name: { es: "Casa" },
    establishment_slug: null,
    date: "2026-11-01",
    end_date: null,
    duration_days: null,
    slot_start_time: null,
    qty: 1,
    acompte_cop: 10000,
    total_cop: 40000,
    status: "reserved",
    ...extra,
  };
}

function commande(paymentStatus: string, lines: unknown[]) {
  return {
    id: `o-${paymentStatus}`,
    reference: "HFG-000001",
    access_token: "jeton",
    payment_status: paymentStatus,
    acompte_cop: 10000,
    group: "upcoming",
    lines,
  };
}

describe("getMyOrders", () => {
  beforeEach(() => {
    reponse.valeur = { data: null, error: null };
  });

  it("lit `cancellable` tel que la base le rend ; absent = non annulable", async () => {
    reponse.valeur = {
      data: {
        ok: true,
        orders: [
          commande("unpaid", [
            ligne("l-1", { cancellable: true }),
            ligne("l-2", { cancellable: false }),
            // Statut `reserved` mais base qui ne rend pas le champ : jamais un bouton qui échouerait.
            ligne("l-3", {}),
          ]),
        ],
      },
      error: null,
    };
    const lignes = (await getMyOrders("es"))?.upcoming[0].lines;
    expect(lignes?.map((l) => [l.id, l.cancellable])).toEqual([
      ["l-1", true],
      ["l-2", false],
      ["l-3", false],
    ]);
  });

  it.each([
    ["paid", true],
    ["partially_refunded", true],
    ["unpaid", false],
    ["pending", false],
    ["refunded", false],
  ])("commande %s : acompte retenu à l'annulation = %s", async (paymentStatus, attendu) => {
    expect(depositRetainedOnCancel(paymentStatus)).toBe(attendu);
    reponse.valeur = { data: { ok: true, orders: [commande(paymentStatus, [ligne("l-1", {})])] }, error: null };
    expect((await getMyOrders("es"))?.upcoming[0].depositRetainedOnCancel).toBe(attendu);
  });

  it("panne ou refus : null", async () => {
    reponse.valeur = { data: null, error: { message: "connection refused" } };
    expect(await getMyOrders("es")).toBeNull();
    reponse.valeur = { data: { ok: false, reason: "anonymous_session" }, error: null };
    expect(await getMyOrders("es")).toBeNull();
  });
});
