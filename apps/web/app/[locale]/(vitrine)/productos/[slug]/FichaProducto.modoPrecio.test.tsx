import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PricingUnit } from "@hifago/domain";
import { FichaProducto } from "./FichaProducto";
import type { FichaProducto as DatosFicha } from "@/lib/catalog/tipos";
import { loadMessages } from "@/messages";

// Spec 43 — une activité dit ce que son prix compte, et annonce son nombre de personnes.
// Même montage que FichaProducto.test.tsx (formulaires et galerie neutralisés).
const messages = loadMessages("es");

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("./ReservationForm", () => ({ ReservationForm: () => null }));
vi.mock("./LodgingReservationForm", () => ({ LodgingReservationForm: () => null }));
vi.mock("./SlotReservationForm", () => ({ SlotReservationForm: () => <div data-testid="slot-form" /> }));
vi.mock("@/components/molecules/PhotoStrip", () => ({ PhotoStrip: () => null }));

function renderActividad(modoPrecio: PricingUnit, personas: DatosFicha["personas"] = null) {
  const ficha: DatosFicha = {
    id: "p1",
    slug: "wakeboard",
    tipo: "activity",
    nombre: "Wakeboard",
    descripcion: null,
    fotos: [],
    precio: { tipo: "monto", cop: 420000 },
    unidad: null,
    modoPrecio,
    personas,
    minQty: 1,
    maxQty: null,
    modoReserva: "slot",
    urlExterna: null,
    ocurrencia: null,
    eventoReservable: null,
    fechasEventoSinReserva: null,
    duracionDias: null,
    descuentoGrupo: null,
    programa: null,
    primeraSalidaIso: null,
    transporte: null,
    alojamiento: null,
    disponibilidad: [],
    restriccionesPms: [],
    tarifas: [],
    franjas: [],
    establecimiento: null,
    localesNativas: ["es"],
  };
  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <FichaProducto ficha={ficha} etiquetas={{ ocurrencia: null }} locale="es" />
    </NextIntlClientProvider>
  );
}

describe("FichaProducto — mode de prix d'une activité (spec 43)", () => {
  it("à l'heure : « por hora » et « De 1 a 10 personas »", () => {
    renderActividad("per_hour", { min: 1, max: 10 });
    expect(screen.getByTestId("product-price").textContent).toContain("por hora");
    expect(screen.getByTestId("activity-persons").textContent).toBe("De 1 a 10 personas");
  });

  it("activité complète : « por la actividad completa », maximum seul", () => {
    renderActividad("per_activity", { min: null, max: 8 });
    expect(screen.getByTestId("product-price").textContent).toContain("por la actividad completa");
    expect(screen.getByTestId("activity-persons").textContent).toBe("Hasta 8 personas");
  });

  it("par personne : « por persona » même sans unité saisie, aucune puce de personnes", () => {
    renderActividad("per_person");
    expect(screen.getByTestId("product-price").textContent).toContain("por persona");
    expect(screen.queryByTestId("activity-persons")).toBeNull();
  });
});
