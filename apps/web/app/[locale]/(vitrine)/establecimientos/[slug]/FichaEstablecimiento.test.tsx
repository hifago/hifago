import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";
import type { FichaEstablecimiento as DatosFicha, TarjetaOferta } from "@/lib/catalog/tipos";
import { FichaEstablecimiento } from "./FichaEstablecimiento";

const messages = loadMessages("es");

// La galerie monte Embla, qui exige trois bouchons de navigateur en jsdom. Neutralisée : ce fichier
// teste la FICHE, pas le carrousel (qui a ses propres tests).
vi.mock("@/components/molecules/PhotoStrip", () => ({ PhotoStrip: () => null }));
// Les rails (`SeccionRiel`, plan 41 P4) sont rendus pour de vrai : leur rangée (`FilaRiel`) observe sa
// taille, et jsdom n'a pas de `ResizeObserver`. Doublure inerte, comme `SeccionRiel.test.tsx`.
class ObservateurInerte {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObservateurInerte);
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const habitacion: TarjetaOferta = {
  clave: "producto-1",
  href: "/productos/cabana",
  nombre: "Cabaña del Lago",
  establecimiento: null,
  precio: { tipo: "monto", cop: 180000 },
  fotos: [],
  tipo: "lodging",
  nAlojamientos: null,
  capacidad: 4,
  testId: "tarjeta-cabana",
};

function ficha(overrides: Partial<DatosFicha> = {}): DatosFicha {
  return {
    id: "e1",
    slug: "casa-kayam",
    nombre: "Casa Kayam",
    descripcion: null,
    direccion: null,
    lat: null,
    lon: null,
    horaEntrada: null,
    horaSalida: null,
    modo: null,
    contacto: null,
    fotos: [],
    alojamientos: [],
    otrosProductos: [],
    amenidades: [],
    localesNativas: ["es"],
    ...overrides,
  };
}

function renderFicha(overrides: Partial<DatosFicha> = {}) {
  return render(
    <NextIntlClientProvider
      locale="es"
      messages={{
        EstablishmentPage: messages.EstablishmentPage,
        HomePage: messages.HomePage,
        Common: messages.Common,
      }}
    >
      <FichaEstablecimiento ficha={ficha(overrides)} locale="es" />
    </NextIntlClientProvider>
  );
}

describe("FichaEstablecimiento — le titre", () => {
  it("porte un <h1>, et c'est le nom du lieu", () => {
    // La page n'en avait AUCUN : `Card.Title` de HeroUI rend un `<h3>`, et la hiérarchie mesurée
    // en réel était h3 → h2 → h3 (spec 30 §1.2).
    renderFicha();
    const titre = screen.getByTestId("establishment-name");
    expect(titre.tagName).toBe("H1");
    expect(titre.textContent).toBe("Casa Kayam");
  });
});

describe("FichaEstablecimiento — les horaires DU LIEU", () => {
  it("affiche les deux quand ils sont renseignés", () => {
    renderFicha({ horaEntrada: "15:00:00", horaSalida: "11:00:00" });
    const ligne = screen.getByTestId("establishment-hours").textContent ?? "";
    expect(ligne).toContain("15:00");
    expect(ligne).toContain("11:00");
  });

  it("affiche la moitié présente sans séparateur orphelin", () => {
    renderFicha({ horaEntrada: "15:00:00" });
    const ligne = screen.getByTestId("establishment-hours").textContent ?? "";
    expect(ligne).toContain("15:00");
    expect(ligne).not.toContain("·");
  });

  it("ne rend AUCUNE ligne quand aucun horaire n'est connu", () => {
    // Et c'est le cas qui compte le plus depuis le 2026-09-08 : `products.check_in_time` existe
    // toujours et reste éditable côté admin, mais l'établissement fait SEUL foi (spec 30 §3.4).
    // Un horaire saisi sur le produit ne doit rien faire apparaître ici.
    renderFicha();
    expect(screen.queryByTestId("establishment-hours")).toBeNull();
  });
});

describe("FichaEstablecimiento — le contact public", () => {
  it("construit un lien wa.me en retirant le +", () => {
    renderFicha({ contacto: "+573001234567" });
    const lien = screen.getByTestId("establishment-contact-link");
    expect(lien.getAttribute("href")).toBe("https://wa.me/573001234567");
  });

  it("ouvre dans un nouvel onglet, sans laisser la cible accéder à l'ouvreur", () => {
    renderFicha({ contacto: "+573001234567" });
    const lien = screen.getByTestId("establishment-contact-link");
    expect(lien.getAttribute("target")).toBe("_blank");
    // `noopener` : sans lui, la page cible peut réécrire l'URL de la nôtre.
    expect(lien.getAttribute("rel") ?? "").toContain("noopener");
  });

  it("n'affiche AUCUN bouton sans numéro, et rien à la place", () => {
    renderFicha();
    expect(screen.queryByTestId("establishment-contact-link")).toBeNull();
  });
});

