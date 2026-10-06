// Spec 23 Tranche 1 — dispatch de la file notification_emails vers Resend. Réclame un lot via une
// RPC service_role-only, traite chaque ligne isolément (une erreur n'empêche jamais le reste du
// lot), jamais de vrai envoi en CI (RESEND_API_BASE_URL overridable, même pattern que
// LOBBY_API_BASE_URL, pour interception par un serveur de fixtures local).
//
// Réponse HTTP volontairement agrégée (spec 23 §8.6) : jamais recipient_email/subject/body_html
// d'une ligne individuelle.
//
// Depuis P6 (2026-10) : squelette commun des jobs (_shared/job.ts — contrôle d'appelant, budget de
// temps, heartbeat à chaque passage, aucun secret dans ce qui sort). Le passage tient dans son
// budget (20 s), très en deçà du bail de réclamation (10 min, claim_notification_email_batch) :
// jamais il ne rend une ligne qu'un autre passage aurait réclamée entre-temps.
import { type JobOutcome, serveJob } from "../_shared/job.ts";
import { delayBeforeNextCall } from "../../../packages/domain/src/jobs/rateLimitPacing.ts";

interface NotificationEmailRow {
  id: string;
  recipient_email: string;
  subject: string;
  body_html: string;
}

// Refus GLOBAUX de Resend (clé refusée, domaine ou compte non autorisé, quota) : ils vaudraient pour
// chaque ligne du lot. Le passage s'arrête et rend toutes ses lignes SANS consommer de tentative —
// sinon une clé révoquée abandonnait toute la file en 25 minutes (5 tentatives × 5 min).
// Une PANNE de Resend (5xx, délai, réseau) arrête aussi le passage : la ligne tentée compte sa
// tentative, les autres sont rendues — sinon une panne de 25 min abandonnait la tête de file.
const GLOBAL_REFUSALS = new Set([401, 403, 429]);

// Débit. Resend accepte 10 requêtes/s par ÉQUIPE, toutes clés confondues (documentation consultée le
// 2026-10-06) : ce job s'en tient à 4/s (250 ms entre deux envois), pour laisser de la place aux
// autres expéditeurs de l'équipe — un 429 arrêterait le passage. Quand Resend annonce sa fenêtre
// épuisée (`ratelimit-remaining: 0`), le job attend sa remise à zéro ; au-delà de 2 s, le reste du
// lot est rendu au passage suivant, sans tentative consommée.
const MIN_SPACING_MS = 250;
const MAX_RATE_WAIT_MS = 2_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

