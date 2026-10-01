import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { Suspense, use, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";
import type { OrderForDisplay } from "@/lib/orders/getOrderByToken";
import { bookingRecovery, OrderResult } from "./OrderResult";

// Depuis la migration 20260930221837, `create_payment_intent` refuse `pms_booking_missing` tant
// qu'une nuit PMS n'a pas son booking (client parti avant la fin du tunnel, onglet fermé pendant
// l'appel à Lobby). Sans ce lot, l'écran affichait « unknown » et le client restait bloqué : ce
// fichier prouve qu'il relance reserve-nights UNE fois, puis redemande UN intent, sans boucle.

const refreshMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

type IntentResponse = { data: unknown; error: unknown };
let intentResponses: IntentResponse[] = [];
const rpcMock = vi.fn();
vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    rpc: (name: string, args: unknown) => {
      rpcMock(name, args);
      return Promise.resolve(intentResponses.shift() ?? { data: null, error: { message: "épuisé" } });
    },
  }),
}));

const ORDER: OrderForDisplay = {
  id: "commande-1",
  reference: "HFG-000042",
  paymentStatus: "unpaid",
  holderName: "Ana Pérez",
  holderPhone: null,
  holderEmail: "ana@test.local",
  totalCop: 200000,
  acompteCop: 34000,
  paymentReceivedNotHonored: false,
  refundStatus: null,
  lines: [
    {
      id: "ligne-1",
      productName: "Habitación doble",
      establishmentName: "Casa Kayam",
      date: "2029-04-01",
      endDate: "2029-04-03",
      durationDays: null,
      slotStartTime: null,
      qty: 1,
      totalCop: 200000,
      acompteCop: 34000,
      status: "reserved",
      establishmentSlug: null,
      establishmentContactUrl: null,
    },
  ],
};

