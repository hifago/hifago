import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  esMiroirFresco,
  getProductoPorSlug,
  resolverModoReserva,
  resolverUrlContacto,
} from "./producto";
import { TELEFONO_HIFAGO, urlDeContacto } from "@/lib/contacto/whatsapp";

// Lot B (20260918170000) : le miroir de disponibilité LobbyPMS ne doit JAMAIS être semé côté
// serveur quand il est périmé — un connecteur tout juste activé (jamais synchronisé) ou un cron
// mort (arrêté 8 jours en août sans que personne ne le voie) afficherait sinon un calendrier faux
// que le client prendrait pour à jour. `getProductoPorSlug` n'a pas de test dédié (aucune
// fonction du fichier ne l'a jamais eu — pas de mock Supabase dans ce fichier), donc la garantie
// est extraite en fonction pure, testée ici sans base, comme `resolverUrlContacto` juste en dessous.
describe("esMiroirFresco", () => {
  const maintenant = Date.UTC(2026, 8, 18, 12, 0, 0);

  it("jamais synchronisé (établissement connecté à l'instant) → périmé", () => {
    expect(esMiroirFresco(null, maintenant)).toBe(false);
  });

  it("synchronisé il y a 1 minute → frais", () => {
    expect(esMiroirFresco(new Date(maintenant - 60_000).toISOString(), maintenant)).toBe(true);
  });

  it("synchronisé il y a 5 h 59 → encore frais, juste sous le seuil", () => {
    const cinqH59 = (5 * 60 + 59) * 60_000;
    expect(esMiroirFresco(new Date(maintenant - cinqH59).toISOString(), maintenant)).toBe(true);
  });

  it("synchronisé il y a EXACTEMENT 6 h → périmé (borne exclusive, comme search_catalog)", () => {
    const sixH = 6 * 60 * 60_000;
    expect(esMiroirFresco(new Date(maintenant - sixH).toISOString(), maintenant)).toBe(false);
  });

  it("le cron arrêté 8 jours (grief réel d'août 2026) → périmé", () => {
    const huitJours = 8 * 24 * 60 * 60_000;
    expect(esMiroirFresco(new Date(maintenant - huitJours).toISOString(), maintenant)).toBe(false);
  });
});

// Décision Jérôme du 2026-09-17 : un transport ne se réserve pas en ligne, on écrit au
// transporteur. Ces tests prouvent la GARANTIE qui le rend vrai — sans eux, « un transport n'a
// jamais de calendrier » serait un souhait et pas une règle (CLAUDE.md §11.20).
describe("resolverUrlContacto", () => {
  it("transport sans rien → le WhatsApp de Hifago, jamais null", () => {
    expect(
      resolverUrlContacto({ esTransporte: true, urlExterna: null, telefonoTransporte: null }),
    ).toBe(urlDeContacto(TELEFONO_HIFAGO));
  });

  it("transport avec son propre téléphone → son WhatsApp", () => {
    expect(
      resolverUrlContacto({
        esTransporte: true,
        urlExterna: null,
        telefonoTransporte: "+573001112233",
      }),
    ).toBe("https://wa.me/573001112233");
  });

  // Un transporteur qui a son propre site de réservation garde la main.
  it("l'URL externe reste prioritaire sur le téléphone", () => {
    expect(
      resolverUrlContacto({
        esTransporte: true,
        urlExterna: "https://gotravel.example/reservar",
        telefonoTransporte: "+573001112233",
      }),
    ).toBe("https://gotravel.example/reservar");
  });

  it("un autre type sans URL externe reste sans contact — comportement inchangé", () => {
    expect(
      resolverUrlContacto({ esTransporte: false, urlExterna: null, telefonoTransporte: null }),
    ).toBeNull();
  });
});

