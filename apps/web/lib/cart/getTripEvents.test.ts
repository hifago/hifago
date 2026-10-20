// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Spec 42 — un visiteur sans session n'a rien noté : anon n'a aucun grant sur trip_events (42501),
// et /mi-viaje ne doit pas tomber en 500 pour autant. Toute autre panne reste une panne : une
// liste illisible n'est jamais une liste vide.

const state = vi.hoisted(() => ({
  reponse: { data: [] as unknown, error: null as unknown },
  statuts: { data: [] as unknown, error: null as unknown },
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => {
    const requete = {
      select: () => requete,
      gte: () => requete,
      order: () => requete,
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(state.reponse).then(ok, ko),
    };
    return {
      from: () => requete,
      rpc: () => Promise.resolve(state.statuts),
    };
  },
}));

const { getTripEvents } = await import("./getTripEvents");

describe("getTripEvents — sans session ≠ panne", () => {
  beforeEach(() => {
    state.reponse = { data: [], error: null };
    state.statuts = { data: [], error: null };
  });

  it("rend [] pour un visiteur sans session (42501, anon sans grant)", async () => {
    state.reponse = { data: null, error: { code: "42501", message: "permission denied" } };
    state.statuts = { data: null, error: { code: "42501", message: "permission denied" } };
    expect(await getTripEvents("es")).toEqual([]);
  });

  it("lève sur toute autre erreur de lecture", async () => {
    state.reponse = { data: null, error: { code: "08006", message: "panne" } };
    await expect(getTripEvents("es")).rejects.toBeTruthy();
  });

  it("signale un evento dont la date n'est plus une occurrence", async () => {
    state.reponse = {
      data: [
        {
          id: "t-1",
          product_id: "p-1",
          date: "2099-11-05",
          created_at: "2026-10-19T10:00:00Z",
          products: {
            name: { es: "Concierto" },
            slug: "concierto",
            start_time: "20:00:00",
            establishment: { name: { es: "Casa" } },
          },
        },
      ],
      error: null,
    };
    state.statuts = { data: [{ id: "t-1", on_occurrence: false }], error: null };
    const [evento] = await getTripEvents("es");
    expect(evento).toMatchObject({ productName: "Concierto", onOccurrence: false });
  });
});
