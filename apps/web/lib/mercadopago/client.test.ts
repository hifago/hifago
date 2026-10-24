// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCheckoutPreference,
  getMercadoPagoPayment,
  ORDER_EXPIRY_MINUTES,
  PREFERENCE_DEADLINE_MS,
  PREFERENCE_EXPIRY_MARGIN_MINUTES,
  PREFERENCE_REQUEST_BOUNDS,
  PAYMENT_LOOKUP_BOUNDS,
  PAYMENT_LOOKUP_DEADLINE_MS,
} from "./client";

// Les bornes de la création de préférence, prouvées contre le VRAI SDK `mercadopago` (aucun mock du
// module) : seul le `fetch` global qu'il appelle est simulé, et le temps est factice. Un mock du SDK
// aurait vérifié qu'on lui passe des options, pas qu'il les applique — or ses propres types se
// trompent déjà sur son délai par défaut (10 s annoncées, 60 s réelles).

const INPUT = {
  paymentId: "44444444-4444-4444-8444-444444444444",
  amountCop: 17000,
  payerEmail: "cliente@test.local",
  successUrl: "https://hifago.test/reserva/t?payment=approved",
  pendingUrl: "https://hifago.test/reserva/t?payment=pending",
  failureUrl: "https://hifago.test/reserva/t?payment=rejected",
  notificationUrl: "https://hifago.test/api/payments/webhook?source_news=webhooks",
  expiresAt: "2030-01-01T00:00:00.000+00:00",
};

/** Attente du SDK avant sa nouvelle tentative (hors 429) : `computeDelay(0, 1000, …)` = 1 s. */
const ATTENTE_AVANT_NOUVEL_ESSAI_MS = 1_000;
let fetchMock: ReturnType<typeof vi.fn>;

