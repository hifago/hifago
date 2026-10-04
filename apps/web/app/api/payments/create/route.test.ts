// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spec 33 — CE FICHIER EXISTE POUR UNE RAISON PRÉCISE : la `back_url` envoyée à Mercado Pago est
// invisible partout ailleurs. Elle part dans la préférence, jamais dans l'`init_point` que le
// navigateur reçoit — donc aucun e2e ne peut la voir, et c'est exactement pour ça que le trou
// corrigé par la spec 33 a survécu : les trois back_urls ont pointé pendant des semaines sur un
// écran devenu vide, sans qu'une seule ligne de test ne regarde.
//
// Les deux invariants vérifiés ici sont ceux qu'un futur lot pourrait casser sans s'en apercevoir :
//   1. la back_url mène à `/reserva/<jeton>` — jamais à `/pago` ;
//   2. elle NE PORTE PAS de préfixe de locale — c'est le `/es` en dur qui faisait basculer toute la
//      session d'un anglophone en espagnol (via la réécriture du cookie NEXT_LOCALE par next-intl).

const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";
const ORDER_ID = "55555555-5555-4555-8555-555555555555";
const ACCESS_TOKEN = "0123456789abcdef0123456789abcdef";
const ORIGINAL_ENV = { ...process.env };

let preferenceInput: Record<string, unknown> | null = null;
type OrderRow = { access_token: string; created_at: string };
/** Commande créée il y a une minute : largement dans la fenêtre d'expiration de 30 min. */
function commandeRecente(): OrderRow {
  return { access_token: ACCESS_TOKEN, created_at: new Date(Date.now() - 60_000).toISOString() };
}
let orderRow: OrderRow | null = commandeRecente();
/** Ce que la route écrit sur `payments` après la création de la préférence (spec 39). */
let paymentUpdate: Record<string, unknown> | null = null;
/** Les signaux d'annulation passés aux deux accès base (P5a : jamais un accès sans délai). */
let signauxBase: AbortSignal[] = [];
/** Erreur rendue par la lecture de `payments` (null = succès). */
let lectureErreur: { message: string } | null = null;

// Le Route Handler lit `payments` AVEC l'embed PostgREST `orders(access_token)` — une seule
// requête, via la FK `payments.order_id → orders.id`. Le mock rend donc la commande imbriquée,
// exactement comme PostgREST le ferait ; `orderRow = null` simule l'embed vide.
vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        eq: () => ({
          abortSignal: async (signal: AbortSignal) => {
            signauxBase.push(signal);
            paymentUpdate = values;
            return { error: null };
          },
        }),
      }),
      select: () => ({
        eq: () => ({
          abortSignal: (signal: AbortSignal) => {
            signauxBase.push(signal);
            return {
              maybeSingle: async () =>
                lectureErreur
                  ? { data: null, error: lectureErreur }
                  : {
                      data: {
                        id: PAYMENT_ID,
                        order_id: ORDER_ID,
                        amount_cop: 17000,
                        payer_email: "cliente@test.local",
                        status: "pending",
                        orders: orderRow,
                      },
                      error: null,
                    },
            };
          },
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/mercadopago/client", () => ({
  createCheckoutPreference: async (input: Record<string, unknown>) => {
    preferenceInput = input;
    return {
      initPoint: "https://mercadopago.com/checkout/fake",
      preferenceId: "pref-fake-1",
      collectorId: "3627131944",
    };
  },
  ORDER_EXPIRY_MINUTES: 30,
  PREFERENCE_EXPIRY_MARGIN_MINUTES: 2,
}));

const { POST, maxDuration } = await import("./route");

function requete(origin = "https://hifago.test") {
  return new Request(`${origin}/api/payments/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentId: PAYMENT_ID }),
  });
}

describe("POST /api/payments/create — la back_url de retour", () => {
  beforeEach(() => {
    preferenceInput = null;
    paymentUpdate = null;
    orderRow = commandeRecente();
    // Ce bloc couvre le repli sans URL configurée (poste de dev) ; l'URL configurée a le sien.
    delete process.env.NEXT_PUBLIC_WEB_APP_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("renvoie le client sur l'adresse propre à sa commande, jamais sur /pago", async () => {
    const response = await POST(requete());
    expect(response.status).toBe(200);
    expect(preferenceInput?.successUrl).toBe(
      `https://hifago.test/reserva/${ACCESS_TOKEN}?payment=approved`
    );
  });

  // Corrigé — les trois back_urls pointaient jusqu'ici vers la MÊME adresse : le client revenait
  // sur `/reserva/<jeton>` sans distinction, et un paiement rejeté n'affichait donc jamais rien
  // (OrderResult.tsx dérive l'état de la commande de la base, jamais de l'issue Mercado Pago elle-
  // même — seul `?payment=` lui dit qu'il vient d'un rejet). Les trois adresses restent la MÊME
  // page (`/reserva/<jeton>`), seul le paramètre `payment` les distingue désormais.
  it("distingue les trois issues par `?payment=`, même page sinon", async () => {
    await POST(requete());
    const base = `https://hifago.test/reserva/${ACCESS_TOKEN}`;
    expect(preferenceInput?.successUrl).toBe(`${base}?payment=approved`);
    expect(preferenceInput?.pendingUrl).toBe(`${base}?payment=pending`);
    expect(preferenceInput?.failureUrl).toBe(`${base}?payment=rejected`);
  });

  it("NE PRÉFIXE PAS la locale : c'est le /es en dur qui faisait basculer la session en espagnol", async () => {
    await POST(requete());
    expect(preferenceInput?.successUrl).not.toContain("/es/");
    expect(preferenceInput?.successUrl).not.toContain("/en/");
  });

  it("porte le jeton de la commande, jamais son identifiant technique", async () => {
    await POST(requete());
    // L'order_id est un secret aussi (create_payment_intent s'en sert comme capacité) : le laisser
    // fuiter dans une URL de retour donnerait la capacité de payer à qui lit l'historique.
    expect(preferenceInput?.successUrl).not.toContain(ORDER_ID);
  });

  it("échoue plutôt que de fabriquer une adresse de retour introuvable", async () => {
    orderRow = null;
    const response = await POST(requete());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, reason: "order_not_found" });
    expect(preferenceInput).toBeNull();
  });

  // Sans `source_news=webhooks`, Mercado Pago livre aussi au format IPN, dont la signature n'est
  // pas vérifiable : chaque paiement finissait en SignatureMismatch (préprod, 2026-09-30).
  it("ne demande que des notifications au format Webhooks, les seules dont la signature se vérifie", async () => {
    await POST(requete());
    expect(preferenceInput?.notificationUrl).toBe(
      "https://hifago.test/api/payments/webhook?source_news=webhooks"
    );
  });

  it("suit l'origine réelle derrière un reverse proxy, jamais l'adresse locale du serveur", async () => {
    const request = new Request("http://127.0.0.1:3000/api/payments/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-host": "hifago.co",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ paymentId: PAYMENT_ID }),
    });
    await POST(request);
    expect(preferenceInput?.successUrl).toBe(
      `https://hifago.co/reserva/${ACCESS_TOKEN}?payment=approved`
    );
  });
});

