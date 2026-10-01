import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { addDays, format, parseISO } from "date-fns";
import { NextIntlClientProvider } from "next-intl";
import { ReservationForm } from "./ReservationForm";
import { guardarUltimosCriterios } from "@/lib/catalog/ultimosCriterios";
import { loadMessages } from "@/messages";

const messages = loadMessages("es");

// Même patron que LodgingReservationForm.test.tsx : navigation et panier neutralisés, seule la
// réaction du calendrier aux props est le sujet. `push` exposé (pas un `vi.fn()` anonyme) depuis
// 2026-09-15 : la redirection post-ajout diffère désormais selon camp/non-camp (useAddToCart réel,
// non mocké, tourne dans ce test — seul son router est neutralisé).
const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));

const addLine = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ lines: [], addLine }) }));

// HORLOGE FIGÉE (même raison que LodgingReservationForm.test.tsx) : le calendrier masque le passé
// via `disabled={{ before: startOfTodayInBogota() }}` — sans horloge fixe, les dates testées
// tomberaient hors du mois affiché ou dans le passé selon le jour d'exécution.
const TODAY = new Date(2026, 5, 1, 12);
const DEPARTURE = "2026-06-10";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
  addLine.mockClear();
  push.mockClear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

type Disponibilidad = { date: string; capacity: number; booked: number };

function renderForm(
  durationDays?: number,
  minQty?: number,
  availabilityOverride?: Disponibilidad[],
  maxQty = 20
) {
  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <ReservationForm
        productId="p1"
        availability={availabilityOverride ?? [{ date: DEPARTURE, capacity: 5, booked: 0 }]}
        durationDays={durationDays}
        minQty={minQty}
        maxQty={maxQty}
        locale="es"
      />
    </NextIntlClientProvider>
  );
}

// Couvre le correctif du 2026-09-13 : un camp (`duration_days` > 1) ne pose qu'UNE ligne
// `product_availability` par départ (jamais une par jour, cf. mockData/README.md) — sans ce
// correctif, seul le jour de départ était cliquable et le reste de la semaine semblait indisponible
// (retour Jérôme : « le calendrier du camp me montre la date du 1er octobre et pas la semaine
// entière »).
describe("ReservationForm — semaine d'un camp (durationDays > 1)", () => {
  it("laisse cliquer n'importe quel jour de la semaine du départ, jamais au-delà", () => {
    renderForm(3); // départ 10/06 + 2 jours = semaine 10-11-12

    expect(document.querySelector('[data-date="2026-06-10"]')?.hasAttribute("disabled")).toBe(false);
    expect(document.querySelector('[data-date="2026-06-11"]')?.hasAttribute("disabled")).toBe(false);
    expect(document.querySelector('[data-date="2026-06-12"]')?.hasAttribute("disabled")).toBe(false);
    // Le jour suivant la semaine du départ n'est PAS un jour bookable — durationDays ne doit pas
    // "déborder" sur le reste du calendrier.
    expect(document.querySelector('[data-date="2026-06-13"]')?.hasAttribute("disabled")).toBe(true);
  });

  it("un clic sur un jour DE LA SEMAINE (pas le départ) sélectionne quand même le départ réel", () => {
    renderForm(3);

    // 11/06 n'existe dans aucune ligne product_availability (seul 10/06 en porte une) : avant le
    // correctif, ce jour restait "sans disponibilité trouvée" et le bouton d'ajout restait désactivé.
    fireEvent.click(document.querySelector('[data-date="2026-06-11"]')!);

    expect(screen.getByTestId("add-to-cart-button").hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByTestId("add-to-cart-button"));
    expect(addLine).toHaveBeenCalledWith({ productId: "p1", date: DEPARTURE, qty: 1 });
  });
});

describe("ReservationForm — durationDays absent (activité/transport, comportement inchangé)", () => {
  it("seul le jour effectivement en disponibilité reste cliquable", () => {
    renderForm(); // pas de camp : comportement d'avant le correctif

    expect(document.querySelector('[data-date="2026-06-10"]')?.hasAttribute("disabled")).toBe(false);
    expect(document.querySelector('[data-date="2026-06-11"]')?.hasAttribute("disabled")).toBe(true);
  });
});

