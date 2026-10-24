import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";
import { LINE_SCOPED_REASONS } from "@/lib/cart/lineReasons";
import type { CartLineAvailability, CartLineForDisplay } from "@/lib/cart/getCartLines";
import type { TripEventForDisplay } from "@/lib/cart/getTripEvents";
import { CartSummary } from "./CartSummary";

// La disponibilité de chaque ligne (`cart_lines_availability`, lue par getCartLines) : le motif
// exact sur la ligne signalée, jamais un retrait d'office, et un avis — jamais « disponible » —
// quand elle n'a pas pu être lue. Pas de jest-dom : assertions DOM natives.

// Ordre des gestes du retrait : suppression, puis pastille, puis relecture serveur.
const sequence: string[] = [];
const refreshRouter = vi.fn(() => {
  sequence.push("relecture");
});
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: refreshRouter }),
}));

const refreshPanier = vi.fn(async () => {
  sequence.push("pastille");
});
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ refresh: refreshPanier }) }));

// Spec 42 : la table visée par chaque retrait — une ligne de panier ou un evento noté.
const tablesSupprimees: string[] = [];
vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      delete: () => ({
        eq: async (_col: string, id: string) => {
          // La suppression rend la main APRÈS un tour de boucle : une relecture lancée sans
          // l'attendre passerait avant elle dans la séquence.
          await new Promise((fin) => setTimeout(fin, 0));
          sequence.push(`suppression:${id}`);
          tablesSupprimees.push(table);
          return { error: null };
        },
      }),
    }),
  }),
}));

const es = loadMessages("es") as unknown as {
  CartPage: Record<string, string>;
  CheckoutPage: { errors: Record<string, string> };
};

const ligne = (id: string, availability: CartLineAvailability): CartLineForDisplay => ({
  id,
  productId: `p-${id}`,
  productName: `Servicio ${id}`,
  productType: "actividad",
  productSlug: `servicio-${id}`,
  establishmentId: "e-1",
  establishmentName: "Casa",
  date: "2026-11-05",
  endDate: null,
  slotStartTime: null,
  qty: 1,
  priceCop: 50000,
  availability,
  durationDays: null,
  priceTiers: null,
  pmsPrice: null,
});

function rendre(lines: CartLineForDisplay[], editable = true) {
  return render(
    <NextIntlClientProvider locale="es" messages={loadMessages("es")}>
      <CartSummary lines={lines} editable={editable} locale="es" />
    </NextIntlClientProvider>
  ).container;
}

const avis = (racine: HTMLElement, id: string) => racine.querySelector(`[data-testid="unavailable-${id}"]`);
const inconnue = (racine: HTMLElement) => racine.querySelectorAll('[data-testid="availability-unknown"]');

beforeEach(() => {
  refreshRouter.mockClear();
  refreshPanier.mockClear();
  sequence.length = 0;
  tablesSupprimees.length = 0;
});

describe("CartSummary — disponibilité de chaque ligne", () => {
  it("ligne signalée : le texte de SA raison, sur elle seule, et elle reste dans le panier", () => {
    const racine = rendre([
      ligne("a", { status: "available" }),
      ligne("b", { status: "unavailable", reason: "full" }),
    ]);
    expect(avis(racine, "b")?.textContent).toBe(es.CheckoutPage.errors.full);
    expect(avis(racine, "a")).toBeNull();
    expect(racine.querySelector('[data-testid="cart-line-b"]')?.getAttribute("data-availability")).toBe("unavailable");
    expect(racine.querySelector('[data-testid="remove-line-b"]')).not.toBeNull();
    expect(inconnue(racine)).toHaveLength(0);
  });

  it.each([["raison_future"], [null]])("raison hors de la liste fermée (%s) : le texte générique", (reason) => {
    const racine = rendre([ligne("a", { status: "unavailable", reason })]);
    expect(avis(racine, "a")?.textContent).toBe(es.CartPage.lineUnavailable);
  });

  it("disponibilité illisible : UN avis pour tout le panier, aucune ligne signalée", () => {
    const racine = rendre([ligne("a", { status: "unknown" }), ligne("b", { status: "unknown" })]);
    expect(inconnue(racine)).toHaveLength(1);
    expect(inconnue(racine)[0].textContent).toBe(es.CartPage.availabilityUnknown);
    expect(avis(racine, "a")).toBeNull();
    expect(racine.querySelector('[data-testid="cart-line-a"]')?.getAttribute("data-availability")).toBe("unknown");
  });

  it("le même affichage en lecture seule (/pago)", () => {
    const racine = rendre(
      [ligne("a", { status: "unavailable", reason: "date_in_past" }), ligne("b", { status: "unknown" })],
      false
    );
    expect(avis(racine, "a")?.textContent).toBe(es.CheckoutPage.errors.date_in_past);
    expect(inconnue(racine)).toHaveLength(1);
  });

  it("tout disponible : ni avis ni ligne signalée", () => {
    const racine = rendre([ligne("a", { status: "available" }), ligne("b", { status: "available" })]);
    expect(racine.querySelectorAll('[data-testid^="unavailable-"]')).toHaveLength(0);
    expect(inconnue(racine)).toHaveLength(0);
  });

  // Chaque ligne est jugée avec les sommes du panier ENTIER : retirer une ligne peut en rendre une
  // autre disponible. Le retrait relit donc le panier côté serveur, verdicts compris.
  it("retrait : la ligne part, puis le panier est relu", async () => {
    const racine = rendre([ligne("a", { status: "unavailable", reason: "resource_unavailable" })]);
    await act(async () => {
      fireEvent.click(racine.querySelector('[data-testid="remove-line-a"]')!);
    });
    await waitFor(() => expect(sequence).toEqual(["suppression:a", "pastille", "relecture"]));
  });

  it.each(["es", "en"] as const)("chaque raison de la liste fermée a son texte (%s)", (locale) => {
    const erreurs = (loadMessages(locale) as unknown as { CheckoutPage: { errors: Record<string, string> } })
      .CheckoutPage.errors;
    for (const reason of LINE_SCOPED_REASONS) {
      expect(erreurs[reason], reason).toBeTruthy();
    }
  });
});

