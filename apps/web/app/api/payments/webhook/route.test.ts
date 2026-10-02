// @vitest-environment node
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CE FICHIER EXISTE POUR UNE RAISON PRÉCISE (incident du 2026-09-20, piège 19).
//
// La vérification de signature du webhook était le SEUL maillon du chemin critique du paiement que
// rien n'avait jamais exercé : ni Vitest, ni Playwright, ni pgTAP, ni un parcours manuel réussi.
// Résultat : le webhook Mercado Pago n'a jamais confirmé un seul paiement réel depuis le début du
// projet, et il a fallu un vrai paiement en préprod pour s'en apercevoir. CLAUDE.md §11.20 — « une
// règle que rien ne vérifie n'est pas une règle, c'est un souhait ».
//
// Ce que ces tests prouvent, et que rien d'autre ne peut prouver :
//   1. le manifeste HMAC que NOUS validons est bien `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
//      — vérifié en fabriquant la signature nous-mêmes, sans dépendre de Mercado Pago ;
//   2. une signature falsifiée est refusée (401) ET laisse de quoi être rejouée hors ligne ;
//   3. une notification `merchant_order` est un no-op silencieux, sans entrée de réconciliation
//      (donc sans e-mail à tous les admins) — c'était 2 des 8 entrées parasites du 2026-09-20 ;
//   4. (migration 20261002021045) le paiement s'applique par apply_payment_webhook_checked, avec un
//      montant exploitable (COP, numérique fini) ou null, et un événement aplati sans le payeur —
//      la route ne lit plus `payments` et ne décide plus du montant elle-même.
//
// ⚠️ Ce que ces tests NE prouvent PAS, et qu'aucun test local ne peut prouver : que le secret
// configuré dans l'environnement appartient à la même application/au même mode Mercado Pago que
// l'access token. C'était la vraie cause de l'incident — elle ne se voit qu'en livraison réelle.

const SECRET = "secret-de-test-jamais-un-vrai";
const DATA_ID = "179050364695";
const REQUEST_ID = "d7b8e9a0-1111-2222-3333-444455556666";
const EXTERNAL_REFERENCE = "00bd6fbb-c5a0-4001-943a-79676655a0c7";
const ORIGINAL_ENV = { ...process.env };

type Insert = Record<string, unknown>;
let inserts: Insert[] = [];
let tablesLues: string[] = [];
let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
/** La réponse de GET /v1/payments/{id} ; `null` = le GET lève. */
let mpPayment: Record<string, unknown> | null = null;
let rpcResult: { data: unknown; error: { message: string } | null } = { data: { ok: true }, error: null };
/** Erreur renvoyée par l'insert de réconciliation (null = succès) — sert au cas « rejeu 23505 ». */
let insertError: { code: string; message: string } | null = null;

/** Un paiement tel que Mercado Pago le rend — payeur compris, qui ne doit JAMAIS être conservé. */
function paiementMp(champs: Record<string, unknown> = {}) {
  return {
    id: Number(DATA_ID),
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 3400,
    currency_id: "COP",
    date_created: "2026-10-02T10:00:00.000-05:00",
    date_approved: "2026-10-02T10:00:05.000-05:00",
    external_reference: EXTERNAL_REFERENCE,
    collector_id: 3627131944,
    payer: { email: "payeur@exemple.test", identification: { type: "CC", number: "1234567890" } },
    card: { last_four_digits: "4242", cardholder: { name: "Payeur Exemple" } },
    ...champs,
  };
}

vi.mock("@hifago/supabase/service", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      insert: async (row: Insert) => {
        inserts.push({ table, ...row });
        return { error: insertError };
      },
      select: () => {
        tablesLues.push(table);
        throw new Error(`lecture inattendue de ${table} : le montant se décide en base`);
      },
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
  }),
}));

vi.mock("@/lib/mercadopago/client", () => ({
  getMercadoPagoPayment: async () => {
    if (mpPayment === null) throw new Error("GET /v1/payments/{id} indisponible");
    return mpPayment;
  },
}));

const { POST, maxDuration } = await import("./route");

/** Reproduit à l'identique le manifeste documenté par Mercado Pago et implémenté par le SDK. */
function signer(params: { dataId?: string | null; requestId?: string | null; ts: string }) {
  const parts: string[] = [];
  if (params.dataId) parts.push(`id:${params.dataId}`);
  if (params.requestId) parts.push(`request-id:${params.requestId}`);
  parts.push(`ts:${params.ts}`);
  const manifest = parts.join(";") + ";";
  return crypto.createHmac("sha256", SECRET).update(manifest).digest("hex");
}

