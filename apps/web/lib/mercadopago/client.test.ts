// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCheckoutPreference,
  getMercadoPagoPayment,
  PREFERENCE_DEADLINE_MS,
  PREFERENCE_REQUEST_BOUNDS,
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

  // `Preference.create` fusionne ses options dans la config qu'on lui donne : sur la config partagée,
  // le GET du webhook hériterait du délai de 8 s et de la nouvelle tentative. Il garde ici les valeurs
  // du SDK — les borner relève de la route du webhook.
  it("ne laisse pas ses bornes sur la config partagée qu'utilise le webhook", async () => {
    fetchMock.mockResolvedValueOnce(preferenceCreee());
    await createCheckoutPreference(INPUT);

    fetchMock.mockImplementation(silencieuse);
    void getMercadoPagoPayment("1").catch(() => undefined);
    await vi.advanceTimersByTimeAsync(PREFERENCE_REQUEST_BOUNDS.timeout + PREFERENCE_REQUEST_BOUNDS.maxDelay + 1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // la préférence, puis UN SEUL GET encore en attente
  });
});