const es = loadMessages("es").OrderResultPage;
const fetchMock = vi.fn();
let reserveNightsResponse: () => Promise<Response>;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  refreshMock.mockReset();
  rpcMock.mockClear();
  intentResponses = [];
  fetchMock.mockReset();
  // payments/create répond 503 : le test s'arrête avant la redirection vers Mercado Pago, et
  // regarde seulement avec quel paiement elle a été demandée.
  fetchMock.mockImplementation((url: string) =>
    url === "/api/pms/reserve-nights"
      ? reserveNightsResponse()
      : Promise.resolve(json(503, { ok: false, reason: "mercadopago_unavailable" }))
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ecran(order: OrderForDisplay) {
  return (
    <NextIntlClientProvider locale="es" messages={loadMessages("es")}>
      <OrderResult order={order} locale="es" isRealAccount paymentOutcome={null} />
    </NextIntlClientProvider>
  );
}

function rendre() {
  return render(ecran(ORDER)).container;
}

/** La commande telle que l'écran la relit après un relâchement : plus aucune ligne vivante. */
const COMMANDE_DEFAITE: OrderForDisplay = {
  ...ORDER,
  totalCop: 0,
  acompteCop: 0,
  lines: ORDER.lines.map((line) => ({ ...line, status: "cancelled_by_provider" })),
};

async function payer(container: HTMLElement) {
  await act(async () => {
    fireEvent.click(container.querySelector('[data-testid="pay-button"]')!);
  });
}

const appelsReserveNights = () => fetchMock.mock.calls.filter(([url]) => url === "/api/pms/reserve-nights");
const appelsPaymentsCreate = () => fetchMock.mock.calls.filter(([url]) => url === "/api/payments/create");
const manquant = { data: { ok: false, reason: "pms_booking_missing" }, error: null };

describe("OrderResult — pms_booking_missing : reserve-nights, puis UN seul nouvel intent", () => {
  it("booking posé → un second intent, et le paiement part avec SON payment_id", async () => {
    intentResponses = [manquant, { data: { ok: true, payment_id: "paiement-2" }, error: null }];
    reserveNightsResponse = async () => json(200, { ok: true });
    const container = rendre();
    await payer(container);

    expect(appelsReserveNights()).toHaveLength(1);
    expect(JSON.parse(String(appelsReserveNights()[0][1].body))).toEqual({ orderId: "commande-1" });
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(appelsPaymentsCreate()).toHaveLength(1);
    expect(JSON.parse(String(appelsPaymentsCreate()[0][1].body))).toEqual({ paymentId: "paiement-2" });
  });

  it("jamais de boucle : un second pms_booking_missing s'arrête sur « unknown »", async () => {
    intentResponses = [manquant, manquant, manquant];
    reserveNightsResponse = async () => json(200, { ok: true });
    const container = rendre();
    await payer(container);

    expect(appelsReserveNights()).toHaveLength(1);
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(appelsPaymentsCreate()).toHaveLength(0);
    expect(container.querySelector('[data-testid="payment-error"]')?.textContent).toBe(es.errors.unknown);
  });

  it("commande relâchée → relit l'écran avec la raison, sans l'état « failed » ni second intent", async () => {
    intentResponses = [manquant];
    reserveNightsResponse = async () => json(409, { ok: false, reason: "pms_refused", released: true });
    const { container, rerender } = render(ecran(ORDER));
    await payer(container);

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="pms-notice"]')?.textContent).toBe(es.errors.pms_refused);
    expect(container.querySelector('[data-testid="order-state-failed"]')).toBeNull();
    expect(container.querySelector('[data-testid="payment-error"]')).toBeNull();

    // L'écran relu (ce que `router.refresh` rend) : la raison reste affichée au-dessus de l'état réel.
    await act(async () => {
      rerender(ecran(COMMANDE_DEFAITE));
    });
    expect(container.querySelector('[data-testid="order-state-cancelled"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pms-notice"]')?.textContent).toBe(es.errors.pms_refused);
    expect(container.querySelector('[data-testid="pay-button"]')).toBeNull();
  });

  it("relâchement impossible → raison affichée, et plus de bouton : un nouvel essai rappellerait Lobby", async () => {
    intentResponses = [manquant];
    reserveNightsResponse = async () => json(409, { ok: false, reason: "pms_refused", released: false });
    const container = rendre();
    await payer(container);

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="pms-notice"]')?.textContent).toBe(
      es.errors.pms_refused_pending
    );
    expect(container.querySelector('[data-testid="order-state-failed"]')).toBeNull();
    // La commande relue est toujours « à payer » (rien n'a été défait) : le bouton reste retiré.
    expect(container.querySelector('[data-testid="order-state-unpaid"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pay-button"]')).toBeNull();
    // …et l'écran ne dit plus « Paga el anticipo » sous une page sans bouton.
    expect(container.textContent).not.toContain(es.status.unpaidDetail);
  });

  it("pendant l'appel à Lobby, le bouton dit qu'on confirme, pas qu'on part chez Mercado Pago", async () => {
    intentResponses = [manquant];
    let repondre: (response: Response) => void = () => undefined;
    reserveNightsResponse = () =>
      new Promise<Response>((resolve) => {
        repondre = resolve;
      });
    const container = rendre();
    await payer(container);

    const bouton = container.querySelector('[data-testid="pay-button"]') as HTMLButtonElement;
    expect(bouton.textContent).toBe(es.confirmingBooking);
    expect(bouton.disabled).toBe(true);
    await act(async () => {
      repondre(json(409, { ok: false, reason: "pms_claim_in_progress", released: false }));
    });
    expect(bouton.textContent).toBe(es.pay);
  });

  // Le vrai `router.refresh` est une transition qui dure le temps de l'aller-retour serveur. Ici, il
  // fait suspendre un voisin jusqu'à ce qu'on le libère : la transition reste en cours, comme en vrai.
  it("bouton tenu pendant toute la relecture de l'écran", async () => {
    intentResponses = [manquant];
    reserveNightsResponse = async () =>
      json(409, { ok: false, reason: "pms_claim_in_progress", released: false });
    let liberer: () => void = () => undefined;
    const relecture = new Promise<void>((resolve) => {
      liberer = resolve;
    });
    let suspendre: (p: Promise<void>) => void = () => undefined;
    function Relecture({ attente }: { attente: Promise<void> | null }) {
      if (attente) use(attente);
      return null;
    }
    function Banc() {
      const [attente, setAttente] = useState<Promise<void> | null>(null);
      suspendre = setAttente;
      return (
        <Suspense fallback={null}>
          <Relecture attente={attente} />
          {ecran(ORDER)}
        </Suspense>
      );
    }
    refreshMock.mockImplementation(() => suspendre(relecture));
    const { container } = render(<Banc />);
    await payer(container);

    const bouton = container.querySelector('[data-testid="pay-button"]') as HTMLButtonElement;
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(bouton.disabled).toBe(true);
    // La notice arrive AVEC l'écran relu, jamais au-dessus de l'ancien.
    expect(container.querySelector('[data-testid="pms-notice"]')).toBeNull();

    await act(async () => {
      liberer();
      await relecture;
    });
    expect((container.querySelector('[data-testid="pay-button"]') as HTMLButtonElement).disabled).toBe(false);
    expect(container.querySelector('[data-testid="pms-notice"]')?.textContent).toBe(
      es.errors.pms_claim_in_progress
    );
  });

  it("une notice précédente s'efface au clic suivant", async () => {
    intentResponses = [manquant, { data: { ok: true, payment_id: "paiement-2" }, error: null }];
    reserveNightsResponse = async () =>
      json(409, { ok: false, reason: "pms_claim_in_progress", released: false });
    const container = rendre();
    await payer(container);
    expect(container.querySelector('[data-testid="pms-notice"]')).not.toBeNull();

    await payer(container);
    expect(container.querySelector('[data-testid="pms-notice"]')).toBeNull();
  });

  it.each(["nothing_to_pay", "already_paid"] as const)(
    "%s (commande défaite ou payée ailleurs) → relit l'écran au lieu d'afficher « failed »",
    async (reason) => {
      intentResponses = [{ data: { ok: false, reason }, error: null }];
      const container = rendre();
      await payer(container);

      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-testid="order-state-failed"]')).toBeNull();
      expect(container.querySelector('[data-testid="pms-notice"]')?.textContent).toBe(es.errors[reason]);
    }
  );

  it("commande déjà payée → relit l'écran, sans message ni paiement", async () => {
    intentResponses = [manquant];
    reserveNightsResponse = async () => json(409, { ok: false, reason: "order_paid", released: false });
    const container = rendre();
    await payer(container);

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(appelsPaymentsCreate()).toHaveLength(0);
    expect(container.querySelector('[data-testid="pms-notice"]')).toBeNull();
    expect(container.querySelector('[data-testid="payment-error"]')).toBeNull();
  });

  it("claim tenu ailleurs → message d'attente, écran relu, bouton toujours là", async () => {
    intentResponses = [manquant];
    reserveNightsResponse = async () =>
      json(409, { ok: false, reason: "pms_claim_in_progress", released: false });
    const container = rendre();
    await payer(container);

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="pms-notice"]')?.textContent).toBe(
      es.errors.pms_claim_in_progress
    );
    expect(container.querySelector('[data-testid="order-state-failed"]')).toBeNull();
    expect(container.querySelector('[data-testid="pay-button"]')).not.toBeNull();
  });

  it("réseau coupé pendant l'appel → issue inconnue, rien n'est payé", async () => {
    intentResponses = [manquant];
    reserveNightsResponse = () => Promise.reject(new TypeError("Failed to fetch"));
    const container = rendre();
    await payer(container);

    expect(appelsPaymentsCreate()).toHaveLength(0);
    expect(container.querySelector('[data-testid="pms-notice"]')?.textContent).toBe(
      es.errors.pms_unknown_outcome
    );
  });

  it("un intent ordinaire ne passe jamais par reserve-nights", async () => {
    intentResponses = [{ data: { ok: true, payment_id: "paiement-1" }, error: null }];
    reserveNightsResponse = async () => json(200, { ok: true });
    const container = rendre();
    await payer(container);

    expect(appelsReserveNights()).toHaveLength(0);
    expect(JSON.parse(String(appelsPaymentsCreate()[0][1].body))).toEqual({ paymentId: "paiement-1" });
  });
});