// Retour Jérôme (2026-09-14, produit "Hiking Group", min_qty: 2) : le champ Cantidad partait
// toujours de 1, sans empêcher ni signaler une saisie sous le plancher — create_order refusait déjà
// silencieusement (qty_below_minimum, jamais traduit avant ce lot).
describe("ReservationForm — min_qty > 1 (Jérôme, 2026-09-14)", () => {
  it("la quantité part directement du plancher, jamais de 1", () => {
    renderForm(undefined, 2);
    fireEvent.click(document.querySelector('[data-date="2026-06-10"]')!);

    expect((document.getElementById("qty") as HTMLInputElement).value).toBe("2");
  });

  it("l'ajout au panier envoie le plancher, jamais 1", () => {
    renderForm(undefined, 2);
    fireEvent.click(document.querySelector('[data-date="2026-06-10"]')!);
    fireEvent.click(screen.getByTestId("add-to-cart-button"));

    expect(addLine).toHaveBeenCalledWith({ productId: "p1", date: DEPARTURE, qty: 2 });
  });

  it("affiche l'indication du minimum, absente quand min_qty vaut 1", () => {
    renderForm(undefined, 2);
    expect(screen.getByTestId("min-qty-hint").textContent).toBe("Cantidad mínima: 2");
  });

  it("aucune indication de minimum quand min_qty est absent/1", () => {
    renderForm();
    expect(screen.queryByTestId("min-qty-hint")).toBeNull();
  });
});

// Spec 28 §4 point 3 : « le calendrier de la fiche se pré-remplit depuis la mémoire du
// navigateur » — jamais câblé avant ce lot. `guardarUltimosCriterios` (réel, pas mocké) sème la
// mémoire exactement comme `BuscadorInicio` le fait déjà pour toute recherche avec dates.
describe("ReservationForm — pré-remplissage depuis la recherche (spec 28 §4 point 3)", () => {
  it("sélectionne au montage la date mémorisée, sans aucun clic", () => {
    guardarUltimosCriterios(`?desde=${DEPARTURE}&hasta=${DEPARTURE}`);
    renderForm();

    expect(screen.getByTestId("add-to-cart-button").hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByTestId("add-to-cart-button"));
    expect(addLine).toHaveBeenCalledWith({ productId: "p1", date: DEPARTURE, qty: 1 });
  });

  it("ignore une date mémorisée qui ne correspond à aucun départ de ce produit", () => {
    guardarUltimosCriterios("?desde=2026-06-25&hasta=2026-06-25");
    renderForm();

    expect(screen.getByTestId("add-to-cart-button").hasAttribute("disabled")).toBe(true);
  });

  // Test par mutation de la garde de bornes ajoutée à `handleSelectDate` : sans elle, ce cas
  // passerait pour la mauvaise raison (`product_availability` n'a aucune borne côté requête).
  it("ignore une date mémorisée déjà passée à Guatapé, même si une ligne réelle existe", () => {
    guardarUltimosCriterios("?desde=2026-05-20&hasta=2026-05-20");
    renderForm(undefined, undefined, [
      { date: "2026-05-20", capacity: 5, booked: 0 },
      { date: DEPARTURE, capacity: 5, booked: 0 },
    ]);

    expect(screen.getByTestId("add-to-cart-button").hasAttribute("disabled")).toBe(true);
  });
});