/** Une requête qui ne répond jamais : seule l'annulation par le délai du SDK la termine. */
function silencieuse(_url: string, init: RequestInit) {
  return new Promise<Response>((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

function preferenceCreee() {
  return new Response(JSON.stringify({ id: "pref-1", init_point: "https://mp.test/init", collector_id: 1 }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "TEST-jeton-factice");
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("createCheckoutPreference — bornes explicites (SDK réel)", () => {
  it("abandonne après 2 tentatives de 8 s (17 s), jamais les 60 s × 4 du SDK", async () => {
    fetchMock.mockImplementation(silencieuse);
    const issue = createCheckoutPreference(INPUT).then(
      () => "résolue",
      (error: Error) => error
    );

    await vi.advanceTimersByTimeAsync(PREFERENCE_REQUEST_BOUNDS.timeout - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Délai dépassé → une seule nouvelle tentative, 1 s plus tard.
    await vi.advanceTimersByTimeAsync(1 + ATTENTE_AVANT_NOUVEL_ESSAI_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(PREFERENCE_REQUEST_BOUNDS.timeout);
    const resultat = await issue;
    expect(resultat).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("plafonne l'attente d'un 429 à 2 s même si Mercado Pago demande 30 s", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "30" } }))
      .mockResolvedValueOnce(preferenceCreee());
    const issue = createCheckoutPreference(INPUT);

    await vi.advanceTimersByTimeAsync(PREFERENCE_REQUEST_BOUNDS.maxDelay);
    expect(fetchMock).toHaveBeenCalledTimes(2); // relancée à 2 s, pas à 30 s
    await expect(issue).resolves.toMatchObject({ initPoint: "https://mp.test/init", preferenceId: "pref-1" });
  });

  it("envoie notre payment_id comme clé d'idempotence, aussi sur la nouvelle tentative", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(preferenceCreee());
    const issue = createCheckoutPreference(INPUT);
    await vi.advanceTimersByTimeAsync(ATTENTE_AVANT_NOUVEL_ESSAI_MS);
    await issue;

    const cles = fetchMock.mock.calls.map(
      ([, init]) => (init as RequestInit & { headers: Record<string, string> }).headers["X-Idempotency-Key"]
    );
    expect(cles).toEqual([INPUT.paymentId, INPUT.paymentId]);
  });

  // Le délai du SDK s'arrête aux en-têtes : un corps qui cale n'était borné par rien, et la route
  // finissait coupée par la plateforme. L'échéance globale le couvre.
  it("abandonne à l'échéance globale quand le corps de la réponse ne vient jamais", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new ReadableStream({ start() {} }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    const issue = createCheckoutPreference(INPUT).then(
      () => "résolue",
      (error: Error) => error
    );

    await vi.advanceTimersByTimeAsync(PREFERENCE_DEADLINE_MS - 1);
    let reglee = false;
    void issue.then(() => {
      reglee = true;
    });
    await Promise.resolve();
    expect(reglee).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await issue).toBeInstanceOf(Error);
  });

  it("l'échéance globale ne coupe pas le pire cas légitime des bornes du SDK", () => {
    const b = PREFERENCE_REQUEST_BOUNDS;
    expect(PREFERENCE_DEADLINE_MS).toBeGreaterThan((b.maxRetries + 1) * b.timeout + b.maxRetries * b.maxDelay);
  });

  // `Preference.create` fusionne ses options dans la config qu'on lui donne : la préférence et le GET
  // ont chacun la leur, et la première ne déteint jamais sur le second.
  it("ne déteint pas sur le GET du webhook, qui garde SES bornes", async () => {
    fetchMock.mockResolvedValueOnce(preferenceCreee());
    await createCheckoutPreference(INPUT);

    fetchMock.mockImplementation(silencieuse);
    void getMercadoPagoPayment("1").catch(() => undefined);
    await vi.advanceTimersByTimeAsync(PAYMENT_LOOKUP_BOUNDS.timeout - 1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // la préférence, puis le GET encore dans sa 1re tentative
    await vi.advanceTimersByTimeAsync(1 + ATTENTE_AVANT_NOUVEL_ESSAI_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 6 s (pas 8) : ce sont bien les bornes du GET
  });
});

// Bug anti-fraude du 2026-10-23 (`cc_rejected_high_risk`) : on prouve ici le CORPS réellement posté à
// Mercado Pago par le vrai SDK — c'est la seule trace de ce que la préférence contient, l'`init_point`
// que reçoit le navigateur n'en dit rien.
describe("createCheckoutPreference — corps de la préférence (SDK réel)", () => {
  const ITEMS = [
    { id: "line-a", title: "Anticipo – Kayak · Casa Kayam", description: "2026-11-12 · cantidad 2", category_id: "tickets", quantity: 1, currency_id: "COP" as const, unit_price: 10000, category_descriptor: { event_date: "2026-11-12T09:00:00.000-05:00" } },
    { id: "line-b", title: "Anticipo – Cabaña · Casa Kayam", description: "2026-11-20 al 2026-11-23 · cantidad 1", category_id: "travels", quantity: 1, currency_id: "COP" as const, unit_price: 7000 },
  ];

  async function corpsEnvoye(input: Parameters<typeof createCheckoutPreference>[0]) {
    fetchMock.mockResolvedValueOnce(preferenceCreee());
    await createCheckoutPreference(input);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  it("envoie le détail des items tel que construit, au montant facturé", async () => {
    const corps = await corpsEnvoye({ ...INPUT, items: ITEMS });
    const items = corps.items as { unit_price: number; quantity: number }[];
    expect(items).toEqual(ITEMS);
    expect(items.reduce((total, item) => total + item.unit_price * item.quantity, 0)).toBe(INPUT.amountCop);
  });

  it("sans détail : UN item agrégé au montant facturé, avec la référence de la commande", async () => {
    const corps = await corpsEnvoye({ ...INPUT, reference: "HFG-000042" });
    expect(corps.items).toEqual([
      {
        id: INPUT.paymentId,
        title: "Anticipo de reserva Hifago",
        description: "Reserva HFG-000042",
        category_id: "travels",
        quantity: 1,
        currency_id: "COP",
        unit_price: INPUT.amountCop,
      },
    ]);
  });

  // Défense en profondeur : un futur appelant qui passerait un détail de somme différente ne doit
  // jamais faire payer un autre montant que celui de `payments.amount_cop`.
  it("ignore un détail dont la somme n'égale pas le montant facturé", async () => {
    const corps = await corpsEnvoye({ ...INPUT, amountCop: 99000, items: ITEMS });
    const items = corps.items as { id: string; unit_price: number }[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: INPUT.paymentId, unit_price: 99000 });
  });

  it("ignore un détail vide", async () => {
    const corps = await corpsEnvoye({ ...INPUT, items: [] });
    expect(corps.items as unknown[]).toHaveLength(1);
  });

  it("envoie l'e-mail, le prénom, le nom et le téléphone de l'acheteur", async () => {
    const corps = await corpsEnvoye({
      ...INPUT,
      payerIdentity: { name: "Camila", surname: "Gómez", phone: { area_code: "57", number: "3001234567" } },
    });
    expect(corps.payer).toEqual({
      email: "cliente@test.local",
      name: "Camila",
      surname: "Gómez",
      phone: { area_code: "57", number: "3001234567" },
    });
  });

  it("envoie le titulaire même sans e-mail — avant ce lot, le payer disparaissait avec lui", async () => {
    const corps = await corpsEnvoye({ ...INPUT, payerEmail: null, payerIdentity: { name: "Camila" } });
    expect(corps.payer).toEqual({ name: "Camila" });
  });

  it("n'envoie aucun payer quand on ne sait rien de l'acheteur", async () => {
    const corps = await corpsEnvoye({ ...INPUT, payerEmail: null });
    expect(corps).not.toHaveProperty("payer");
  });

  it("n'envoie jamais de document, d'adresse ni de date de création du payer", async () => {
    const corps = await corpsEnvoye({
      ...INPUT,
      payerIdentity: { name: "Camila", surname: "Gómez", phone: { area_code: "57", number: "3001234567" } },
    });
    for (const champ of ["identification", "address", "date_created"]) {
      expect(corps.payer).not.toHaveProperty(champ);
    }
  });

  it("pose le libellé du relevé de carte, sous les 13 caractères permis", async () => {
    const corps = await corpsEnvoye(INPUT);
    expect(corps.statement_descriptor).toBe("HIFAGO");
    expect(String(corps.statement_descriptor).length).toBeLessThanOrEqual(13);
  });

  // `binary_mode: true` retire à Mercado Pago la revue manuelle et fait baisser l'approbation.
  it("n'active jamais binary_mode et n'envoie pas d'additional_info", async () => {
    const corps = await corpsEnvoye(INPUT);
    expect(corps).not.toHaveProperty("binary_mode");
    expect(corps).not.toHaveProperty("additional_info");
  });

  it("garde expiration, retours, notification et exclusion des paiements hors ligne", async () => {
    const corps = await corpsEnvoye(INPUT);
    expect(corps).toMatchObject({
      external_reference: INPUT.paymentId,
      expires: true,
      expiration_date_to: INPUT.expiresAt,
      auto_return: "approved",
      notification_url: INPUT.notificationUrl,
      back_urls: { success: INPUT.successUrl, pending: INPUT.pendingUrl, failure: INPUT.failureUrl },
      payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },
    });
  });
});

// Le GET de re-confirmation du webhook (P5a) : borné comme la préférence, plus serré — Mercado Pago
// n'attend pas longtemps la réponse d'un webhook, et un 502 rapide le fait retenter proprement.
describe("getMercadoPagoPayment — bornes explicites (SDK réel)", () => {
  function paiement() {
    return new Response(JSON.stringify({ id: 1, status: "approved", transaction_amount: 17000 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("abandonne après 2 tentatives de 6 s (13 s), jamais les 60 s × 4 du SDK", async () => {
    fetchMock.mockImplementation(silencieuse);
    const issue = getMercadoPagoPayment("1").then(
      () => "résolue",
      (error: Error) => error
    );
    await vi.advanceTimersByTimeAsync(PAYMENT_LOOKUP_BOUNDS.timeout - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 + ATTENTE_AVANT_NOUVEL_ESSAI_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(PAYMENT_LOOKUP_BOUNDS.timeout);
    expect(await issue).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("plafonne l'attente d'un 429 à 1 s même si Mercado Pago demande 30 s", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "30" } }))
      .mockResolvedValueOnce(paiement());
    const issue = getMercadoPagoPayment("1");
    await vi.advanceTimersByTimeAsync(PAYMENT_LOOKUP_BOUNDS.maxDelay);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(issue).resolves.toMatchObject({ status: "approved", transaction_amount: 17000 });
  });

  it("abandonne à l'échéance globale de 15 s quand le corps ne vient jamais", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    const issue = getMercadoPagoPayment("1").then(
      () => "résolue",
      (error: Error) => error
    );
    await vi.advanceTimersByTimeAsync(PAYMENT_LOOKUP_DEADLINE_MS - 1);
    let reglee = false;
    void issue.then(() => {
      reglee = true;
    });
    await Promise.resolve();
    expect(reglee).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await issue).toBeInstanceOf(Error);
  });

  it("l'échéance globale ne coupe pas le pire cas légitime des bornes du GET", () => {
    const b = PAYMENT_LOOKUP_BOUNDS;
    expect(PAYMENT_LOOKUP_DEADLINE_MS).toBeGreaterThan((b.maxRetries + 1) * b.timeout + b.maxRetries * b.maxDelay);
  });
});

// Contrat partagé avec la base : `public.order_payment_deadline` (migration 20261001194704) refuse
// `order_expiring` à 28 min, dans create_payment_intent et (moins le bail) dans le claim Lobby.
// scripts/check-payment-deadline.sh compare aussi la copie Deno ; ce test garde le côté TypeScript.
describe("limite de paiement — contrat avec la base", () => {
  it("30 − 2 = 28 min (le côté SQL est comparé par scripts/check-payment-deadline.sh)", () => {
    expect(ORDER_EXPIRY_MINUTES - PREFERENCE_EXPIRY_MARGIN_MINUTES).toBe(28);
  });
});
