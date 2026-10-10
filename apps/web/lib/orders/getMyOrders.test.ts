// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// `cancellable` et `deposit_kept_on_cancel` viennent de la base (list_my_orders) et ne sont jamais
// déduits ici ; absents, ils valent faux.

const reponse = vi.hoisted(() => ({ valeur: { data: null as unknown, error: null as unknown } }));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({ rpc: async () => reponse.valeur }),
}));

const { getMyOrders } = await import("./getMyOrders");

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

  it("lit `deposit_kept_on_cancel` tel que la base le rend, sans regarder le statut de paiement", async () => {
    reponse.valeur = {
      data: {
        ok: true,
        orders: [
          // Le statut de paiement ne décide plus rien ici : seule la base le fait.
          commande("unpaid", [
            ligne("l-1", { deposit_kept_on_cancel: true }),
            ligne("l-2", { deposit_kept_on_cancel: false }),
            ligne("l-3", {}),
          ]),
        ],
      },
      error: null,
    };
    const lignes = (await getMyOrders("es"))?.upcoming[0].lines;
    expect(lignes?.map((l) => [l.id, l.depositKeptOnCancel])).toEqual([
      ["l-1", true],
      ["l-2", false],
      ["l-3", false],
    ]);
  });

  it("panne ou refus : null", async () => {
    reponse.valeur = { data: null, error: { message: "connection refused" } };
    expect(await getMyOrders("es")).toBeNull();
    reponse.valeur = { data: { ok: false, reason: "anonymous_session" }, error: null };
    expect(await getMyOrders("es")).toBeNull();
  });
});
