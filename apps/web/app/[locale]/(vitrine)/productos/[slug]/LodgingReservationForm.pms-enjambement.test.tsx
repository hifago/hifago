import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { LodgingReservationForm } from "./LodgingReservationForm";
import { loadMessages } from "@/messages";

const messages = loadMessages("es");

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...p }: React.ComponentProps<"a">) => <a href={href} {...p}>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ lines: [], addLine: vi.fn() }) }));

// ---------------------------------------------------------------------------------------------
// LE CROISEMENT QUI N'ÉTAIT COUVERT NULLE PART — ajouté le 2026-09-17.
//
// Deux fichiers voisins tiennent chacun une moitié de la règle, et aucun ne tient les deux :
//   - LodgingReservationForm.enjambement.test.tsx couvre « une plage ne peut plus enjamber une
//     nuit pleine » (correctif du 2026-08-29) mais sur `isPmsBacked={false}`, donc sur des nuits
//     passées en PROP depuis le serveur ;
//   - LodgingReservationForm.restrictions.test.tsx couvre le chemin PMS (fetch stubbé) mais sur un
//     mois ENTIÈREMENT LIBRE — aucune nuit pleine, donc jamais de fenêtre à resserrer.
//
// Le croisement des deux — PMS-backed ET nuit pleine ET plage qui l'enjambe — n'existait dans aucun
// test. C'est précisément le cas que `reserve-lodging-pms-availability.spec.ts` prétendait couvrir,
// et qu'il ne couvrait plus depuis qu'il time-out (il attendait le comportement d'AVANT le
// 2026-08-29 : la plage fautive se formait puis était dénoncée, alors qu'elle est désormais
// empêchée). Un e2e mort est un trou silencieux : ce fichier le ferme au palier qui convient.
//
// Ce qui change par rapport au chemin non-PMS : les nuits n'arrivent pas en prop mais par
// /api/pms/night-availability, donc APRÈS le premier rendu — toute la logique de fenêtre travaille
// sur une map qui se remplit de façon asynchrone. C'est ce qu'on veut vérifier ici.
//
// Horloge figée au 1er décembre 2026, même raison que le fichier voisin : le calendrier ouvre sur
// le mois civil de Guatapé, et sans elle les nuits testées tomberaient dans le passé ou au-delà de
// l'horizon de six mois selon le jour d'exécution.
// ---------------------------------------------------------------------------------------------
const NUITS = [
  ...[19, 20, 21, 22].map((d) => ({ date: `2026-12-${d}`, capacity: 4, booked: 0 })),
  // Les deux nuits pleines : Lobby a répondu, il n'y a plus de place.
  { date: "2026-12-23", capacity: 0, booked: 0 },
  { date: "2026-12-24", capacity: 0, booked: 0 },
  ...[25, 26, 27, 28].map((d) => ({ date: `2026-12-${d}`, capacity: 4, booked: 0 })),
  // Nuit à 2 places : réservable à 1 ou 2, plus au-delà. Sert le piège de la quantité.
  { date: "2026-12-29", capacity: 2, booked: 0 },
  { date: "2026-12-30", capacity: 4, booked: 0 },
  { date: "2026-12-31", capacity: 4, booked: 0 },
];