// Retour Jérôme (2026-09-15) : sous l'agenda, une liste des éditions triée par date, en cartes —
// un seul état partagé avec le calendrier (jamais deux states à réconcilier), une édition sans
// cupo désactivée (pas seulement grisée, correction actée en cours de conception).
describe("ReservationForm — liste d'éditions synchronisée avec le calendrier (camp)", () => {
  const DEPART_B = "2026-06-15";
  const DEPART_COMPLETO = "2026-06-20";
  const disponibilidades: Disponibilidad[] = [
    { date: DEPARTURE, capacity: 5, booked: 0 },
    { date: DEPART_B, capacity: 4, booked: 0 },
    { date: DEPART_COMPLETO, capacity: 2, booked: 2 },
  ];

  it("n'affiche aucune liste hors camp (durationDays absent)", () => {
    renderForm();
    expect(screen.queryByTestId("edition-cards")).toBeNull();
  });

  it("affiche une carte par édition, y compris celle qui est complète", () => {
    renderForm(3, undefined, disponibilidades);
    expect(screen.getByTestId(`edition-card-${DEPARTURE}`)).toBeTruthy();
    expect(screen.getByTestId(`edition-card-${DEPART_B}`)).toBeTruthy();
    expect(screen.getByTestId(`edition-card-${DEPART_COMPLETO}`)).toBeTruthy();
  });

  it("cliquer une date du calendrier sélectionne la carte correspondante, et elle seule", () => {
    renderForm(3, undefined, disponibilidades);

    fireEvent.click(document.querySelector(`[data-date="${DEPARTURE}"]`)!);

    expect(screen.getByTestId(`edition-card-${DEPARTURE}`).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId(`edition-card-${DEPART_B}`).getAttribute("aria-pressed")).toBe("false");
  });

  it("cliquer une carte pilote le MÊME état que le calendrier (réutilise handleSelectDate)", () => {
    renderForm(3, undefined, disponibilidades);

    fireEvent.click(screen.getByTestId(`edition-card-${DEPART_B}`));

    expect(screen.getByTestId("add-to-cart-button").hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByTestId("add-to-cart-button"));
    expect(addLine).toHaveBeenCalledWith({ productId: "p1", date: DEPART_B, qty: 1 });
  });

  it("une seule carte sélectionnée à la fois — choisir l'une décoche l'autre", () => {
    renderForm(3, undefined, disponibilidades);

    fireEvent.click(screen.getByTestId(`edition-card-${DEPARTURE}`));
    expect(screen.getByTestId(`edition-card-${DEPARTURE}`).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByTestId(`edition-card-${DEPART_B}`));
    expect(screen.getByTestId(`edition-card-${DEPARTURE}`).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId(`edition-card-${DEPART_B}`).getAttribute("aria-pressed")).toBe("true");
  });

  it("une édition sans cupo reste visible mais désactivée — aucune sélection possible au clic", () => {
    renderForm(3, undefined, disponibilidades);

    const carteComplete = screen.getByTestId(`edition-card-${DEPART_COMPLETO}`);
    expect(carteComplete.hasAttribute("disabled")).toBe(true);

    fireEvent.click(carteComplete);

    expect(carteComplete.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("add-to-cart-button").hasAttribute("disabled")).toBe(true);
  });
});

