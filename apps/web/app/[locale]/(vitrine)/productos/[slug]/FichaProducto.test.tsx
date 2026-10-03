import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { LodgingKind } from "@hifago/domain";
import { FichaProducto } from "./FichaProducto";
import type { FichaProducto as DatosFicha } from "@/lib/catalog/tipos";
import { loadMessages } from "@/messages";

const messages = loadMessages("es");

// Même mock de navigation que CatalogBrowser.test.tsx (cf. son commentaire) : `@/i18n/navigation`
// tire next-intl/navigation → next/navigation, dont la résolution casse sous Vitest. Le lien de
// retour au catalogue n'est pas le sujet ici.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Les formulaires de réservation ont leurs propres dépendances (calendrier, panier, appels
// LobbyPMS côté client) et ne sont pas le sujet : ce fichier ne teste QUE la ligne de faits
// capacité/quantité ajoutée le 2026-08-26. Les neutraliser garde le test rapide et non fragile.
vi.mock("./ReservationForm", () => ({ ReservationForm: () => null }));
vi.mock("./LodgingReservationForm", () => ({ LodgingReservationForm: () => null }));
vi.mock("./SlotReservationForm", () => ({ SlotReservationForm: () => null }));
// `PhotoStrip` monte Embla, qui exige matchMedia/IntersectionObserver/ResizeObserver en jsdom
// (cf. PhotoStrip.test.tsx) : neutralisé ici, ce fichier ne teste que la ligne de faits.
vi.mock("@/components/molecules/PhotoStrip", () => ({ PhotoStrip: () => null }));

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
function renderView(overrides: {
  capacity: number | null;
  unitCount: number | null;
  lodgingKind?: LodgingKind | null;
  unit?: string | null;
  amenidades?: { categoria: string; items: string[] }[];
}) {
  // Une fiche COMPLÈTE, construite une fois : le composant reçoit désormais un seul objet
  // `FichaProducto` au lieu de 22 props éparses (spec 30 §7c). Un champ oublié devient une erreur
  // de type, plus un `undefined` silencieux dans le rendu.
  const ficha: DatosFicha = {
    id: "p1",
    slug: "glamping",
    tipo: "lodging",
    nombre: "GLAMPING",
    descripcion: null,
    fotos: [],
    precio: { tipo: "monto", cop: 120000 },
    unidad: overrides.unit ?? null,
    minQty: 1,
    modoReserva: "lodging",
    urlExterna: null,
    ocurrencia: null,
    eventoReservable: null,
    duracionDias: null,
    descuentoGrupo: null,
    programa: null,
    primeraSalidaIso: null,
    // Cette fiche est un `lodging` : le CHECK products_transport_info_transport_only garantit que
    // seul un `transport` peut porter ces champs.
    transporte: null,
    alojamiento: {
      lodgingKind: overrides.lodgingKind ?? null,
      capacity: overrides.capacity,
      unitCount: overrides.unitCount,
      priceTiers: null,
      maxQty: 1,
      esPmsBacked: true,
      amenidades: overrides.amenidades ?? [],
    },
    disponibilidad: [],
    restriccionesPms: [],
    tarifas: [],
    franjas: [],
    establecimiento: {
      id: "e1",
      slug: "casa-kayam",
      nombre: "Casa Kayam",
      descripcion: null,
      direccion: null,
      fotos: [],
    },
    localesNativas: ["es"],
  };

  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <FichaProducto ficha={ficha} etiquetas={{ ocurrencia: null }} locale="es" />
    </NextIntlClientProvider>
  );
}