// Les nuits que la route rend pour le mois SUIVANT. La grille de décembre 2026 affiche les 1er,
// 2 et 3 janvier en débordement (`showOutsideDays`), et c'est tout l'objet du dernier test.
const NUITS_JANVIER = [1, 2, 3, 4].map((d) => ({
  date: `2027-01-0${d}`,
  capacity: 4,
  booked: 0,
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T15:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderPms(nights = NUITS) {
  // Le mock répond PAR MOIS, comme la vraie route (elle ne sert qu'un mois à la fois) : un mock qui
  // renverrait les mêmes nuits quel que soit `month` serait plus complaisant que le service, et le
  // dernier test de ce fichier ne prouverait plus rien.
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const mois = String(url).split("month=")[1];
      const duMois = mois === "2027-01" ? NUITS_JANVIER : nights;
      return Promise.resolve({
        json: async () => ({ ok: true, nights: duMois, restrictedNights: [] }),
      } as Response);
    })
  );
  render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <LodgingReservationForm
        productId="p"
        priceCop={20000} priceTiers={null} maxQty={6} lodgingKind="dorm"
        isPmsBacked availability={[]} rates={[]}
      />
    </NextIntlClientProvider>
  );
  // La map se remplit après le fetch : attendre une nuit LIBRE (une nuit pleine est rendue aussi,
  // mais désactivée — l'attendre ne prouverait pas que les données sont arrivées).
  await waitFor(() => expect(jour("2026-12-20")?.disabled).toBe(false));
}

const jour = (iso: string) => document.querySelector(`[data-date="${iso}"]`) as HTMLButtonElement | null;
const cliquable = (iso: string) => jour(iso)?.disabled === false;
const avertissement = () => screen.queryByTestId("range-unavailable-warning");
const setQty = (v: string) => fireEvent.change(screen.getByTestId("lodging-qty-input"), { target: { value: v } });