// Retour Gabriel (2026-09-16) : « si 10 [éditions] tu affiches les 10 » — un camp à départs
// fréquents rendait une carte par édition sans plafond. Plafonné à 5, un bouton normal (même
// style que les autres boutons du formulaire, pas de variante à part) qui en dévoile 5 DE PLUS à
// chaque clic — jamais la liste entière d'un coup, jamais de bouton « voir moins » ensuite.
describe("ReservationForm — liste d'éditions plafonnée à 5 (retour Gabriel, 2026-09-16)", () => {
  const disponibilidadesLongues: Disponibilidad[] = Array.from({ length: 12 }, (_, i) => ({
    date: format(addDays(parseISO(DEPARTURE), i * 7), "yyyy-MM-dd"),
    capacity: 5,
    booked: 0,
  }));

  it("n'affiche que les 5 premières éditions et un bouton « voir plus »", () => {
    renderForm(3, undefined, disponibilidadesLongues);

    for (const row of disponibilidadesLongues.slice(0, 5)) {
      expect(screen.getByTestId(`edition-card-${row.date}`)).toBeTruthy();
    }
    for (const row of disponibilidadesLongues.slice(5)) {
      expect(screen.queryByTestId(`edition-card-${row.date}`)).toBeNull();
    }
    expect(screen.getByTestId("show-more-editions").textContent).toBe("Ver 5 ediciones más");
  });

  it("cliquer « voir plus » n'en ajoute que 5 de plus, jamais la liste entière", () => {
    renderForm(3, undefined, disponibilidadesLongues);

    fireEvent.click(screen.getByTestId("show-more-editions"));

    for (const row of disponibilidadesLongues.slice(0, 10)) {
      expect(screen.getByTestId(`edition-card-${row.date}`)).toBeTruthy();
    }
    for (const row of disponibilidadesLongues.slice(10)) {
      expect(screen.queryByTestId(`edition-card-${row.date}`)).toBeNull();
    }
    expect(screen.getByTestId("show-more-editions").textContent).toBe("Ver 2 ediciones más");
  });

  it("un second clic révèle le reliquat et fait disparaître le bouton", () => {
    renderForm(3, undefined, disponibilidadesLongues);

    fireEvent.click(screen.getByTestId("show-more-editions"));
    fireEvent.click(screen.getByTestId("show-more-editions"));

    for (const row of disponibilidadesLongues) {
      expect(screen.getByTestId(`edition-card-${row.date}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("show-more-editions")).toBeNull();
  });

  it("aucun bouton « voir plus » à 5 éditions ou moins", () => {
    renderForm(3, undefined, disponibilidadesLongues.slice(0, 5));
    expect(screen.queryByTestId("show-more-editions")).toBeNull();
  });
});

// Retour Jérôme (2026-09-15) : on ne peut plus prendre un camp sans réserver un hébergement pour
// ses nuits — le guidage front redirige vers /alojamientos (dates + personas déjà en filtre) au
// lieu de l'accueil. L'obligation RÉELLE est portée par create_order (camp_missing_lodging),
// couverte côté pgTAP — ce fichier ne couvre que le calcul de la redirection.
describe("ReservationForm — redirection vers /alojamientos après l'ajout d'un camp", () => {
  it("un camp multi-jours redirige vers /alojamientos avec desde/hasta/personas du départ choisi", async () => {
    renderForm(4); // durationDays=4 : dernier jour = DEPARTURE + 3

    fireEvent.click(document.querySelector(`[data-date="${DEPARTURE}"]`)!);
    fireEvent.click(screen.getByTestId("add-to-cart-button"));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/alojamientos?personas=1&desde=2026-06-10&hasta=2026-06-13&alojamientoParaCamp=1"
      )
    );
  });

  it("un camp d'une seule journée (durationDays=1) redirige vers l'accueil, comme avant", async () => {
    renderForm(1);

    fireEvent.click(document.querySelector(`[data-date="${DEPARTURE}"]`)!);
    fireEvent.click(screen.getByTestId("add-to-cart-button"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/?desdeCarrito=1"));
  });

  it("une activité/un transport (durationDays absent) redirige vers l'accueil, comme avant", async () => {
    renderForm();

    fireEvent.click(document.querySelector(`[data-date="${DEPARTURE}"]`)!);
    fireEvent.click(screen.getByTestId("add-to-cart-button"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/?desdeCarrito=1"));
  });
});

// `create_order` plafonne chaque ligne à `coalesce(max_qty, 20)` pour TOUT type depuis la migration
// 20260929112240 : le champ ne doit jamais proposer davantage, même s'il reste plus de places.
describe("ReservationForm — max_qty", () => {
  it("borne la quantité au plafond du produit quand il reste plus de places", () => {
    renderForm(undefined, 1, [{ date: DEPARTURE, capacity: 10, booked: 0 }], 3);
    fireEvent.click(document.querySelector(`[data-date="${DEPARTURE}"]`)!);
    const champ = document.getElementById("qty") as HTMLInputElement;

    expect(champ.getAttribute("max")).toBe("3");
    fireEvent.change(champ, { target: { value: "8" } });
    expect(champ.value).toBe("3");
  });

  it("garde la place restante quand elle est sous le plafond", () => {
    renderForm(undefined, 1, [{ date: DEPARTURE, capacity: 10, booked: 8 }], 5);
    fireEvent.click(document.querySelector(`[data-date="${DEPARTURE}"]`)!);

    expect((document.getElementById("qty") as HTMLInputElement).getAttribute("max")).toBe("2");
  });
});