serveJob("send-notification-emails", async (ctx): Promise<JobOutcome> => {
  const { supabase } = ctx;
  const baseUrl = Deno.env.get("RESEND_API_BASE_URL") || "https://api.resend.com";
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("NOTIFICATION_EMAIL_FROM") || "notificaciones@hifago.test";

  // Sans clé, on ne réclame RIEN. Ce garde est AVANT claim_notification_email_batch, et c'est tout
  // l'enjeu : réclamer incrémente `attempts`, et mark_notification_email_failed abandonne
  // définitivement à la 5e tentative. Une file en attente de configuration doit rester INTACTE, pas
  // se vider toute seule (préprod, 9 e-mails abandonnés). Statut 200 : c'est un état de
  // configuration, pas une panne — mais le heartbeat le dit.
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY manquante — aucun lot réclamé", stats: { claimed: 0, sent: 0, failed: 0 } };
  }

  const { data: batch, error } = await supabase.rpc("claim_notification_email_batch", { p_limit: 20 });
  if (error) {
    return { ok: false, error: `claim_notification_email_batch — ${ctx.describe(error)}`, stats: {}, status: 500 };
  }

  const rows = (batch ?? []) as NotificationEmailRow[];
  const summary = { claimed: rows.length, sent: 0, failed: 0, released: 0, transport_errors: 0, write_errors: 0, rate_deferred: 0 };
  let stopReason: string | null = null;

  // Une écriture de la file qui échoue : la ligne reste `sending` jusqu'à l'expiration de son bail
  // (10 min) et l'Idempotency-Key couvre son renvoi — mais la supervision le dit.
  function writeFailed(rpc: string, id: string, writeError: unknown) {
    summary.write_errors++;
    console.error(`send-notification-emails : ${rpc} ${id} — ${ctx.describe(writeError)}`);
  }

  async function release(ids: string[], reason: string) {
    if (ids.length === 0) return;
    const { data, error: releaseError } = await supabase.rpc("release_notification_email_claim", {
      p_ids: ids,
      p_reason: reason,
    });
    if (releaseError) writeFailed("release_notification_email_claim", `${ids.length} ligne(s)`, releaseError);
    else summary.released += Number(data ?? 0);
  }

  async function markFailed(id: string, reason: string) {
    const { error: markError } = await supabase.rpc("mark_notification_email_failed", { p_id: id, p_error: reason });
    if (markError) writeFailed("mark_notification_email_failed", id, markError);
  }

  // Délai avant l'envoi suivant, lu sur la réponse précédente ; null = fenêtre de débit trop longue.
  let waitMs: number | null = 0;
  for (const [index, row] of rows.entries()) {
    if (waitMs === null) {
      summary.rate_deferred = rows.length - index;
      await release(rows.slice(index).map((r) => r.id), "resend : fenêtre de débit épuisée — renvoi au passage suivant");
      break;
    }
    if (waitMs > 0) await sleep(waitMs);
    const timeoutMs = ctx.nextCallTimeout();
    if (timeoutMs === null) {
      await release(rows.slice(index).map((r) => r.id), "budget du passage épuisé — renvoi au passage suivant");
      break;
    }
    try {
      const res = await fetch(`${baseUrl}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // Idempotency-Key (spec 23 §8.4) : protège contre un envoi physique en double si cette
          // ligne est reprise par claim_notification_email_batch après un crash survenu APRÈS un
          // envoi Resend déjà réussi mais AVANT mark_notification_email_sent.
          "Idempotency-Key": row.id,
        },
        body: JSON.stringify({ from, to: row.recipient_email, subject: row.subject, html: row.body_html }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      waitMs = delayBeforeNextCall(res.headers, MIN_SPACING_MS, MAX_RATE_WAIT_MS);

      if (GLOBAL_REFUSALS.has(res.status)) {
        await res.body?.cancel();
        stopReason = `resend ${res.status} — envoi arrêté, lot rendu sans tentative consommée`;
        await release(rows.slice(index).map((r) => r.id), `resend ${res.status}`);
        break;
      }

      if (!res.ok) {
        // Refus propre à CETTE ligne (adresse invalide…) ou panne de Resend (5xx) : la ligne compte
        // une tentative. Une panne arrête en plus le passage.
        const text = await res.text();
        await markFailed(row.id, ctx.redact(`Resend ${res.status}: ${text}`));
        summary.failed++;
        if (res.status >= 500) {
          summary.transport_errors++;
          stopReason = `resend ${res.status} — envoi arrêté, reste du lot rendu`;
          await release(rows.slice(index + 1).map((r) => r.id), `resend ${res.status}`);
          break;
        }
        continue;
      }

      const body = (await res.json()) as { id?: string };
      const { error: sentError } = await supabase.rpc("mark_notification_email_sent", {
        p_id: row.id,
        p_provider_message_id: body.id ?? null,
      });
      if (sentError) writeFailed("mark_notification_email_sent", row.id, sentError);
      summary.sent++;
    } catch (err) {
      // Délai dépassé ou réseau : l'envoi a pu partir — l'Idempotency-Key couvre le réessai. Le
      // passage s'arrête, le reste du lot est rendu.
      const reason = ctx.describe(err);
      console.error(`notification_emails ${row.id} : envoi échoué — ${reason}`);
      await markFailed(row.id, reason);
      summary.failed++;
      summary.transport_errors++;
      stopReason = `resend : ${err instanceof Error ? err.name : "erreur réseau"} — envoi arrêté, reste du lot rendu`;
      await release(rows.slice(index + 1).map((r) => r.id), stopReason);
      break;
    }
  }

  const writeProblem = summary.write_errors > 0 ? `${summary.write_errors} écriture(s) de la file en échec` : null;
  return {
    ok: stopReason === null && writeProblem === null,
    error: [stopReason, writeProblem].filter((part): part is string => part !== null).join(" ; ") || null,
    stats: summary,
  };
}, {
  // Un envoi consomme une tentative : il ne part qu'avec un délai complet (8 s), jamais un délai
  // tronqué par le budget (cf. JobOptions.minCallMs).
  minCallMs: 8_000,
});
