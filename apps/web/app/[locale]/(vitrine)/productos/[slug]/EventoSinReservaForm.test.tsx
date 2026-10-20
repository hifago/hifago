import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { EventoSinReservaForm } from "./EventoSinReservaForm";
import { loadMessages } from "@/messages";

const messages = loadMessages("es");

// Spec 42 — même patron qu'EventoReservationForm.test.tsx : navigation et Mi viaje neutralisés,
// seul le formulaire est le sujet.
const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));

const addTripEvent = vi.fn().mockResolvedValue({ ok: true });
let tripEvents: { id: string; productId: string; date: string }[] = [];
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ tripEvents, addTripEvent }) }));

// Horloge figée : le calendrier borne le passé à Guatapé.
const TODAY = new Date(2026, 5, 1, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
  addTripEvent.mockClear();
  push.mockClear();
  tripEvents = [];
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderForm(fechas: string[]) {
  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <EventoSinReservaForm productId="evt-1" fechas={fechas} />
    </NextIntlClientProvider>
  );
}

const boton = () => screen.getByTestId("add-trip-event-button");

describe("EventoSinReservaForm — noter un evento non réservable dans Mi viaje", () => {
  it("seules ses dates sont cliquables ; rien n'est ajoutable avant d'en choisir une", () => {
    renderForm(["2026-06-10", "2026-06-17"]);

    expect(document.querySelector('[data-date="2026-06-10"]')?.hasAttribute("disabled")).toBe(false);
    expect(document.querySelector('[data-date="2026-06-11"]')?.hasAttribute("disabled")).toBe(true);
    expect(boton().hasAttribute("disabled") || boton().getAttribute("data-disabled") === "true").toBe(true);
    expect(screen.getByTestId("evento-sin-reserva-nota").textContent).toBe(
      messages.ProductPage.eventoSelectDate
    );
  });

  it("ajoute la date choisie — ni quantité, ni prix — puis ouvre les hébergements de cette nuit", async () => {
    renderForm(["2026-06-10", "2026-06-17"]);
    fireEvent.click(document.querySelector('[data-date="2026-06-17"]')!);

    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByTestId("evento-sin-reserva-nota").textContent).toBe(
      messages.ProductPage.eventoNoBookingNeeded
    );
    fireEvent.click(boton());

    await waitFor(() => expect(addTripEvent).toHaveBeenCalledWith({ productId: "evt-1", date: "2026-06-17" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const href = push.mock.calls[0][0] as string;
    expect(href).toContain("/alojamientos");
    expect(href).toContain("desde=2026-06-17");
    expect(href).toContain("hasta=2026-06-18");
  });

  it("une date déjà notée : le formulaire le dit et n'ajoute rien de plus", () => {
    tripEvents = [{ id: "t1", productId: "evt-1", date: "2026-06-10" }];
    renderForm(["2026-06-10", "2026-06-17"]);
    fireEvent.click(document.querySelector('[data-date="2026-06-10"]')!);

    expect(screen.getByTestId("evento-sin-reserva-nota").textContent).toBe(
      messages.ProductPage.eventoAlreadyInTrip
    );
    fireEvent.click(boton());
    expect(addTripEvent).not.toHaveBeenCalled();
  });

  it("une date passée (à Guatapé) n'est jamais sélectionnable, même si elle figure dans la liste", () => {
    renderForm(["2026-05-20", "2026-06-10"]);
    // Le calendrier s'ouvre sur le mois de la première date fournie.
    expect(document.querySelector('[data-date="2026-05-20"]')?.hasAttribute("disabled")).toBe(true);
  });
});
