import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { LodgingReservationForm } from "./LodgingReservationForm";
import { loadMessages } from "@/messages";

const messages = loadMessages("es");

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...p }: React.ComponentProps<"a">) => <a href={href} {...p}>{children}</a>,
  // Spec 28 Tranche 3 : `useAddToCart` appelle désormais `useRouter()` pour rediriger vers
  // l'accueil sur succès — le lien de retour n'est plus le sujet de ce fichier.
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ lines: [], addLine: vi.fn() }) }));

// ---------------------------------------------------------------------------------------------
// LE GRIEF, REJOUÉ. Le 2026-08-28, Jérôme sélectionne les 23-24 décembre sur GUSTO et lit
// « Alguna noche de este rango ya no está disponible ». Le lot de ce jour-là a fermé le cas des
// nuits JAMAIS RÉCUPÉRÉES. Restait le cas d'une nuit RÉELLEMENT PLEINE qu'on ENJAMBE : elle était
// barrée mais cliquable, et la plage qui la traversait n'était refusée qu'après coup — mot pour mot
// le même message. Ce fichier ferme ce dernier cas.
//
// Horloge figée au 1er décembre 2026 : sans elle, décembre serait hors du mois affiché (le
// calendrier ouvre sur le mois de Guatapé) et les nuits testées tomberaient dans le passé ou
// au-delà de l'horizon de six mois selon le jour d'exécution.
// ---------------------------------------------------------------------------------------------
const NUITS = [
  ...[19, 20, 21, 22].map((d) => ({ date: `2026-12-${d}`, capacity: 4, booked: 0 })),
  // LES DEUX NUITS DU GRIEF, réellement pleines cette fois : Lobby a répondu, il n'y a plus de place.
  { date: "2026-12-23", capacity: 0, booked: 0 },
  { date: "2026-12-24", capacity: 0, booked: 0 },
  ...[25, 26, 27, 28].map((d) => ({ date: `2026-12-${d}`, capacity: 4, booked: 0 })),
  // Nuit à 2 places : réservable à 1 ou 2, plus au-delà. Sert le piège de la quantité.
  { date: "2026-12-29", capacity: 2, booked: 0 },
  { date: "2026-12-30", capacity: 4, booked: 0 },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T15:00:00Z"));
});
afterEach(() => vi.useRealTimers());

function renderForm(availability = NUITS) {
  return render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <LodgingReservationForm
        productId="p"
        priceCop={20000} priceTiers={null} maxQty={6} lodgingKind="dorm"
        isPmsBacked={false} availability={availability} rates={[]}
      />
    </NextIntlClientProvider>
  );
}

const jour = (iso: string) => document.querySelector(`[data-date="${iso}"]`) as HTMLButtonElement | null;
const cliquable = (iso: string) => jour(iso)?.disabled === false;
const avertissement = () => screen.queryByTestId("range-unavailable-warning");
const setQty = (v: string) => fireEvent.change(screen.getByTestId("lodging-qty-input"), { target: { value: v } });

describe("la plage ne peut plus enjamber une nuit pleine", () => {
  it("LA RECETTE — 20 → 27 décembre par-dessus une nuit pleine n'est plus sélectionnable", () => {
    renderForm();
    expect(cliquable("2026-12-27")).toBe(true); // avant tout clic, une arrivée au 27 est légitime

    fireEvent.click(jour("2026-12-20")!);

    // La nuit du 23 est pleine : au-delà d'elle, plus rien n'est atteignable depuis le 20.
    expect(cliquable("2026-12-27")).toBe(false);
    expect(cliquable("2026-12-25")).toBe(false);
    expect(cliquable("2026-12-24")).toBe(false);
    // Et l'avertissement n'a jamais eu l'occasion de parler.
    expect(avertissement()).toBeNull();
  });

  it("la sortie LE MATIN de la nuit pleine reste possible — on dort jusqu'à la veille", () => {
    renderForm();
    fireEvent.click(jour("2026-12-20")!);

    // Le 23 porte une nuit pleine, et reste pourtant cliquable : comme date de SORTIE. C'est le
    // point qu'aucune des deux bibliothèques ne sait exprimer (bornes hautes inclusives).
    expect(cliquable("2026-12-23")).toBe(true);
    fireEvent.click(jour("2026-12-23")!);

    expect(avertissement()).toBeNull();
    expect((screen.getByTestId("add-to-cart-button") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("3 noches")).toBeTruthy(); // 20, 21, 22
  });

  it("recule aussi : depuis le 27, on ne peut pas arriver avant la nuit pleine du 24", () => {
    renderForm();
    fireEvent.click(jour("2026-12-27")!);

    expect(cliquable("2026-12-25")).toBe(true);  // dormir 25 et 26, sortir le 27
    expect(cliquable("2026-12-24")).toBe(false); // la nuit du 24 est pleine : arrivée impossible
    expect(cliquable("2026-12-22")).toBe(false); // et rien au-delà
    expect(avertissement()).toBeNull();
  });

  it("une nuit PLEINE n'est plus une arrivée possible — elle était barrée, mais cliquable", () => {
    renderForm();
    expect(jour("2026-12-23")?.disabled).toBe(true);
    expect(jour("2026-12-24")?.disabled).toBe(true);
  });

  it("le seuil est la quantité demandée, pas zéro : le calendrier se resserre quand elle monte", () => {
    renderForm();
    fireEvent.click(jour("2026-12-28")!);
    expect(cliquable("2026-12-30")).toBe(true); // à 1 place, la nuit du 29 passe

    setQty("3");
    // La nuit du 29 n'a que 2 places : à 3, elle bloque, et le 30 sort de la fenêtre.
    expect(cliquable("2026-12-30")).toBe(false);
    expect(cliquable("2026-12-29")).toBe(true); // toujours atteignable comme SORTIE
    expect(avertissement()).toBeNull();
  });

  it("monter la quantité au-delà de la plage posée la ramène au plafond, la plage reste", () => {
    // Depuis le 2026-10-24 (RM201), le plafond Lobby du 2026-10-23 vaut pour tout logement : avec une
    // plage posée, la nuit la moins fournie borne la saisie. Avant, la saisie de 3 repliait la plage
    // sur l'arrivée.
    renderForm();
    fireEvent.click(jour("2026-12-28")!);
    fireEvent.click(jour("2026-12-30")!); // 2 nuits : 28 et 29
    expect(avertissement()).toBeNull();
    expect(screen.getByText("2 noches")).toBeTruthy();

    setQty("3"); // la nuit du 29 n'a que 2 places
    expect(avertissement()).toBeNull();
    expect((screen.getByTestId("lodging-qty-input") as HTMLInputElement).value).toBe("2");
    expect(screen.getByText("2 noches")).toBeTruthy();
  });

  it("l'horizon de six mois borne la fenêtre, il ne la laisse pas la déborder", () => {
    // Tout est libre : la marche avant doit s'arrêter à l'horizon, pas courir indéfiniment.
    const toutLibre = Array.from({ length: 31 }, (_, i) => ({
      date: `2026-12-${String(i + 1).padStart(2, "0")}`, capacity: 4, booked: 0,
    }));
    renderForm(toutLibre);
    fireEvent.click(jour("2026-12-10")!);
    expect(cliquable("2026-12-31")).toBe(true);
    expect(avertissement()).toBeNull();
  });
});