// Spec 42 — les eventos non réservables notés dans Mi viaje.
const evento = (id: string, date: string, onOccurrence = true): TripEventForDisplay => ({
  id,
  productId: `evt-${id}`,
  productName: `Evento ${id}`,
  productSlug: `evento-${id}`,
  establishmentName: "Casa",
  date,
  startTime: "20:00:00",
  onOccurrence,
});

function rendreViaje(lines: CartLineForDisplay[], eventos: TripEventForDisplay[]) {
  return render(
    <NextIntlClientProvider locale="es" messages={loadMessages("es")}>
      <CartSummary lines={lines} eventos={eventos} editable locale="es" />
    </NextIntlClientProvider>
  ).container;
}

const ordreAffiche = (racine: HTMLElement) =>
  [...racine.querySelectorAll('li[data-testid^="cart-line-"], li[data-testid^="trip-event-"]')].map(
    (li) => li.getAttribute("data-testid")
  );

describe("CartSummary — eventos notés sans réservation (spec 42)", () => {
  it("mêlés aux réservations par date ; à date égale, la réservation d'abord", () => {
    const racine = rendreViaje(
      [{ ...ligne("a", { status: "available" }), date: "2026-11-05" }],
      [evento("x", "2026-11-03"), evento("y", "2026-11-05"), evento("z", "2026-11-09")]
    );
    expect(ordreAffiche(racine)).toEqual([
      "trip-event-x",
      "cart-line-a",
      "trip-event-y",
      "trip-event-z",
    ]);
  });

  it("hors du total : seul le prix des réservations compte", () => {
    const racine = rendreViaje([ligne("a", { status: "available" })], [evento("x", "2026-11-03")]);
    const total = racine.querySelector('[data-testid="cart-total"]')!.textContent!;
    expect(total).toContain("50.000");
    expect(racine.querySelector('[data-testid="trip-event-badge-x"]')!.textContent).toBe(
      es.CartPage.eventoSinReserva
    );
  });

  it("seulement des eventos : la liste, sans total ni « Ir a pagar »", () => {
    const racine = rendreViaje([], [evento("x", "2026-11-03")]);
    expect(racine.querySelector('[data-testid="trip-event-x"]')).not.toBeNull();
    expect(racine.querySelector('[data-testid="cart-total"]')).toBeNull();
    expect(racine.querySelector('[data-testid="go-to-checkout"]')).toBeNull();
    expect(racine.querySelector('[data-testid="empty-cart"]')).toBeNull();
  });

  it("date qui n'est plus une occurrence : l'avis sur cette ligne seule", () => {
    const racine = rendreViaje([], [evento("x", "2026-11-03", false), evento("y", "2026-11-04")]);
    expect(racine.querySelector('[data-testid="trip-event-off-date-x"]')!.textContent).toBe(
      es.CartPage.eventoNoLongerOnDate
    );
    expect(racine.querySelector('[data-testid="trip-event-off-date-y"]')).toBeNull();
  });

  it("« Quitar » retire l'evento de trip_events, jamais de cart_items", async () => {
    const racine = rendreViaje([], [evento("x", "2026-11-03")]);
    await act(async () => {
      fireEvent.click(racine.querySelector('[data-testid="remove-trip-event-x"]')!);
    });
    await waitFor(() => expect(sequence).toEqual(["suppression:x", "pastille", "relecture"]));
    expect(tablesSupprimees).toEqual(["trip_events"]);
  });
});

describe("CartSummary — prix Lobby (2026-10-23)", () => {
  const nuitee = (id: string, pmsPrice: CartLineForDisplay["pmsPrice"]): CartLineForDisplay => ({
    ...ligne(id, { status: "available" }),
    productType: "lodging",
    endDate: "2026-11-07",
    qty: 2,
    pmsPrice,
  });

  it("non estimable : « precio confirmado en el pago » à la place d'un prix, et le total le dit", () => {
    const racine = rendre([nuitee("a", { kind: "pending" })]);
    expect(racine.querySelector('[data-testid="pms-price-pending-a"]')?.textContent).toBe(es.CartPage.pmsPricePending);
    expect(racine.querySelector('[data-testid="pms-total-pending"]')?.textContent).toBe(es.CartPage.pmsTotalPending);
  });

  it("le devis de /pago diffère de l'estimation : le nouveau prix s'affiche, l'ancien est rappelé", () => {
    const racine = rendre([nuitee("a", { kind: "quoted", totalCop: 230000, estimateCop: 210000 })], false);
    expect(racine.querySelector('[data-testid="cart-line-a"]')?.textContent).toMatch(/230\.000/);
    expect(racine.querySelector('[data-testid="pms-price-updated-a"]')?.textContent).toMatch(/210\.000/);
  });

  it("devis égal à l'estimation : aucun avis de changement", () => {
    const racine = rendre([nuitee("a", { kind: "quoted", totalCop: 210000, estimateCop: 210000 })], false);
    expect(racine.querySelector('[data-testid="pms-price-updated-a"]')).toBeNull();
  });

  it("/mi-viaje : l'estimation est dite comme telle", () => {
    const racine = rendre([nuitee("a", { kind: "estimated", totalCop: 210000 })]);
    expect(racine.querySelector('[data-testid="pms-price-estimated-a"]')?.textContent).toBe(es.CartPage.pmsPriceEstimated);
  });
});
