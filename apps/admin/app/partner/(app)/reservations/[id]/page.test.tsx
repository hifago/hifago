import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fiche d'une réservation, côté socio. Ce fichier prouve : (1) qu'une panne de
// `partner_reservation_detail` lève (app/error.tsx) au lieu de répondre 404 — la RPC rend `[]` pour
// une ligne inexistante OU hors de ses établissements, et c'est seulement ce cas-là qui est
// « introuvable » ; (2) que la durée du créneau reste un complément : sa lecture, ambiguë tant que
// la RPC ne rend pas le produit, n'empêche jamais la fiche de s'afficher.

class Introuvable extends Error {}

type Reponse = { data: unknown; error: { message: string; code?: string } | null };

const LIGNE = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "reserved",
  product_name: { es: "Kayak" },
  establishment_name: { es: "Finca" },
  holder_name: "Ana",
  holder_phone: null,
  holder_email: null,
  date: "2026-10-12",
  end_date: null,
  slot_start_time: "09:00:00",
  qty: 2,
  total_cop: 90000,
  created_at: "2026-10-01T15:00:00Z",
};

let detail: Reponse = { data: [LIGNE], error: null };
let creneau: Reponse = { data: { slot_duration_minutes: 90 }, error: null };
const journal = vi.spyOn(console, "error").mockImplementation(() => {});

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Introuvable("404");
  },
}));

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => {
    const c = { select: () => c, eq: () => c, maybeSingle: async () => creneau };
    return { rpc: async () => detail, from: () => c };
  },
}));

vi.mock("@/components/ContactClientButton", () => ({ ContactClientButton: () => null }));
vi.mock("./ReservationActions", () => ({ ReservationActions: () => null }));

const { default: PartnerReservationDetailPage } = await import("./page");

function ouvrir() {
  return PartnerReservationDetailPage({ params: Promise.resolve({ id: LIGNE.id }) } as never);
}

describe("/partner/reservations/[id]", () => {
  beforeEach(() => {
    detail = { data: [LIGNE], error: null };
    creneau = { data: { slot_duration_minutes: 90 }, error: null };
    journal.mockClear();
  });

  it("affiche la fiche avec la durée du créneau", async () => {
    render(await ouvrir());
    expect(screen.getByText("09:00 (90 min)")).toBeTruthy();
  });

  it("réservation absente ou hors de ses établissements ([]) : introuvable", async () => {
    detail = { data: [], error: null };
    await expect(ouvrir()).rejects.toBeInstanceOf(Introuvable);
  });

  it("panne de partner_reservation_detail : la page lève, jamais introuvable", async () => {
    detail = { data: null, error: { message: "connection refused" } };
    const resultat = ouvrir();
    await expect(resultat).rejects.toThrow(/partner_reservation_detail/);
    await expect(resultat).rejects.not.toBeInstanceOf(Introuvable);
  });

  it("créneau ambigu (deux produits à la même heure) : la fiche s'affiche sans durée, sans bruit", async () => {
    creneau = { data: null, error: { message: "multiple rows", code: "PGRST116" } };
    render(await ouvrir());
    expect(screen.getByText("09:00")).toBeTruthy();
    expect(journal).not.toHaveBeenCalled();
  });

  it("créneau en panne : la fiche s'affiche sans durée, et la panne est journalisée", async () => {
    creneau = { data: null, error: { message: "connection refused" } };
    render(await ouvrir());
    expect(screen.getByText("09:00")).toBeTruthy();
    expect(journal).toHaveBeenCalledTimes(1);
  });
});
