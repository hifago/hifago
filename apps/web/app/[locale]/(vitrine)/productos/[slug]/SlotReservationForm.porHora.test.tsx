import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SlotReservationForm } from "./SlotReservationForm";
import { guardarUltimosCriterios } from "@/lib/catalog/ultimosCriterios";
import { loadMessages } from "@/messages";

// Spec 43 — activité à l'heure : l'heure de début choisie, puis le nombre d'heures consécutives
// libres ; activité entière : aucun champ quantité. Même montage que SlotReservationForm.test.tsx.
const messages = loadMessages("es");
const addToCart = vi.fn();
let cartLines: unknown[] = [];

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ lines: cartLines, addLine: vi.fn() }) }));
vi.mock("@/lib/cart/useAddToCart", () => ({ useAddToCart: () => addToCart }));

const TODAY = new Date(2026, 5, 1, 12);
const DAY = "2026-06-10";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
  sessionStorage.clear();
  addToCart.mockReset();
  cartLines = [];
});

afterEach(() => {
  vi.useRealTimers();
});

// Un bateau, capacité 1, de 08:00 à 13:00 ; 11:00 déjà réservé.
const heure = (start: string, booked = 0) => ({
  slot_date: DAY,
  slot_start_time: `${start}:00`,
  capacity: 1,
  booked,
  slot_duration_minutes: 60,
});
const BATEAU = [heure("08:00"), heure("09:00"), heure("10:00"), heure("11:00", 1), heure("12:00")];

function renderForm(modoPrecio: "per_hour" | "per_activity", minQty = 1, slots = BATEAU) {
  guardarUltimosCriterios(`?desde=${DAY}&hasta=${DAY}`);
  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <SlotReservationForm productId="p1" slots={slots} minQty={minQty} maxQty={null} modoPrecio={modoPrecio} />
    </NextIntlClientProvider>
  );
}

describe("SlotReservationForm — à l'heure (spec 43)", () => {
  it("le nombre d'heures est borné par les heures consécutives libres depuis le début choisi", () => {
    renderForm("per_hour");
    fireEvent.click(screen.getByTestId(`slot-chip-${DAY}-08:00`));
    const champ = document.getElementById("qty") as HTMLInputElement;
    expect(champ.getAttribute("max")).toBe("3"); // 08, 09, 10 — 11:00 est pris
    expect(screen.getByText("Horas")).toBeTruthy();
  });

  it("une heure déjà prise n'est pas une heure de début", () => {
    renderForm("per_hour");
    expect((screen.getByTestId(`slot-chip-${DAY}-11:00`) as HTMLButtonElement).disabled).toBe(true);
  });

  it("un début qui n'offre pas le minimum d'heures est refusé", () => {
    renderForm("per_hour", 2);
    // 10:00 → une seule heure libre avant 11:00 ; 12:00 → la dernière heure de la journée.
    expect((screen.getByTestId(`slot-chip-${DAY}-10:00`) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(`slot-chip-${DAY}-12:00`) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(`slot-chip-${DAY}-08:00`) as HTMLButtonElement).disabled).toBe(false);
  });

  it("résume la plage et envoie au panier le début et le nombre d'heures", () => {
    renderForm("per_hour");
    fireEvent.click(screen.getByTestId(`slot-chip-${DAY}-08:00`));
    fireEvent.change(document.getElementById("qty") as HTMLInputElement, { target: { value: "3" } });
    expect(screen.getByTestId("slot-summary").textContent).toBe("De 08:00 a 11:00 · 3 horas");
    fireEvent.click(screen.getByTestId("add-to-cart-button"));
    expect(addToCart).toHaveBeenCalledWith({ productId: "p1", date: DAY, slotStartTime: "08:00", qty: 3 });
  });

  it("une ligne du panier de 2 h à 08:00 occupe 08:00 ET 09:00", () => {
    cartLines = [{ id: "l1", productId: "p1", date: DAY, slotStartTime: "08:00", qty: 2 }];
    renderForm("per_hour");
    expect((screen.getByTestId(`slot-chip-${DAY}-09:00`) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(`slot-chip-${DAY}-10:00`) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("SlotReservationForm — activité complète (spec 43)", () => {
  it("aucun champ quantité, une activité envoyée au panier", () => {
    renderForm("per_activity");
    fireEvent.click(screen.getByTestId(`slot-chip-${DAY}-08:00`));
    expect(document.getElementById("qty")).toBeNull();
    fireEvent.click(screen.getByTestId("add-to-cart-button"));
    expect(addToCart).toHaveBeenCalledWith({ productId: "p1", date: DAY, slotStartTime: "08:00", qty: 1 });
  });
});
