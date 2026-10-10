// Squelette commun des Edge Functions de jobs (déclenchées par pg_cron via les wrappers `invoke_*`).
// Chaque fonction ne fournit que son passage ; ce module garantit, pour toutes, ce qu'aucune ne doit
// pouvoir oublier :
//   1. le contrôle d'appelant (requireServiceRole) AVANT toute lecture ou tout appel externe ;
//   2. un BUDGET de temps par passage, sous le délai du wrapper pg_net et sous le bail des claims :
//      `nextCallTimeout()` donne le délai du prochain appel externe, ou null quand le passage doit
//      s'arrêter (le reste attend le passage suivant) ;
//   3. un heartbeat À CHAQUE passage, même vide (`job_heartbeats`, surveillé par jobs_watchdog
//      sous le NOM DU CRON, qui est aussi celui du dossier — scripts/check-edge-jobs.sh). `ok` dit
//      que le passage s'est déroulé ; sinon `last_error`, affiché aux admins ;
//   4. aucun secret dans ce qui sort (heartbeat, journaux, réponse) : tout texte d'erreur passe par
//      redactSecrets, avec les secrets de l'environnement et les jetons lus en base.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createCallBudget } from "../../../packages/domain/src/jobs/callBudget.ts";
import { describeJobError, redactSecrets } from "../../../packages/domain/src/jobs/jobError.ts";
import { requireServiceRole } from "./requireServiceRole.ts";

export interface JobContext {
  supabase: SupabaseClient;
  request: Request;
  /** Délai (ms) à donner au prochain appel externe, ou null : budget du passage épuisé. */
  nextCallTimeout(): number | null;
  /** Un secret de plus à masquer — un jeton Lobby lu en base, par exemple. */
  addSecret(value: string | null | undefined): void;
  /** Un texte sûr à écrire ou à journaliser (secrets masqués, court : 300 caractères). */
  redact(text: string): string;
  /** Idem pour une ligne de relevé plus longue (2 000 caractères) — dérives, observations. */
  redactLong(text: string): string;
  /** Un corps JSON conservé tel quel en base (réponse brute d'un fournisseur) : chaque chaîne masquée. */
  redactJson(value: unknown): unknown;
  /** Une erreur levée en une ligne sûre (nom, message masqué). */
  describe(err: unknown): string;
}

export interface JobOutcome {
  /** Le passage s'est déroulé — faux sur un refus global, une panne de transport, une exception. */
  ok: boolean;
  /** Le motif quand `ok` est faux : un code, un statut, un message court — jamais un corps brut. */
  error?: string | null;
  /** Compteurs du passage (heartbeat et réponse). */
  stats: Record<string, number | boolean>;
  /** Statut HTTP de la réponse (200 par défaut ; 500 quand le claim lui-même a échoué). */
  status?: number;
  /** Ce que la réponse porte en plus des compteurs — chaque chaîne y est masquée par serveJob. */
  extra?: Record<string, unknown>;
}

export interface JobOptions {
  /** Budget du passage. Défaut 20 s : sous les 25 s du wrapper pg_net et sous tout bail de claim. */
  budgetMs?: number;
  /** Plafond d'un appel externe. */
  callTimeoutMs?: number;
  /**
   * Délai minimal pour lancer un appel (défaut 1,5 s). Un job dont l'appel CONSOMME une tentative
   * (annulation, envoi) le met au plafond : un délai tronqué par le budget finirait en TimeoutError
   * facturée comme une panne — l'appel est alors rendu au passage suivant, jamais tenté.
   */
  minCallMs?: number;
}

const DEFAULT_BUDGET_MS = 20_000;
const DEFAULT_CALL_TIMEOUT_MS = 8_000;

/** Masque chaque chaîne d'une valeur JSON (tableaux et objets compris). */
function redactDeep(value: unknown, redact: (text: string) => string): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redact));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, redact)]));
  }
  return value;
}

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

export function serveJob(name: string, run: (ctx: JobContext) => Promise<JobOutcome>, options: JobOptions = {}) {
  Deno.serve(async (request) => {
    const refused = await requireServiceRole(request);
    if (refused) return refused;

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const secrets: string[] = [
      serviceKey,
      Deno.env.get("LOBBY_RELAY_SECRET") ?? "",
      Deno.env.get("RESEND_API_KEY") ?? "",
      Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") ?? "",
    ];
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
    // Sous `minCallMs` restantes (1,5 s par défaut), un appel n'a plus le temps d'aboutir : le
    // passage s'arrête (callBudget).
    const nextCallTimeout = createCallBudget(
      () => performance.now(),
      options.budgetMs ?? DEFAULT_BUDGET_MS,
      options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
      options.minCallMs
    );

    const ctx: JobContext = {
      supabase,
      request,
      nextCallTimeout,
      addSecret(value) {
        if (value) secrets.push(value);
      },
      redact: (text) => redactSecrets(text, secrets),
      redactLong: (text) => redactSecrets(text, secrets, 2_000),
      redactJson: (value) => redactDeep(value, (text) => redactSecrets(text, secrets, 2_000)),
      describe: (err) => describeJobError(err, secrets),
    };

    let outcome: JobOutcome;
    try {
      outcome = await run(ctx);
    } catch (err) {
      outcome = { ok: false, error: `exception — ${ctx.describe(err)}`, stats: {}, status: 500 };
    }

    const error = outcome.ok ? null : ctx.redact(outcome.error || "échec sans motif");
    const { error: heartbeatError } = await supabase.rpc("heartbeat_job", {
      p_job: name,
      p_ok: outcome.ok,
      p_stats: outcome.stats,
      p_error: error,
    });
    if (heartbeatError) console.error(`${name} : heartbeat_job a échoué — ${ctx.describe(heartbeatError)}`);

    // Le résumé est journalisé ET rendu : net._http_response et les journaux de la fonction sont, avec
    // le heartbeat, les seuls témoins d'un passage.
    const summary = { ok: outcome.ok, ...outcome.stats, ...(error ? { error } : {}) };
    console.info(name, JSON.stringify(summary));
    const extra = redactDeep(outcome.extra ?? {}, ctx.redactLong) as Record<string, unknown>;
    return json({ ...summary, ...extra }, outcome.status ?? 200);
  });
}
