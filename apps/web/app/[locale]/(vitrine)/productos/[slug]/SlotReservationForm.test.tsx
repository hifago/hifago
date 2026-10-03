import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SlotReservationForm } from "./SlotReservationForm";
import { guardarUltimosCriterios } from "@/lib/catalog/ultimosCriterios";
import { loadMessages } from "@/messages";

const messages = loadMessages("es");

// Même patron que ReservationForm.test.tsx : navigation et panier neutralisés.
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ lines: [], addLine: vi.fn() }) }));

// HORLOGE FIGÉE (même raison que les trois autres formulaires) : le calendrier masque le passé
// via `disabled={{ before: startOfTodayInBogota() }}`.
const TODAY = new Date(2026, 5, 1, 12);
const DAY_OPEN = "2026-06-10";
const DAY_FULL = "2026-06-11";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

type Creneau = {
  slot_date: string;
  slot_start_time: string;
  capacity: number;
  booked: number;
  slot_duration_minutes: number;
};

function renderForm(slotsOverride?: Creneau[], maxQty = 20) {
  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <SlotReservationForm
        productId="p1"
        slots={
          slotsOverride ?? [
            { slot_date: DAY_OPEN, slot_start_time: "09:00:00", capacity: 2, booked: 0, slot_duration_minutes: 60 },
            { slot_date: DAY_FULL, slot_start_time: "09:00:00", capacity: 2, booked: 2, slot_duration_minutes: 60 },
          ]
        }
        maxQty={maxQty}
      />
    </NextIntlClientProvider>
  );
}

// Spec 28 §4 point 3 : « le calendrier de la fiche se pré-remplit depuis la mémoire du
// navigateur » — jamais câblé avant ce lot. Ce fichier couvre CE seul comportement (aucun fichier
// de test n'existait pour ce composant avant ce lot).
describe("SlotReservationForm — pré-remplissage depuis la recherche (spec 28 §4 point 3)", () => {
  it("sélectionne la date mémorisée et affiche ses créneaux, sans aucun clic", () => {
    guardarUltimosCriterios(`?desde=${DAY_OPEN}&hasta=${DAY_OPEN}`);
    renderForm();

    expect(screen.getByTestId(`slot-chip-${DAY_OPEN}-09:00`)).toBeTruthy();
  });

  it("ignore une date mémorisée dont la journée est complète", () => {
    guardarUltimosCriterios(`?desde=${DAY_FULL}&hasta=${DAY_FULL}`);
    renderForm();

    expect(screen.queryByTestId(`slot-chip-${DAY_FULL}-09:00`)).toBeNull();
  });
});

// `create_order` plafonne chaque ligne à `coalesce(max_qty, 20)` pour TOUT type (migration
// 20260929112240) : le champ ne propose jamais davantage, même s'il reste plus de places au créneau.
describe("SlotReservationForm — max_qty", () => {
  function choisirCreneau(capacity: number, booked: number, maxQty: number) {
    guardarUltimosCriterios(`?desde=${DAY_OPEN}&hasta=${DAY_OPEN}`);
    renderForm(
      [{ slot_date: DAY_OPEN, slot_start_time: "09:00:00", capacity, booked, slot_duration_minutes: 60 }],
      maxQty
    );
    fireEvent.click(screen.getByTestId(`slot-chip-${DAY_OPEN}-09:00`));
    return document.getElementById("qty") as HTMLInputElement;
  }

  it("borne la quantité au plafond du produit quand il reste plus de places", () => {
    const champ = choisirCreneau(10, 0, 4);
    expect(champ.getAttribute("max")).toBe("4");
    fireEvent.change(champ, { target: { value: "9" } });
    expect(champ.value).toBe("4");
  });

  it("garde la place restante du créneau quand elle est sous le plafond", () => {
    expect(choisirCreneau(10, 7, 6).getAttribute("max")).toBe("3");
  });
});
