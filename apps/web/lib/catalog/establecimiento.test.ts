import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEstablecimientoPorSlug, urlDeContacto } from "./establecimiento";

describe("urlDeContacto", () => {
  it("retire le + que wa.me n'accepte pas", () => {
    expect(urlDeContacto("+573001234567")).toBe("https://wa.me/573001234567");
  });

  it("laisse intact un numéro déjà sans +", () => {
    // Impossible en base (la contrainte `establishments_contact_phone_e164` exige le `+`), mais la
    // fonction ne doit pas mutiler ce qu'elle reçoit si la contrainte changeait un jour.
    expect(urlDeContacto("573001234567")).toBe("https://wa.me/573001234567");
  });

  it("ne retire QUE le + de tête", () => {
    expect(urlDeContacto("+57300+123")).toBe("https://wa.me/57300+123");
  });
});

// ------------------------------------------------------------------------------------------------
// Lecture de la fiche : une panne n'est JAMAIS une absence. Faux client minimal — chaque table ou
// RPC peut être mise en erreur séparément ; sans erreur, toute sous-lecture rend une liste vide.
// ------------------------------------------------------------------------------------------------
const fauxSupabase = vi.hoisted(() => {
  const state = {
    principale: null as unknown,
    nbRegles: 0,
    erreurs: {} as Record<string, { message: string }>,
    listes: {} as Record<string, unknown[]>,
  };
  const resultat = (cle: string, principale: boolean) => {
    const error = state.erreurs[cle] ?? null;
    if (error) return { data: null, count: null, error };
    return principale
      ? { data: state.principale, error: null }
      : { data: state.listes[cle] ?? [], count: state.nbRegles, error: null };
  };
  const consulta = (table: string, principale: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lte", "order", "in"]) q[m] = () => q;
    q.maybeSingle = async () => resultat(table, table === principale);
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve(resultat(table, false)).then(ok, ko);
    return q;
  };
  const client = (principale: string) => ({
    from: (table: string) => consulta(table, principale),
    rpc: async (nom: string) => resultat(nom, false),
    storage: { from: () => ({ getPublicUrl: (r: string) => ({ data: { publicUrl: r } }) }) },
  });
  return { state, client };
});

vi.mock("@/lib/supabase/publicClient", () => ({
  createPublicClient: () => fauxSupabase.client("establishments"),
}));

const ESTABLECIMIENTO = {
  id: "e1",
  slug: "casa",
  name: { es: "Casa" },
  description: { es: "Descripción" },
  address: null,
  lat: null,
  lon: null,
  check_in_time: null,
  check_out_time: null,
  mode: "hostel",
  contact_phone: null,
};

describe("getEstablecimientoPorSlug — panne ≠ absence", () => {
  beforeEach(() => {
    fauxSupabase.state.principale = ESTABLECIMIENTO;
    fauxSupabase.state.erreurs = {};
    fauxSupabase.state.listes = {};
  });

  it("rend null pour un établissement absent (404 voulu)", async () => {
    fauxSupabase.state.principale = null;
    expect(await getEstablecimientoPorSlug("inconnu", { locale: "es" })).toBeNull();
  });

  it("rend la fiche quand toutes les lectures répondent", async () => {
    expect(await getEstablecimientoPorSlug("casa", { locale: "es" })).not.toBeNull();
  });

  it.each([
    ["establishments"],
    ["establishment_media"],
    ["products"],
    ["establishment_amenity_assignments"],
  ])("lève si la lecture %s échoue — jamais un 404 ni une fiche amputée", async (cle) => {
    fauxSupabase.state.erreurs = { [cle]: { message: "panne" } };
    await expect(getEstablecimientoPorSlug("casa", { locale: "es" })).rejects.toBeTruthy();
  });

  it("lève si la lecture des photos des offres échoue", async () => {
    fauxSupabase.state.listes = {
      products: [
        { id: "p1", slug: "kayak", name: { es: "Kayak" }, type: "activity", price_cop: 1000, price_label: null, capacity: null },
      ],
    };
    fauxSupabase.state.erreurs = { product_media: { message: "panne" } };
    await expect(getEstablecimientoPorSlug("casa", { locale: "es" })).rejects.toBeTruthy();
  });
});