describe("FichaProducto — capacité et nombre d'unités (2026-08-26)", () => {
  it("affiche les deux quand LobbyPMS les a fournis", () => {
    renderView({ capacity: 2, unitCount: 3 });
    const facts = screen.getByTestId("product-lodging-facts").textContent ?? "";
    expect(facts).toContain("2 personas");
    expect(facts).toContain("3");
  });

  // Le libellé compte autant que la valeur : `quantity` est le parc TOTAL du type, pas ce qui
  // reste libre cette nuit (pour un logement PMS-backed, cette réponse vient de Lobby en direct).
  // Annoncer « disponibles » serait un mensonge au client, d'où cette garde explicite.
  it("dit « en total », jamais « disponibles »", () => {
    renderView({ capacity: 2, unitCount: 3 });
    const facts = screen.getByTestId("product-lodging-facts").textContent ?? "";
    expect(facts).toContain("en total");
    expect(facts).not.toContain("disponible");
  });

  it("affiche la moitié présente sans séparateur orphelin", () => {
    renderView({ capacity: 2, unitCount: null });
    const facts = screen.getByTestId("product-lodging-facts").textContent ?? "";
    expect(facts).toContain("2 personas");
    expect(facts).not.toContain("·");
  });

  // Cas majoritaire du catalogue : la ligne entière disparaît, jamais un bloc vide.
  it("ne rend rien quand le produit n'a ni capacité ni quantité", () => {
    renderView({ capacity: null, unitCount: null });
    expect(screen.queryByTestId("product-lodging-facts")).toBeNull();
  });

  it("accorde le singulier", () => {
    renderView({ capacity: 1, unitCount: 8 });
    const facts = screen.getByTestId("product-lodging-facts").textContent ?? "";
    expect(facts).toContain("1 persona");
    expect(facts).not.toContain("1 personas");
  });
});

// products.lodging_kind (2026-08-27). C'est l'information la plus structurante d'une fiche
// d'hébergement — « on y dort seul ou à huit ? » — et elle arrivait jusqu'ici depuis LobbyPMS pour
// être jetée au moment de lier.
describe("FichaProducto — nature du couchage", () => {
  it("nomme le dortoir avant la capacité", () => {
    renderView({ capacity: 1, unitCount: 8, lodgingKind: "dorm" });
    const facts = screen.getByTestId("product-lodging-facts").textContent ?? "";
    expect(facts.startsWith("Cama en dormitorio")).toBe(true);
    expect(facts).toContain("8 en total");
  });

  it("nomme la chambre privée", () => {
    renderView({ capacity: 2, unitCount: 3, lodgingKind: "private" });
    expect(screen.getByTestId("product-lodging-facts").textContent).toContain("Habitación privada");
  });

  // La valeur que LobbyPMS ne peut pas fournir : elle n'arrive que d'un choix manuel du partenaire,
  // et c'est justement le cas réel de la v1 en production (Bania Travel).
  it("nomme la maison entière", () => {
    renderView({ capacity: 8, unitCount: 1, lodgingKind: "whole_house" });
    expect(screen.getByTestId("product-lodging-facts").textContent).toContain("Casa entera");
  });

  // Une chambre peut n'avoir que ça : la ligne doit apparaître pour elle seule, sans séparateur.
  it("s'affiche seule quand ni capacité ni quantité ne sont connues", () => {
    renderView({ capacity: null, unitCount: null, lodgingKind: "private" });
    const facts = screen.getByTestId("product-lodging-facts").textContent ?? "";
    expect(facts).toBe("Habitación privada");
  });
});

// `unit` est une unité de PRIX, distincte de lodging_kind. `per_house` a été ajouté à la contrainte
// le 2026-08-27 (la v1 l'a depuis toujours) ; rien ne l'écrit encore côté application, mais la
// fiche doit savoir l'afficher le jour où quelque chose le fera — sinon un prix de maison entière
// se lirait comme un prix par personne.
describe("FichaProducto — unité de prix", () => {
  it("dit « por persona » pour per_person", () => {
    renderView({ capacity: null, unitCount: null, unit: "per_person" });
    expect(screen.getByTestId("product-price").textContent).toContain("por persona");
  });

  it("dit « por la casa entera » pour per_house", () => {
    renderView({ capacity: null, unitCount: null, unit: "per_house" });
    expect(screen.getByTestId("product-price").textContent).toContain("por la casa entera");
  });

  // per_two reste délibérément sans suffixe : le prix d'une chambre double n'a rien à préciser.
  //
  // ⚠️ L'assertion porte sur l'ABSENCE de suffixe, jamais sur la chaîne exacte du montant :
  // `formatCop` insère une espace INSÉCABLE (U+00A0) avant « COP », invisible dans un diff comme
  // dans un message d'échec — « expected '120.000 COP' to be '120.000 COP' ». Coder ce caractère
  // en dur rendrait le test illisible et fragile à un changement d'`Intl`, pour ne rien vérifier
  // de plus que ce que la ligne ci-dessous dit clairement.
  it("n'ajoute aucun suffixe pour per_two", () => {
    renderView({ capacity: null, unitCount: null, unit: "per_two" });
    const texte = screen.getByTestId("product-price").textContent ?? "";
    expect(texte).toContain("120.000");
    expect(texte).not.toContain("por persona");
    expect(texte).not.toContain("por la casa entera");
  });
});

