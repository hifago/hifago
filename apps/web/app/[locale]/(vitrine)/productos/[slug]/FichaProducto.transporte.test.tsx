// ⚠️ TZ forcé à un TROISIÈME fuseau, ni celui de la machine ni Bogota. C'est CE test qui prouve
// mécaniquement que la fenêtre de départs traverse le rendu sans jamais passer par un objet Date :
// `scripts/check-timezone.sh` ne grep que `new Date(...).toLocale` et ne verrait pas un
// `new Date(\`${fecha}T${hora}\`)` (spec 18 §0, CLAUDE.md §11.20). Même discipline que
// LodgingReservationForm.timezone.test.tsx.
process.env.TZ = "Europe/Paris";

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { FichaProducto } from "./FichaProducto";
import type { DatosTransporte, FichaProducto as DatosFicha } from "@/lib/catalog/tipos";
import { loadMessages } from "@/messages";

const messages = loadMessages("es");

// Mêmes mocks que FichaProducto.test.tsx (cf. ses commentaires) : navigation, formulaires de
// réservation et PhotoStrip ne sont pas le sujet — ici on ne teste que le bloc informatif.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("./ReservationForm", () => ({ ReservationForm: () => <div data-testid="calendario-mock" /> }));
vi.mock("./LodgingReservationForm", () => ({ LodgingReservationForm: () => null }));
vi.mock("./SlotReservationForm", () => ({ SlotReservationForm: () => null }));
vi.mock("./EventoReservationForm", () => ({ EventoReservationForm: () => null }));
vi.mock("@/components/molecules/PhotoStrip", () => ({ PhotoStrip: () => null }));

const AEROTUREX: DatosTransporte = {
  primeraSalida: "07:00",
  ultimaSalida: "07:45",
  plazasPorSalida: 40,
  salida: { direccion: "Parque de El Poblado, Medellín", lat: 6.2077, lon: -75.5673 },
  llegada: { direccion: "Parque Principal, Guatapé", lat: 6.2326, lon: -75.1592 },
};

function renderTransporte(transporte: DatosTransporte | null) {
  const ficha: DatosFicha = {
    id: "p1",
    slug: "bus-compartido",
    tipo: transporte ? "transport" : "lodging",
    nombre: "Bus compartido",
    descripcion: null,
    fotos: [],
    precio: { tipo: "monto", cop: 80000 },
    unidad: "per_person",
    minQty: 1,
    maxQty: 20,
    // Depuis le 2026-09-17, un transport est TOUJOURS en mode vitrine : sa couche de données lui
    // garantit une URL de contact (son WhatsApp, ou celui de Hifago). Le fixture le reflète —
    // c'est `producto.test.ts` qui prouve la garantie elle-même.
    modoReserva: transporte ? "vitrina" : "lodging",
    urlExterna: transporte ? "https://wa.me/573001112233" : null,
    ocurrencia: null,
    eventoReservable: null,
    duracionDias: null,
    descuentoGrupo: null,
    // `programa`/`primeraSalidaIso` : camp uniquement (spec 37, contrainte CHECK).
    programa: null,
    primeraSalidaIso: null,
    transporte,
    alojamiento: null,
    disponibilidad: [],
    restriccionesPms: [],
    tarifas: [],
    franjas: [],
    establecimiento: null,
    localesNativas: ["es"],
  };

  return render(
    <NextIntlClientProvider
      locale="es"
      messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}
    >
      <FichaProducto ficha={ficha} etiquetas={{ ocurrencia: null }} locale="es" />
    </NextIntlClientProvider>,
  );
}