// apps/web/lib/mercadopago/mock.ts — voir docs/specs/19-paiement-mercadopago-acompte-ledger.md.
describe("POST /api/payments/create — mode mock (MERCADOPAGO_MOCK_MODE)", () => {
  beforeEach(() => {
    preferenceInput = null;
    paymentUpdate = null;
    orderRow = commandeRecente();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("ne contacte jamais Mercado Pago quand le flag est actif hors production", async () => {
    process.env.MERCADOPAGO_MOCK_MODE = "true";
    delete process.env.VERCEL_ENV;
    const response = await POST(requete());
    const body = (await response.json()) as { ok: boolean; init_point?: string };
    expect(preferenceInput).toBeNull();
    expect(body.init_point).toContain("/api/payments/mock-checkout");
    expect(body.init_point).toContain(`paymentId=${PAYMENT_ID}`);
  });

  it("ignore le flag sur un déploiement de production déclarée — VERCEL_ENV l'emporte", async () => {
    process.env.MERCADOPAGO_MOCK_MODE = "true";
    process.env.VERCEL_ENV = "production";
    await POST(requete());
    expect(preferenceInput).not.toBeNull();
  });

  // Incident du 2026-09-20 : une préférence sans date d'expiration reste payable des heures après
  // que `expire_stale_payment_orders` a annulé la commande — argent encaissé, réservation détruite,
  // aucun chemin de remboursement. L'ancre doit être `orders.created_at`, jamais l'instant du clic.
  it("fait expirer la préférence AVANT la commande, ancrée sur orders.created_at", async () => {
    const createdAt = new Date(Date.now() - 10 * 60_000).toISOString(); // commande de 10 min
    orderRow = { access_token: ACCESS_TOKEN, created_at: createdAt };

    await POST(requete());

    const expiresAt = new Date(String(preferenceInput?.expiresAt)).getTime();
    const attendu = new Date(createdAt).getTime() + 28 * 60_000;
    expect(expiresAt).toBe(attendu);
    // Et surtout : strictement avant les 30 minutes qui déclenchent l'annulation en base.
    expect(expiresAt).toBeLessThan(new Date(createdAt).getTime() + 30 * 60_000);
  });

  it("refuse d'ouvrir un paiement sur une commande qui va expirer (échec fermé)", async () => {
    orderRow = {
      access_token: ACCESS_TOKEN,
      created_at: new Date(Date.now() - 29 * 60_000).toISOString(),
    };

    const response = await POST(requete());
    const body = (await response.json()) as { ok: boolean; reason?: string };

    expect(response.status).toBe(409);
    expect(body.reason).toBe("order_expiring");
    expect(preferenceInput).toBeNull();
  });
});

describe("POST /api/payments/create — identité du compte qui encaisse (spec 39)", () => {
  it("persiste la préférence et le collector_id sur payments", async () => {
    paymentUpdate = null;
    orderRow = commandeRecente();
    const response = await POST(requete());

    expect(response.status).toBe(200);
    expect(paymentUpdate).toEqual({ mp_preference_id: "pref-fake-1", mp_collector_id: "3627131944" });
  });
});

// Audit 2026-09-28 : en production, l'adresse de NOTIFICATION ne dépend que de la configuration du
// déploiement. Le RETOUR du client, lui, suit toujours l'hôte où il a commandé (sa session y vit).
describe("POST /api/payments/create — URL configurée (NEXT_PUBLIC_WEB_APP_URL)", () => {
  beforeEach(() => {
    preferenceInput = null;
    orderRow = commandeRecente();
    process.env.NEXT_PUBLIC_WEB_APP_URL = "https://hifago.test/";
    process.env.VERCEL_ENV = "production";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function requeteAutreHote() {
    return new Request("https://autre-hote.test/api/payments/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-host": "autre-hote.test",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ paymentId: PAYMENT_ID }),
    });
  }

  it("en production : notification sur l'URL configurée, jamais sur l'hôte de la requête", async () => {
    await POST(requeteAutreHote());
    expect(preferenceInput?.notificationUrl).toBe("https://hifago.test/api/payments/webhook?source_news=webhooks");
  });

  // Un client entré par un alias de la prod (*.vercel.app) renvoyé sur le domaine configuré y
  // arriverait sans session : plus de nouvel essai de paiement possible.
  it("en production aussi, le client revient sur l'hôte où il a commandé", async () => {
    await POST(requeteAutreHote());
    const base = `https://autre-hote.test/reserva/${ACCESS_TOKEN}`;
    expect(preferenceInput?.successUrl).toBe(`${base}?payment=approved`);
    expect(preferenceInput?.pendingUrl).toBe(`${base}?payment=pending`);
    expect(preferenceInput?.failureUrl).toBe(`${base}?payment=rejected`);
  });

  // Une preview peut porter l'URL de la préprod : le client reviendrait sur un autre déploiement, où
  // sa session n'existe pas, et le webhook y serait livré au lieu de la preview qui a créé le paiement.
  it("hors production (preview, préprod, local), l'hôte de la requête même si la variable est posée", async () => {
    process.env.VERCEL_ENV = "preview";
    await POST(requeteAutreHote());
    expect(preferenceInput?.successUrl).toBe(`https://autre-hote.test/reserva/${ACCESS_TOKEN}?payment=approved`);
    expect(preferenceInput?.notificationUrl).toBe(
      "https://autre-hote.test/api/payments/webhook?source_news=webhooks"
    );
  });
});

describe("POST /api/payments/create — plafond de durée", () => {
  it("tient lecture + Mercado Pago + écriture sous le plafond, avec de la marge pour répondre", async () => {
    const { PREFERENCE_DEADLINE_MS } =
      await vi.importActual<typeof import("@/lib/mercadopago/client")>("@/lib/mercadopago/client");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    orderRow = commandeRecente();
    await POST(requete());
    const delaisBase = timeout.mock.calls.map(([ms]) => ms);
    timeout.mockRestore();
    expect(delaisBase).toHaveLength(2);
    const pireCas = delaisBase[0] + PREFERENCE_DEADLINE_MS + delaisBase[1];
    expect(maxDuration * 1000 - pireCas).toBeGreaterThanOrEqual(5_000);
  });
});

// P5a : chaque accès base est borné (une base qui cale répond en erreur), et une panne de lecture
// n'est jamais « paiement introuvable ».
describe("POST /api/payments/create — accès base bornés", () => {
  beforeEach(() => {
    signauxBase = [];
    lectureErreur = null;
    preferenceInput = null;
    orderRow = commandeRecente();
  });

  it("passe un délai de 5 s à la lecture ET à l'écriture de payments", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const response = await POST(requete());
    const delais = timeout.mock.calls.map(([ms]) => ms);
    timeout.mockRestore();
    expect(response.status).toBe(200);
    expect(signauxBase).toHaveLength(2);
    expect(signauxBase.every((signal) => signal instanceof AbortSignal)).toBe(true);
    expect(delais).toEqual([5_000, 5_000]);
  });

  it("lecture en panne (ou délai dépassé) → 503 db_unavailable, jamais payment_not_found", async () => {
    lectureErreur = { message: "This operation was aborted" };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(requete());
    consoleError.mockRestore();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: "db_unavailable" });
    expect(preferenceInput).toBeNull();
  });
});