function requete(options: {
  type?: string;
  dataId?: string | null;
  signature?: string | null;
  requestId?: string | null;
  body?: unknown;
  /** Horodatage signé, en secondes (défaut : un instant fixe du passé). */
  ts?: string;
} = {}) {
  const type = options.type ?? "payment";
  const dataId = options.dataId === undefined ? DATA_ID : options.dataId;
  const query = new URLSearchParams();
  query.set("type", type);
  if (dataId) query.set("data.id", dataId);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.signature !== null) {
    const ts = options.ts ?? "1789938000";
    headers["x-signature"] =
      options.signature ?? `ts=${ts},v1=${signer({ dataId, requestId: options.requestId ?? REQUEST_ID, ts })}`;
  }
  if (options.requestId !== null) headers["x-request-id"] = options.requestId ?? REQUEST_ID;
  return new Request(`https://hifago.test/api/payments/webhook?${query}`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? { type, data: { id: dataId } }),
  });
}

describe("POST /api/payments/webhook", () => {
  beforeEach(() => {
    inserts = [];
    tablesLues = [];
    rpcCalls = [];
    mpPayment = paiementMp();
    rpcResult = { data: { ok: true }, error: null };
    insertError = null;
    process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("accepte une livraison correctement signée et l'applique par la fonction qui vérifie le montant", async () => {
    const response = await POST(requete());

    expect(response.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("apply_payment_webhook_checked");
    expect(rpcCalls[0].args).toMatchObject({
      p_mp_payment_id: DATA_ID,
      p_external_reference: EXTERNAL_REFERENCE,
      p_status: "approved",
      p_transaction_amount: 3400,
    });
    expect(inserts).toHaveLength(0);
    // Le montant se décide en base : la route ne relit plus `payments`.
    expect(tablesLues).toEqual([]);
  });

  it("conserve un événement aplati, montant compris, sans rien du payeur", async () => {
    await POST(requete());

    const event = rpcCalls[0].args.p_raw_event as Record<string, unknown>;
    expect(event).toMatchObject({
      mp_payment_id: DATA_ID,
      status: "approved",
      status_detail: "accredited",
      transaction_amount: 3400,
      mp_transaction_amount: 3400,
      currency_id: "COP",
      external_reference: EXTERNAL_REFERENCE,
      collector_id: "3627131944",
    });
    expect(event.webhook_body).toMatchObject({ data: { id: DATA_ID } });
    const texte = JSON.stringify(event);
    expect(texte).not.toContain("payeur@exemple.test");
    expect(texte).not.toContain("1234567890");
    expect(texte).not.toContain("Payeur Exemple");
  });

  it.each([
    ["une autre devise que COP", { currency_id: "USD" }],
    ["un montant absent", { transaction_amount: undefined }],
    ["un montant non numérique", { transaction_amount: "3400" }],
    ["un montant non fini", { transaction_amount: Number.POSITIVE_INFINITY }],
  ])("transmet un montant null pour %s — la base refusera de l'approuver", async (_cas, champs) => {
    mpPayment = paiementMp(champs);
    const response = await POST(requete());

    expect(response.status).toBe(200);
    expect(rpcCalls[0].args.p_transaction_amount).toBeNull();
    expect((rpcCalls[0].args.p_raw_event as Record<string, unknown>).transaction_amount).toBeNull();
  });

  it("un écart de montant décidé en base répond 200, sans entrée écrite par la route (la base l'a fait)", async () => {
    rpcResult = { data: { ok: true, reason: "amount_mismatch" }, error: null };
    const response = await POST(requete());

    expect(response.status).toBe(200);
    expect(inserts).toHaveLength(0);
  });

  it("tolère un corps non JSON : la signature reste la porte", async () => {
    const valide = requete();
    const request = new Request(valide.url, { method: "POST", headers: valide.headers, body: "pas du json" });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect((rpcCalls[0].args.p_raw_event as Record<string, unknown>).webhook_body).toBeNull();
  });

  it("re-confirmation Mercado Pago en échec → 502 (MP retentera) et une entrée", async () => {
    mpPayment = null;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(requete());
    consoleError.mockRestore();

    expect(response.status).toBe(502);
    expect(rpcCalls).toHaveLength(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].kind).toBe("webhook_failure");
  });

  it("re-confirmation 2xx sans identifiant (corps tronqué rendu `{}`) → 502 et une entrée, jamais 200", async () => {
    mpPayment = {};
    const response = await POST(requete());

    expect(response.status).toBe(502);
    expect(rpcCalls).toHaveLength(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].failure_reason).toBe("réponse de re-confirmation Mercado Pago sans identifiant de paiement");
  });

  it("observe un horodatage signé hors tolérance SANS bloquer : la livraison s'applique, une ligne de journal", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vieux = String(Math.floor(Date.now() / 1000) - 3600);
    const response = await POST(requete({ ts: vieux }));
    const lignes = consoleWarn.mock.calls.map((appel) => String(appel[0]));
    consoleWarn.mockRestore();

    expect(response.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(lignes).toHaveLength(1);
    expect(JSON.parse(lignes[0])).toMatchObject({ event: "mp_webhook_ts_drift", threshold_seconds: 300 });
  });

  it("n'écrit rien dans le journal pour un horodatage frais", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await POST(requete({ ts: String(Math.floor(Date.now() / 1000)) }));
    const appels = consoleWarn.mock.calls.length;
    consoleWarn.mockRestore();

    expect(response.status).toBe(200);
    expect(appels).toBe(0);
  });

  it("conserve un corps démesuré tronqué, jamais en entier", async () => {
    const response = await POST(
      requete({ signature: "ts=1789938000,v1=" + "0".repeat(64), body: { data: { id: DATA_ID }, pad: "x".repeat(100_000) } })
    );

    expect(response.status).toBe(401);
    const body = (inserts[0].raw_event as { body: { truncated: boolean; chars: number; head: string } }).body;
    expect(body.truncated).toBe(true);
    expect(body.head.length).toBeLessThan(10_000);
    expect(body.chars).toBeGreaterThan(100_000);
  });

  it("borne aussi le corps transmis à la base (webhook_body) et celui des autres entrées", async () => {
    const enorme = { data: { id: DATA_ID }, pad: "x".repeat(100_000) };
    const response = await POST(requete({ body: enorme }));
    expect(response.status).toBe(200);
    const webhookBody = (rpcCalls[0].args.p_raw_event as { webhook_body: { truncated: boolean } }).webhook_body;
    expect(webhookBody.truncated).toBe(true);

    mpPayment = null;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await POST(requete({ body: enorme }));
    consoleError.mockRestore();
    expect((inserts[0].raw_event as { body: { truncated: boolean } }).body.truncated).toBe(true);
  });

  it("external_reference absent → 200 (rien à corréler) et une entrée", async () => {
    mpPayment = paiementMp({ external_reference: null });
    const response = await POST(requete());

    expect(response.status).toBe(200);
    expect(rpcCalls).toHaveLength(0);
    expect(inserts).toHaveLength(1);
  });

  it.each([
    ["la RPC lève", { data: null, error: { message: "base indisponible" } }],
    ["la RPC refuse (ok:false)", { data: { ok: false, reason: "payment_not_found" }, error: null }],
  ])("%s → 500 (MP retentera) et une entrée", async (_cas, resultat) => {
    rpcResult = resultat;
    const response = await POST(requete());

    expect(response.status).toBe(500);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].kind).toBe("webhook_failure");
  });

  it("refuse une signature falsifiée en 401 et conserve de quoi la rejouer", async () => {
    const response = await POST(requete({ signature: "ts=1789938000,v1=" + "0".repeat(64) }));

    expect(response.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].failure_reason).toBe("signature invalide (SignatureMismatch)");
    // Bruit à diagnostiquer, jamais un remboursement à décider (migration 20260920120000).
    expect(inserts[0].kind).toBe("webhook_failure");

    // Le matériel de rejeu — absent avant le 2026-09-20, ce qui avait rendu les 8 livraisons
    // réelles de l'incident invérifiables hors ligne.
    const rawEvent = inserts[0].raw_event as { body: unknown; delivery: Record<string, unknown> };
    expect(rawEvent.delivery.signature).toContain("v1=");
    expect(rawEvent.delivery.request_id).toBe(REQUEST_ID);
    expect(rawEvent.delivery.query).toContain(`data.id=${DATA_ID}`);
    expect(rawEvent.body).toMatchObject({ data: { id: DATA_ID } });
  });

  it("ignore silencieusement une notification merchant_order, sans entrée de réconciliation", async () => {
    // Régression du 2026-09-20 : ces notifications tombaient en 401 AVANT le tri par type, et
    // chaque entrée déclenchait un e-mail à tous les admins (trigger 20260824060000).
    const response = await POST(requete({ type: "merchant_order", signature: null }));

    expect(response.status).toBe(200);
    expect(inserts).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuse tout quand le secret n'est pas configuré (échec fermé)", async () => {
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;

    const response = await POST(requete());

    expect(response.status).toBe(500);
    expect(rpcCalls).toHaveLength(0);
  });

  it("absorbe le rejeu d'un échec déjà enregistré (23505 sur l'index unique partiel) sans erreur", async () => {
    // Mercado Pago retente une livraison en échec : la seconde insertion heurte l'index unique
    // (mp_payment_id, failure_reason) des webhook_failure ouverts — un no-op, jamais une erreur.
    mpPayment = paiementMp({ external_reference: null });
    insertError = { code: "23505", message: "duplicate key value violates unique constraint" };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(requete());

    expect(response.status).toBe(200);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("POST /api/payments/webhook — plafond de durée", () => {
  it("coupe le GET Mercado Pago assez tôt pour laisser 10 s à l'écriture de l'échec et au 502 (si la base répond)", async () => {
    const { PAYMENT_LOOKUP_DEADLINE_MS } =
      await vi.importActual<typeof import("@/lib/mercadopago/client")>("@/lib/mercadopago/client");
    expect(maxDuration * 1000 - PAYMENT_LOOKUP_DEADLINE_MS).toBeGreaterThanOrEqual(10_000);
  });

  it("garde un plafond court et explicite : une exécution qui s'éternise est coupée, pas laissée au défaut de la plateforme", () => {
    expect(maxDuration).toBeLessThanOrEqual(30);
  });
});