describe("PMS-backed : la plage ne peut pas enjamber une nuit pleine annoncée par Lobby", () => {
  it("LA RECETTE — depuis le 20, rien n'est atteignable au-delà de la nuit pleine du 23", async () => {
    await renderPms();
    expect(cliquable("2026-12-27")).toBe(true); // avant tout clic, une arrivée au 27 est légitime

    fireEvent.click(jour("2026-12-20")!);

    expect(cliquable("2026-12-27")).toBe(false);
    expect(cliquable("2026-12-25")).toBe(false);
    expect(cliquable("2026-12-24")).toBe(false);
    // Le refus arrive AVANT le choix, plus après : l'avertissement n'a jamais l'occasion de parler.
    // C'est exactement ce que l'e2e attendait encore, et qui ne peut plus se produire.
    expect(avertissement()).toBeNull();
  });

  it("la sortie LE MATIN de la nuit pleine reste possible — on dort jusqu'à la veille", async () => {
    await renderPms();
    fireEvent.click(jour("2026-12-20")!);

    // Le 23 porte une nuit pleine et reste cliquable : comme date de SORTIE, jamais d'arrivée.
    expect(cliquable("2026-12-23")).toBe(true);
    fireEvent.click(jour("2026-12-23")!);

    expect(avertissement()).toBeNull();
    expect((screen.getByTestId("add-to-cart-button") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("3 noches")).toBeTruthy(); // 20, 21, 22
  });

  it("une nuit pleine n'est pas une arrivée possible", async () => {
    await renderPms();
    expect(jour("2026-12-23")?.disabled).toBe(true);
    expect(jour("2026-12-24")?.disabled).toBe(true);
  });

  it("monter la quantité au-delà de la plage posée la ramène au plafond, la plage reste", async () => {
    // Depuis le 2026-10-23 (bug 6, plafond de lits) : avec une plage posée, le plafond est la nuit
    // la moins fournie de la plage. Avant, la saisie de 3 repliait la plage sur l'arrivée.
    await renderPms();
    fireEvent.click(jour("2026-12-28")!);
    fireEvent.click(jour("2026-12-30")!); // 2 nuits : 28 et 29
    expect(avertissement()).toBeNull();
    expect(screen.getByText("2 noches")).toBeTruthy();

    setQty("3"); // la nuit du 29 n'a que 2 places
    expect(avertissement()).toBeNull();
    expect((screen.getByTestId("lodging-qty-input") as HTMLInputElement).value).toBe("2");
    expect(screen.getByText("2 noches")).toBeTruthy();
  });

  it("avec la seule arrivée posée, monter la quantité replie encore la sélection", async () => {
    await renderPms();
    fireEvent.click(jour("2026-12-29")!); // arrivée seule, nuit à 2 places
    setQty("3");
    // L'arrivée ne tient plus 3 : la sélection repart de zéro (repli de handleQtyChange) — la
    // quantité n'est pas bridée par une plage qui n'existe pas encore, et « Borrar » n'a plus rien
    // à effacer.
    expect((screen.getByTestId("lodging-qty-input") as HTMLInputElement).value).toBe("3");
    expect((screen.getByTestId("calendar-clear") as HTMLButtonElement).disabled).toBe(true);
  });

  it("une nuit ABSENTE de la réponse Lobby se comporte comme une nuit pleine", async () => {
    // Le cas mesuré en préprod (un mois servi à 29/30 nuits) et l'acquis du 2026-08-28 : une nuit
    // que Lobby n'a pas cotée n'est PAS réservable — fail-closed par omission, jamais un trou
    // qu'on comblerait en supposant « disponible ». Distinct de `capacity: 0`, qui est une réponse.
    const nuitsAvecTrou = NUITS.filter((n) => n.date !== "2026-12-26");
    await renderPms(nuitsAvecTrou);

    expect(jour("2026-12-26")?.disabled).toBe(true);

    fireEvent.click(jour("2026-12-25")!);
    // On peut sortir le 26 (on dort la nuit du 25), mais pas le traverser.
    expect(cliquable("2026-12-26")).toBe(true);
    expect(cliquable("2026-12-27")).toBe(false);
    expect(avertissement()).toBeNull();
  });

  it("une plage qui DÉBORDE sur le mois suivant est sélectionnable sans paginer d'abord", async () => {
    // LE DÉFAUT (a), mesuré le 2026-09-17. La grille de décembre affiche les premiers jours de
    // janvier (`showOutsideDays`), mais la route ne sert QU'UN mois : ces jours étaient absents de
    // `pmsAvailability`, donc désactivés par omission — une plage du 30 décembre au 2 janvier était
    // refusée SANS un mot, et il fallait deviner qu'il fallait paginer vers janvier d'abord.
    // Depuis, le mois suivant est préchargé.
    await renderPms();
    // La donnée de janvier arrive par un SECOND appel : l'attendre explicitement, sinon on
    // mesurerait l'instant d'avant.
    await waitFor(() => expect(jour("2027-01-02")?.disabled).toBe(false));

    fireEvent.click(jour("2026-12-30")!);
    // Deux nuits (30 et 31) puis sortie le 1er, ou trois nuits et sortie le 2 : dans les deux cas
    // la date de sortie appartient à janvier et doit être atteignable depuis la grille de décembre.
    expect(cliquable("2027-01-01")).toBe(true);
    expect(cliquable("2027-01-02")).toBe(true);

    fireEvent.click(jour("2027-01-02")!);
    expect(avertissement()).toBeNull();
    expect(screen.getByText("3 noches")).toBeTruthy(); // 30, 31, 1er
  });
});

describe("PMS-backed : le plafond de quantité suit les places restantes (2026-10-23)", () => {
  const maxChamp = () => Number((screen.getByTestId("lodging-qty-input") as HTMLInputElement).max);

  it("sans plage : le maximum des nuits chargées, borné par max_qty (4, pas 6)", async () => {
    await renderPms();
    expect(maxChamp()).toBe(4);
  });

  it("sur une plage : la nuit la moins fournie (29 déc., 2 lits) borne le champ", async () => {
    await renderPms();
    fireEvent.click(jour("2026-12-28")!);
    fireEvent.click(jour("2026-12-30")!); // nuits 28 (4) et 29 (2)
    expect(maxChamp()).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// LE SEMIS — plus d'appel à LobbyPMS au chargement (2026-09-18, décision Gabriel).
//
// Avant : un logement PMS-backed recevait `availability={[]}` (product_availability est
// structurellement vide pour lui) et le calendrier partait ENTIÈREMENT GRISÉ le temps d'un
// aller-retour réseau — une fiche qui a l'air complète alors qu'elle charge. Chaque visiteur
// coûtait un appel, y compris l'immense majorité qui ne réserve jamais.
//
// Maintenant : le Server Component lit le miroir (une requête SQL locale, dans le même Promise.all
// que le reste de la fiche) et le passe en `availability`. Le calendrier est juste dès la première
// image, sans réseau. L'appel à Lobby devient le REPLI d'un mois que le miroir ne couvre pas.
//
// La barrière de réservation ne bouge pas : check-nights interroge Lobby à chaud avant toute
// confirmation et refuse si ça ne colle plus (spec 24 §0).
// ---------------------------------------------------------------------------------------------
// ⚠️ Le semis par défaut couvre DEUX mois, et ce n'est pas du zèle : le composant précharge le mois
// visible ET le suivant (défaut des jours débordants, corrigé le 2026-09-17), et le vrai serveur
// sème tout l'horizon de six mois. Un semis d'un seul mois laisserait donc partir un fetch pour
// janvier et le test « aucun appel réseau » mesurerait une situation qui n'existe pas en production.
type RestrictionSemee = {
  date: string;
  restrictions: { minStay: number | null; maxStay: number | null; leadDays: number | null };
};

function renderAvecSemis(
  semis = [...NUITS, ...NUITS_JANVIER],
  restrictedNights: RestrictionSemee[] = []
) {
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ ok: true, nights: [], restrictedNights: [] }),
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  render(
    <NextIntlClientProvider locale="es" messages={{ ProductPage: messages.ProductPage, Common: messages.Common }}>
      <LodgingReservationForm
        productId="p"
        priceCop={20000} priceTiers={null} maxQty={6} lodgingKind="dorm"
        isPmsBacked availability={semis} restrictedNights={restrictedNights} rates={[]}
      />
    </NextIntlClientProvider>
  );
  return fetchMock;
}

describe("le semis depuis le miroir remplace l'appel LobbyPMS au chargement", () => {
  it("LE POINT DU LOT — le calendrier est utilisable sans AUCUN appel réseau", () => {
    const fetchMock = renderAvecSemis();

    // Pas de `waitFor` : c'est tout l'objet du test. Si la donnée n'était pas là au premier rendu,
    // ces assertions tomberaient — un `waitFor` les rendrait vraies de toute façon et ne prouverait
    // plus rien.
    expect(cliquable("2026-12-20")).toBe(true);
    expect(jour("2026-12-23")?.disabled).toBe(true); // la nuit pleine, connue sans réseau
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("la règle d'enjambement s'applique sur le semis, exactement comme sur les données fetchées", () => {
    renderAvecSemis();
    fireEvent.click(jour("2026-12-20")!);

    expect(cliquable("2026-12-27")).toBe(false);
    expect(cliquable("2026-12-23")).toBe(true); // sortie le matin de la nuit pleine
    expect(avertissement()).toBeNull();
  });

  it("les restrictions Lobby semées sont appliquées — sans elles, un min_stay serait perdu", () => {
    // Sans le semis des restrictions, il n'y aurait plus AUCUN moment où elles arrivent : le fetch
    // qui les rapportait ne part plus. Le trou serait silencieux, d'où ce test.
    renderAvecSemis(NUITS, [
      { date: "2026-12-19", restrictions: { minStay: 3, maxStay: null, leadDays: null } },
    ]);
    fireEvent.click(jour("2026-12-19")!);

    // CHECK-OUT EXCLUSIF : trois nuits (19, 20, 21) se terminent le 22, jamais le 20 ni le 21.
    expect(cliquable("2026-12-20")).toBe(false);
    expect(cliquable("2026-12-21")).toBe(false);
    expect(cliquable("2026-12-22")).toBe(true);
  });

  it("LE REPLI — un mois que le miroir ne couvre pas est bien redemandé à Lobby", async () => {
    // Miroir vide (cron arrêté, connecteur tout juste activé) : le comportement d'avant reprend la
    // main, plutôt que de promettre des dates sur rien.
    const fetchMock = renderAvecSemis([]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});