// Plan 41, P3 (2026-10-03) : le bandeau or porte le SEUL `<h1>` (spec 30, invariant 2), le fil
// d'Ariane reçu de la page, « Ofrecido por » et les faits en puces ; le panneau porte la politique
// d'annulation ; la barre mobile n'existe que s'il y a quelque chose à réserver. La disposition
// elle-même (deux colonnes, ordre mobile, collant) se prouve au rendu : jsdom n'applique pas les
// media queries.
describe("FichaProducto — mise en page de la charte (plan 41, P3)", () => {
  it("un seul <h1>, le nom du produit, dans le bandeau, sans point", () => {
    renderView({ capacity: 2, unitCount: 3 });
    const titres = document.querySelectorAll("h1");
    expect(titres.length).toBe(1);
    expect(titres[0].getAttribute("data-testid")).toBe("product-name");
    expect(titres[0].textContent).toBe("GLAMPING");
    expect(titres[0].closest("[data-testid='ficha-bandeau']")).not.toBeNull();
    expect(titres[0].querySelector("span")).toBeNull();
  });

  it("met « Ofrecido por » et les faits en puces dans le bandeau", () => {
    renderView({ capacity: 2, unitCount: 3, lodgingKind: "private" });
    const bandeau = screen.getByTestId("ficha-bandeau");
    const ofrecido = screen.getByTestId("product-ofrecido-por");
    expect(bandeau.contains(ofrecido)).toBe(true);
    expect(ofrecido.textContent).toContain("Ofrecido por Casa Kayam");
    expect(ofrecido.querySelector("a")?.getAttribute("href")).toBe("/establecimientos/casa-kayam");
    const faits = screen.getByTestId("product-lodging-facts");
    expect(bandeau.contains(faits)).toBe(true);
    expect(faits.querySelectorAll("[data-tono='neutro']").length).toBe(3);
  });

  it("pose la politique d'annulation dans un encadré, et la barre mobile quand on peut réserver", () => {
    renderView({ capacity: 2, unitCount: 3 });
    expect(screen.getByTestId("politica-cancelacion").getAttribute("data-tono")).toBe("info");
    const barra = screen.getByTestId("barra-reserva");
    expect(barra.textContent).toContain("120.000");
    expect(barra.textContent).toContain("Reservar");
    expect(document.getElementById("reservar")).not.toBeNull();
  });
});

// products/product_amenity_assignments (migration 20260917110000, décision Jérôme du 2026-09-17).
describe("FichaProducto — équipements structurés", () => {
  it("affiche les équipements groupés par catégorie quand la fiche en porte", () => {
    renderView({
      capacity: 2,
      unitCount: 1,
      amenidades: [{ categoria: "Baño", items: ["Baño privado", "Secador de pelo"] }],
    });
    const seccion = screen.getByTestId("product-amenities");
    expect(seccion.textContent).toContain("Baño");
    expect(seccion.textContent).toContain("Baño privado");
    expect(seccion.textContent).toContain("Secador de pelo");
  });

  it("n'affiche pas la section si amenidades est vide", () => {
    renderView({ capacity: 2, unitCount: 1, amenidades: [] });
    expect(screen.queryByTestId("product-amenities")).toBeNull();
  });
});