// LA garantie, énoncée comme une assertion : quelles que soient les données, un transport tombe en
// mode « vitrina » — donc bouton de contact, jamais de calendrier ni de panier.
describe("un transport n'a JAMAIS de calendrier", () => {
  it.each([
    ["sans téléphone ni URL", null, null],
    ["avec un téléphone", null, "+573001112233"],
    ["avec une URL externe", "https://gotravel.example/reservar", null],
  ])("%s → mode vitrina", (_cas, urlExterna, telefono) => {
    const urlContacto = resolverUrlContacto({
      esTransporte: true,
      urlExterna,
      telefonoTransporte: telefono,
    });
    expect(urlContacto).not.toBeNull();
    expect(
      resolverModoReserva({
        esEvento: false,
        esEventoReservable: false,
        urlExterna: urlContacto,
        esAlojamiento: false,
        // Même un transport qui porterait des créneaux resterait en vitrine : l'URL garantie passe
        // AVANT la branche `slot` dans le résolveur.
        tieneFranjas: true,
      }),
    ).toBe("vitrina");
  });

  // Le contre-exemple qui rend le test significatif : sans la garantie, on retombait sur "date",
  // c'est-à-dire le calendrier que Jérôme ne voulait pas.
  it("SANS la garantie, le même produit retomberait sur « date » (le calendrier)", () => {
    expect(
      resolverModoReserva({
        esEvento: false,
        esEventoReservable: false,
        urlExterna: null,
        esAlojamiento: false,
        tieneFranjas: false,
      }),
    ).toBe("date");
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
    lectures: [] as string[],
  };
  const resultat = (cle: string, principale: boolean) => {
    const error = state.erreurs[cle] ?? null;
    if (error) return { data: null, count: null, error };
    return principale
      ? { data: state.principale, error: null }
      : { data: state.listes[cle] ?? [], count: state.nbRegles, error: null };
  };
  const consulta = (table: string, principale: string) => {
    state.lectures.push(table);
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
  createPublicClient: () => fauxSupabase.client("products"),
}));

const ACTIVIDAD = {
  id: "p1",
  slug: "kayak",
  name: { es: "Kayak" },
  description: { es: "Descripción" },
  price_cop: 45000,
  type: "activity",
  external_booking_url: null,
  transport_contact_phone: null,
  establishment: { id: "e1", slug: "casa", name: { es: "Casa" }, description: null, address: null },
};

describe("getProductoPorSlug — panne ≠ absence", () => {
  beforeEach(() => {
    fauxSupabase.state.principale = ACTIVIDAD;
    fauxSupabase.state.nbRegles = 0;
    fauxSupabase.state.erreurs = {};
  });

  it("rend null pour un produit absent (404 voulu)", async () => {
    fauxSupabase.state.principale = null;
    expect(await getProductoPorSlug("inconnu", { locale: "es" })).toBeNull();
  });

  it("rend la fiche quand toutes les lectures répondent", async () => {
    expect(await getProductoPorSlug("kayak", { locale: "es" })).not.toBeNull();
  });

  it("porte le plafond par ligne de create_order : max_qty, replié à 20", async () => {
    expect((await getProductoPorSlug("kayak", { locale: "es" }))?.maxQty).toBe(20);
    fauxSupabase.state.principale = { ...ACTIVIDAD, max_qty: 4 };
    expect((await getProductoPorSlug("kayak-4", { locale: "es" }))?.maxQty).toBe(4);
  });

  it.each([
    ["products"],
    ["product_media"],
    ["establishment_media"],
    ["product_availability"],
    ["product_slot_rules"],
  ])("lève si la lecture %s échoue — jamais un 404 ni une fiche amputée", async (cle) => {
    fauxSupabase.state.erreurs = { [cle]: { message: "panne" } };
    await expect(getProductoPorSlug("kayak", { locale: "es" })).rejects.toBeTruthy();
  });

  it("lève si la lecture des créneaux échoue", async () => {
    fauxSupabase.state.nbRegles = 1;
    fauxSupabase.state.erreurs = { get_product_slots: { message: "panne" } };
    await expect(getProductoPorSlug("kayak", { locale: "es" })).rejects.toBeTruthy();
  });
});

// C8 — un logement PMS dont le connecteur est coupé (ou sans jeton) : `create_order` le refuserait
// (`pms_unavailable`, même condition). La fiche le marque non réservable en ligne, et le miroir
// n'est jamais semé (un calendrier « frais » mènerait droit à ce refus).
describe("getProductoPorSlug — logement PMS et état du connecteur", () => {
  const ilYAUneHeure = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const LOGEMENT_PMS = {
    id: "p9",
    slug: "dormitorio",
    name: { es: "Dormitorio" },
    description: null,
    price_cop: 60000,
    type: "lodging",
    lobby_category_id: 7,
    lodging_kind: "dorm_bed",
    capacity: 1,
    external_booking_url: null,
    transport_contact_phone: null,
  };
  const etablissement = (connecteur: boolean, jeton: boolean) => ({
    id: "e9",
    slug: "casa",
    name: { es: "Casa" },
    description: null,
    address: null,
    lobby_last_synced_at: ilYAUneHeure,
    lobby_connector_active: connecteur,
    lobby_has_token: jeton,
  });

  beforeEach(() => {
    fauxSupabase.state.nbRegles = 0;
    fauxSupabase.state.erreurs = {};
    fauxSupabase.state.lectures = [];
    fauxSupabase.state.listes = {
      pms_availability_mirror: [
        { date: "2026-11-05", available_units: 3, min_stay: null, max_stay: null, lead_days: null },
      ],
    };
  });

  it("connecteur actif avec jeton : réservable en ligne, miroir semé", async () => {
    fauxSupabase.state.principale = { ...LOGEMENT_PMS, establishment: etablissement(true, true) };
    const ficha = await getProductoPorSlug("dormitorio", { locale: "es" });
    expect(ficha?.alojamiento?.reservableEnLinea).toBe(true);
    expect(fauxSupabase.state.lectures).toContain("pms_availability_mirror");
    expect(ficha?.disponibilidad).toHaveLength(1);
  });

  it.each([
    ["connecteur coupé", false, true],
    ["jeton absent", true, false],
  ])("%s : non réservable en ligne, miroir jamais lu", async (_cas, connecteur, jeton) => {
    fauxSupabase.state.principale = { ...LOGEMENT_PMS, establishment: etablissement(connecteur, jeton) };
    const ficha = await getProductoPorSlug("dormitorio", { locale: "es" });
    expect(ficha?.alojamiento?.reservableEnLinea).toBe(false);
    expect(fauxSupabase.state.lectures).not.toContain("pms_availability_mirror");
    expect(ficha?.disponibilidad).toEqual([]);
  });
});