describe("FichaEstablecimiento — équipements structurés (2026-09-17)", () => {
  it("affiche les équipements groupés par catégorie", () => {
    renderFicha({
      amenidades: [
        { categoria: "Piscina y bienestar", items: ["Piscina privada", "Jacuzzi"] },
        { categoria: "Servicios básicos", items: ["Wifi"] },
      ],
    });
    const seccion = screen.getByTestId("establishment-amenities");
    expect(seccion.textContent).toContain("Piscina y bienestar");
    expect(seccion.textContent).toContain("Piscina privada");
    expect(seccion.textContent).toContain("Wifi");
  });

  it("n'affiche rien quand aucun équipement n'est assigné", () => {
    renderFicha({ amenidades: [] });
    expect(screen.queryByTestId("establishment-amenities")).toBeNull();
  });
});

describe("FichaEstablecimiento — ses produits", () => {
  it("sépare les couchages des autres produits, chacun dans sa section", () => {
    const actividad: TarjetaOferta = { ...habitacion, clave: "p2", tipo: "activity", nombre: "Kayak", testId: "tarjeta-kayak" };
    renderFicha({ alojamientos: [habitacion], otrosProductos: [actividad] });
    expect(screen.getByTestId("establishment-lodgings")).toBeTruthy();
    expect(screen.getByTestId("establishment-activities")).toBeTruthy();
  });

  it("le titre des couchages suit le MODE du lieu, jamais un intitulé unique", () => {
    renderFicha({ alojamientos: [habitacion], modo: "whole_house" });
    expect(screen.getByTestId("establishment-lodgings").textContent).toContain("Alojamiento completo");
  });

  it("retombe sur un intitulé neutre quand le mode n'est pas renseigné", () => {
    // « Sin especificar » n'est pas un oubli : un établissement qui ne vend que des activités n'a
    // pas de mode d'hébergement, et lui en imposer un fabriquerait une information fausse.
    renderFicha({ alojamientos: [habitacion], modo: null });
    expect(screen.getByTestId("establishment-lodgings").textContent).toContain("Alojamiento");
  });

  it("ne rend pas une section vide", () => {
    renderFicha({ alojamientos: [habitacion] });
    expect(screen.queryByTestId("establishment-activities")).toBeNull();
  });
});

// Plan 41, P4 (2026-10-03) : le bandeau or porte le SEUL `<h1>`, l'adresse, les horaires en puces
// et le contact en bouton marine ; les offres sont des rails à titre à point, sans « GO → ». La
// disposition (deux colonnes, rail, écarts) se prouve au rendu : jsdom n'applique pas les media
// queries.
describe("FichaEstablecimiento — la charte (plan 41, P4)", () => {
  it("un seul <h1>, le nom, dans le bandeau, sans point ; adresse et horaires avec lui", () => {
    renderFicha({ direccion: "Vereda El Roble", horaEntrada: "15:00:00", horaSalida: "11:00:00" });
    const titres = document.querySelectorAll("h1");
    expect(titres.length).toBe(1);
    const bandeau = screen.getByTestId("ficha-bandeau");
    expect(bandeau.contains(titres[0])).toBe(true);
    expect(titres[0].querySelector("span")).toBeNull();
    expect(bandeau.contains(screen.getByTestId("establishment-address"))).toBe(true);
    const horarios = screen.getByTestId("establishment-hours");
    expect(bandeau.contains(horarios)).toBe(true);
    expect(horarios.querySelectorAll("[data-tono='neutro']").length).toBe(2);
  });

  it("met le contact dans le bandeau, en bouton marine", () => {
    renderFicha({ contacto: "+573001234567" });
    const lien = screen.getByTestId("establishment-contact-link");
    expect(screen.getByTestId("ficha-bandeau").contains(lien)).toBe(true);
    // La couleur `marine` de l'atome (F4) : ses jetons `--bouton-marine*`.
    expect(lien.className).toContain("--bouton-marine");
  });

  it("rend les offres en rails à titre à point, avec prix et capacité, sans « GO »", () => {
    renderFicha({ alojamientos: [habitacion], modo: "rooms" });
    const rail = screen.getByTestId("establishment-lodgings");
    expect(rail.tagName).toBe("SECTION");
    const titre = screen.getByTestId("establishment-lodgings-titulo");
    expect(titre.tagName).toBe("H2");
    expect(titre.textContent).toContain("Habitaciones");
    expect(titre.querySelector("span[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByTestId("tarjeta-cabana-precio")).toBeTruthy();
    expect(rail.textContent).toContain("personas");
    expect(screen.queryByTestId("establishment-lodgings-ver-mas")).toBeNull();
  });
});