// Migration 20261001194704 : passé la limite de paiement (28 min ; 23 min pour un claim), le refus
// `order_expiring` peut venir de l'intent, de payments/create ou de reserve-nights. Jamais l'état
// « failed » (« Tu reserva sigue guardada. Puedes intentar el pago de nuevo ») : notice, plus de
// bouton, écran relu.
describe("OrderResult — trop tard pour payer (order_expiring)", () => {
  function attendreArretExpire(container: HTMLElement) {
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="pms-notice"]')?.textContent).toBe(es.errors.order_expiring);
    expect(container.querySelector('[data-testid="order-state-failed"]')).toBeNull();
    expect(container.querySelector('[data-testid="payment-error"]')).toBeNull();
    expect(container.querySelector('[data-testid="pay-button"]')).toBeNull();
    expect(container.textContent).not.toContain(es.status.unpaidDetail);
  }

  it("refusé par l'intent : ni reserve-nights ni payments/create", async () => {
    intentResponses = [{ data: { ok: false, reason: "order_expiring" }, error: null }];
    const container = rendre();
    await payer(container);

    attendreArretExpire(container);
    expect(appelsReserveNights()).toHaveLength(0);
    expect(appelsPaymentsCreate()).toHaveLength(0);
  });

  // Seule fenêtre où payments/create dit `order_expiring` : l'intent a été accepté juste avant la
  // limite, donc il a DÉJÀ passé la commande en `pending`. L'écran relu dit alors « confirmando »
  // (limite connue, jusqu'à l'expiration) — ce test fixe ce comportement réel, sans le maquiller.
  it("refusé par payments/create (409) : jamais une panne de Mercado Pago ; l'écran relu dit « confirmando »", async () => {
    intentResponses = [{ data: { ok: true, payment_id: "paiement-1" }, error: null }];
    fetchMock.mockImplementation((url: string) =>
      url === "/api/payments/create"
        ? Promise.resolve(json(409, { ok: false, reason: "order_expiring" }))
        : Promise.reject(new Error(`appel inattendu : ${url}`))
    );
    const { container, rerender } = render(ecran(ORDER));
    await payer(container);

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="order-state-failed"]')).toBeNull();
    expect(container.querySelector('[data-testid="payment-error"]')).toBeNull();
    expect(container.textContent).not.toContain(es.errors.mercadopago_unavailable);
    await act(async () => {
      rerender(ecran({ ...ORDER, paymentStatus: "pending" }));
    });
    expect(container.querySelector('[data-testid="order-state-awaiting"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pms-notice"]')).toBeNull();
  });

  // Revue adversariale : un onglet resté ouvert sur une commande déjà expirée. Le refus arrive, l'écran
  // relu dit « expirée, fechas liberadas » — la notice « se liberarán » le contredirait.
  it("commande expirée entre-temps : l'écran relu parle seul, sans notice", async () => {
    intentResponses = [{ data: { ok: false, reason: "order_expiring" }, error: null }];
    const { container, rerender } = render(ecran(ORDER));
    await payer(container);
    await act(async () => {
      rerender(ecran({ ...COMMANDE_DEFAITE, lines: ORDER.lines.map((l) => ({ ...l, status: "expired" })) }));
    });
    expect(container.querySelector('[data-testid="order-state-expired"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pms-notice"]')).toBeNull();
  });

  // Toute notice d'arrêt se tait dès qu'un paiement a progressé (l'onglet qui tenait le claim a payé) :
  // « vuelve a intentarlo » sous « confirmando » ou « Pago confirmado » inviterait à payer deux fois.
  // Notice `pms_claim_in_progress` à dessein : celle de l'échéance est déjà tue hors `unpaid`, et ne
  // prouverait rien sur cette liste-ci.
  it.each([
    ["paiement en cours", { paymentStatus: "pending" }, "order-state-awaiting"],
    ["payée", { paymentStatus: "paid" }, "order-state-paid"],
    ["remboursée", { paymentStatus: "refunded" }, "order-state-refunded"],
    ["payée sans rien à honorer", { paymentReceivedNotHonored: true }, "order-state-paid_not_honored"],
  ] as const)("claim tenu ailleurs, puis commande %s : la notice se tait", async (_cas, relue, etat) => {
    intentResponses = [manquant];
    reserveNightsResponse = async () =>
      json(409, { ok: false, reason: "pms_claim_in_progress", released: false });
    const { container, rerender } = render(ecran(ORDER));
    await payer(container);
    expect(container.querySelector('[data-testid="pms-notice"]')).not.toBeNull();
    await act(async () => {
      rerender(ecran({ ...ORDER, ...relue }));
    });
    expect(container.querySelector(`[data-testid="${etat}"]`)).not.toBeNull();
    expect(container.querySelector('[data-testid="pms-notice"]')).toBeNull();
  });

  it("la notice n'arrive qu'avec l'écran relu, jamais au-dessus de l'ancien", async () => {
    intentResponses = [{ data: { ok: false, reason: "order_expiring" }, error: null }];
    let liberer: () => void = () => undefined;
    const relecture = new Promise<void>((resolve) => {
      liberer = resolve;
    });
    let suspendre: (p: Promise<void>) => void = () => undefined;
    function Relecture({ attente }: { attente: Promise<void> | null }) {
      if (attente) use(attente);
      return null;
    }
    function Banc() {
      const [attente, setAttente] = useState<Promise<void> | null>(null);
      suspendre = setAttente;
      return (
        <Suspense fallback={null}>
          <Relecture attente={attente} />
          {ecran(ORDER)}
        </Suspense>
      );
    }
    refreshMock.mockImplementation(() => suspendre(relecture));
    const { container } = render(<Banc />);
    await payer(container);
    expect(container.querySelector('[data-testid="pms-notice"]')).toBeNull();
    await act(async () => {
      liberer();
      await relecture;
    });
    expect(container.querySelector('[data-testid="pms-notice"]')?.textContent).toBe(es.errors.order_expiring);
  });

  it("refusé par le claim pendant la reprise PMS : aucun second intent", async () => {
    intentResponses = [manquant];
    reserveNightsResponse = async () => json(409, { ok: false, reason: "order_expiring", released: false });
    const container = rendre();
    await payer(container);

    attendreArretExpire(container);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe("bookingRecovery — chaque réponse de reserve-nights", () => {
  const arret = (notice: string | null, blockPayment = false) => ({ kind: "stop", notice, blockPayment });
  it.each([
    ["200", true, { ok: true }, { kind: "booked" }],
    ["déjà payée", false, { reason: "order_paid", released: false }, arret(null)],
    ["claim tenu", false, { reason: "pms_claim_in_progress", released: false }, arret("pms_claim_in_progress")],
    ["refus, relâchée", false, { reason: "pms_refused", released: true }, arret("pms_refused")],
    ["refus, relâchement impossible", false, { reason: "pms_refused", released: false }, arret("pms_refused_pending", true)],
    ["connecteur coupé, relâchée", false, { reason: "pms_unavailable", released: true }, arret("pms_unavailable")],
    ["connecteur coupé, relâchement impossible", false, { reason: "pms_unavailable", released: false }, arret("pms_release_pending", true)],
    ["Lobby injoignable, relâchée", false, { reason: "pms_unreachable", released: true }, arret("pms_unreachable")],
    ["Lobby injoignable, relâchement impossible", false, { reason: "pms_unreachable", released: false }, arret("pms_release_pending", true)],
    ["déjà défaite", false, { reason: "order_not_active", released: true }, arret(null)],
    ["504 sans corps", false, null, arret("pms_unknown_outcome")],
    ["erreur de base", false, { reason: "db_error", released: false }, arret("pms_unconfirmed")],
    ["commande introuvable", false, { reason: "order_not_found", released: false }, arret("order_not_found")],
    ["released absent", false, { reason: "pms_refused" }, arret("pms_refused_pending", true)],
    ["trop tard pour payer", false, { reason: "order_expiring", released: false }, arret("order_expiring", true)],
  ] as const)("%s", (_cas, httpOk, corps, attendu) => {
    expect(bookingRecovery(httpOk, corps)).toEqual(attendu);
  });

  it.each(["es", "en"] as const)("chaque message possible existe en %s", (locale) => {
    const page = loadMessages(locale).OrderResultPage as { errors: Record<string, string>; confirmingBooking: string };
    expect(page.confirmingBooking).toBeTruthy();
    for (const key of [
      "pms_refused",
      "pms_refused_pending",
      "pms_release_pending",
      "pms_unavailable",
      "pms_unreachable",
      "pms_claim_in_progress",
      "pms_unknown_outcome",
      "pms_unconfirmed",
      "order_not_found",
      "order_expiring",
      "nothing_to_pay",
      "already_paid",
      "unknown",
    ]) {
      expect(page.errors[key], key).toBeTruthy();
    }
  });
});