describe("FichaProducto — transport informatif (2026-09-16)", () => {
  it("affiche la fenêtre de départs, les places et le trajet", () => {
    renderTransporte(AEROTUREX);
    expect(screen.getByTestId("transport-schedule").textContent).toContain("07:00");
    expect(screen.getByTestId("transport-schedule").textContent).toContain("07:45");
    expect(screen.getByTestId("transport-schedule").textContent).toContain("40 plazas");
    const ruta = screen.getByTestId("transport-route").textContent ?? "";
    expect(ruta).toContain("Parque de El Poblado");
    expect(ruta).toContain("Parque Principal, Guatapé");
  });

  // LE cas qui justifie `>=` en base plutôt que `>` : un transfert privé part à heure fixe.
  // Deux clés i18n distinctes, donc une phrase différente — surtout pas « 14:00 – 14:00 ».
  it("une salida unique (primera = última) ne s'affiche pas comme un intervalle", () => {
    renderTransporte({ ...AEROTUREX, primeraSalida: "14:00", ultimaSalida: "14:00" });
    const horario = screen.getByTestId("transport-schedule").textContent ?? "";
    expect(horario).toContain("14:00");
    expect(horario).not.toContain("14:00 y las 14:00");
  });

  // ⚠️ L'assertion anti-fuseau : sous TZ=Europe/Paris, une heure de Bogota s'affiche telle quelle.
  // Se vérifie par MUTATION — introduire un `new Date()` sur le chemin doit faire rougir ce test.
  it("sous TZ=Europe/Paris, une heure de nuit n'est pas décalée", () => {
    expect(process.env.TZ).toBe("Europe/Paris");
    renderTransporte({ ...AEROTUREX, primeraSalida: "00:30", ultimaSalida: "01:15" });
    const horario = screen.getByTestId("transport-schedule").textContent ?? "";
    expect(horario).toContain("00:30");
    expect(horario).toContain("01:15");
    expect(horario).not.toContain("22:30");
    expect(horario).not.toContain("02:30");
  });

  it("le lien Google Maps apparaît quand les deux extrémités ont leurs coordonnées", () => {
    renderTransporte(AEROTUREX);
    const lien = screen.getByTestId("transport-maps-link");
    const href = lien.getAttribute("href") ?? "";
    expect(href).toContain("google.com/maps/dir/");
    expect(href).toContain("origin=6.2077%2C-75.5673");
    expect(href).toContain("destination=6.2326%2C-75.1592");
    // Posé par LinkButton et impossible à oublier (la prop `rel` n'existe pas sur son type).
    expect(lien.getAttribute("rel")).toContain("noopener");
  });

  // Un itinéraire à une seule borne n'existe pas — mais les adresses restent affichées.
  it("sans les coordonnées d'arrivée, pas de lien Maps, mais le trajet reste affiché", () => {
    renderTransporte({ ...AEROTUREX, llegada: { ...AEROTUREX.llegada, lat: null, lon: null } });
    expect(screen.queryByTestId("transport-maps-link")).toBeNull();
    expect(screen.getByTestId("transport-route").textContent).toContain("Parque Principal, Guatapé");
  });

  it("un départ seul suffit : la ligne de trajet s'affiche sans arrivée", () => {
    renderTransporte({
      ...AEROTUREX,
      llegada: { direccion: null, lat: null, lon: null },
    });
    const ruta = screen.getByTestId("transport-route").textContent ?? "";
    expect(ruta).toContain("Parque de El Poblado");
    expect(ruta).not.toContain("→");
  });

  it("les horaires seuls suffisent : pas de ligne de trajet orpheline", () => {
    renderTransporte({
      primeraSalida: "07:00",
      ultimaSalida: "07:45",
      plazasPorSalida: null,
      salida: { direccion: null, lat: null, lon: null },
      llegada: { direccion: null, lat: null, lon: null },
    });
    expect(screen.getByTestId("transport-schedule")).toBeTruthy();
    expect(screen.queryByTestId("transport-route")).toBeNull();
  });

  it("un transport qui ne porte rien n'affiche aucun bloc", () => {
    renderTransporte({
      primeraSalida: null,
      ultimaSalida: null,
      plazasPorSalida: null,
      salida: { direccion: null, lat: null, lon: null },
      llegada: { direccion: null, lat: null, lon: null },
    });
    expect(screen.queryByTestId("transport-info")).toBeNull();
  });

  it("un produit qui n'est pas un transport n'affiche jamais ce bloc", () => {
    renderTransporte(null);
    expect(screen.queryByTestId("transport-info")).toBeNull();
  });

  // Ce que Jérôme a demandé le 2026-09-17 : « normalement il faut juste son num de tel pour
  // contacter ». Le calendrier et le panier disparaissent, le bouton WhatsApp prend leur place.
  it("affiche un bouton de contact et AUCUN calendrier", () => {
    renderTransporte(AEROTUREX);
    expect(screen.getByTestId("vitrina-contact-link")).toBeTruthy();
    expect(screen.queryByTestId("calendario-mock")).toBeNull();
  });

  // ⚠️ Régression évitée le 2026-09-17 : le suffixe d'unité était exclu du mode vitrine, donc
  // passer les transports en vitrine faisait perdre « por persona » sur CHACUN — or c'est
  // exactement ce que le texte legacy insistait à dire (« El precio es por pasajero, ida y
  // vuelta », « por trayecto (solo ida) y por vehículo »).
  it("en vitrine, le prix garde son suffixe d'unité (« por persona »)", () => {
    renderTransporte(AEROTUREX);
    expect(screen.getByTestId("product-price").textContent).toContain("por persona");
  });

  // Le mode vitrine ne doit RIEN retirer de l'information : c'est tout l'intérêt du lot.
  it("en vitrine, les horaires, le trajet et le lien Maps restent affichés", () => {
    renderTransporte(AEROTUREX);
    expect(screen.getByTestId("transport-schedule")).toBeTruthy();
    expect(screen.getByTestId("transport-route")).toBeTruthy();
    expect(screen.getByTestId("transport-maps-link")).toBeTruthy();
  });
});
