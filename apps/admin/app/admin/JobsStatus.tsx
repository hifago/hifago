"use client";

import { formatDateTimeInBogota } from "@hifago/domain";
import { Card, Chip } from "@hifago/ui";
import { statusChip, type ChipStyle } from "@/components/status-chip";

// Bloc « Procesos » de l'accueil admin (décisions du 2026-10-04) : l'état des jobs planifiés, lu
// par `admin_jobs_status()` (migration 20261006143045). Le watchdog alerte les admins PAR E-MAIL ;
// si c'est l'envoi d'e-mails qui tombe, l'alerte ne part pas — ce bloc est le second canal.
//
// - PERMANENT : un bloc qui disparaît quand tout va bien redevient ambigu avec « n'a pas pu
//   charger ». La lecture en échec s'affiche ici (« no disponible »), le reste de l'accueil aussi.
// - Seuils, liste des jobs et état (`ok | failing | stale | never`) viennent de la base, calculés
//   avec le prédicat même du watchdog : rien n'est recopié ici, pas même l'heure (`checked_at`).
// - « Sin latido todavía » (`never`) n'est jamais compté « al día ». Ni un job qui a tourné SANS
//   jamais réussir : la base le dit `failing` pendant sa grâce (20261007003627), affiché « Sin
//   éxito todavía », en alerte.
// - Un retard SANS alerte en cours (« Sin alerta por correo ») : le canal e-mail est sans doute
//   tombé aussi.

export type JobStatusRow = {
  jobName: string;
  staleAfterMinutes: number;
  lastOkAt: string | null;
  lastError: string | null;
  alertedAt: string | null;
  state: string;
  alertActive: boolean;
};

export type JobsStatusProps = { unavailable: true } | { jobs: JobStatusRow[]; checkedAt: string | null };

// Libellés : map avec repli sur le nom technique, toujours affiché à côté.
const JOB_LABELS: Record<string, string> = {
  "pms-poll-bookings": "Lectura de reservas del PMS",
  "pms-cancel-bookings": "Cancelaciones en el PMS",
  "pms-sync-availability": "Sincronización de disponibilidad del PMS",
  "send-notification-emails": "Envío de correos",
  "pms-nightly-contract-check": "Control nocturno del contrato PMS",
  "payments-reconcile": "Conciliación de pagos",
};

const STATE_LABELS: Record<string, string> = {
  ok: "Al día",
  stale: "Con retraso",
  never: "Sin latido todavía",
  failing: "Sin éxito todavía",
};

const STATE_CHIP: Record<string, ChipStyle> = {
  ok: { color: "success", variant: "soft" },
  stale: { color: "danger", variant: "soft" },
  never: { color: "warning", variant: "soft" },
  failing: { color: "danger", variant: "soft" },
};

const isKnownState = (state: string) => Object.hasOwn(STATE_LABELS, state);

function formatThreshold(minutes: number) {
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
}

/** « hace N min / h / días », mesuré contre l'heure du contrôle (base), jamais l'horloge locale. */
function formatAgo(instant: string, checkedAt: string | null) {
  if (!checkedAt) return null;
  const minutes = Math.floor((Date.parse(checkedAt) - Date.parse(instant)) / 60000);
  if (!Number.isFinite(minutes)) return null;
  if (minutes < 1) return "hace menos de 1 min";
  if (minutes < 60) return `hace ${minutes} min`;
  if (minutes < 48 * 60) return `hace ${Math.floor(minutes / 60)} h`;
  return `hace ${Math.floor(minutes / (24 * 60))} días`;
}

function plural(n: number, singular: string, pluriel: string) {
  return `${n} ${n === 1 ? singular : pluriel}`;
}

function JobRow({ job, checkedAt }: { job: JobStatusRow; checkedAt: string | null }) {
  const state = job.state;
  const style = statusChip(STATE_CHIP, state);
  const ago = job.lastOkAt ? formatAgo(job.lastOkAt, checkedAt) : null;
  return (
    <li
      data-testid={`job-row-${job.jobName}`}
      className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{JOB_LABELS[job.jobName] ?? job.jobName}</span>
        <span className="font-mono text-xs text-muted break-all">{job.jobName}</span>
        <span className="text-sm">
          Último éxito:{" "}
          {job.lastOkAt ? `${formatDateTimeInBogota(job.lastOkAt, "es")}${ago ? ` (${ago})` : ""}` : "nunca"}
          {" · "}
          Umbral: {formatThreshold(job.staleAfterMinutes)}
        </span>
        {job.lastError ? (
          <span data-testid={`job-error-${job.jobName}`} className="text-xs text-muted break-all">
            Último error: {job.lastError}
          </span>
        ) : null}
        {job.state === "stale" ? (
          job.alertActive && job.alertedAt ? (
            <span data-testid={`job-alert-${job.jobName}`} className="text-xs">
              Alerta enviada por correo: {formatDateTimeInBogota(job.alertedAt, "es")}
            </span>
          ) : (
            <span data-testid={`job-alert-${job.jobName}`} className="text-xs font-semibold text-danger">
              Sin alerta por correo todavía
            </span>
          )
        ) : null}
      </div>
      <Chip
        variant={style.variant}
        color={style.color}
        data-testid={`job-state-${job.jobName}`}
        className="self-start"
      >
        {isKnownState(state) ? STATE_LABELS[state] : job.state}
      </Chip>
    </li>
  );
}

export function JobsStatus(props: JobsStatusProps) {
  if ("unavailable" in props) {
    return (
      <Card data-testid="jobs-status">
        <Card.Header>
          <Card.Title>Procesos</Card.Title>
        </Card.Header>
        <Card.Content>
          <p role="alert" data-testid="jobs-status-unavailable" className="text-sm text-danger">
            Estado de los procesos no disponible.
          </p>
        </Card.Content>
      </Card>
    );
  }

  const { jobs, checkedAt } = props;
  const states = jobs.map((job) => job.state);
  const stale = states.filter((state) => state === "stale").length;
  const failing = states.filter((state) => state === "failing").length;
  const never = states.filter((state) => state === "never").length;
  const unknown = states.filter((state) => !isKnownState(state)).length;

  let summary: string;
  let alert: boolean;
  if (jobs.length === 0) {
    summary = "Ningún proceso declarado.";
    alert = true;
  } else if (stale > 0 || failing > 0 || unknown > 0) {
    summary = [
      stale > 0 ? plural(stale, "proceso con retraso", "procesos con retraso") : null,
      failing > 0 ? plural(failing, "proceso sin éxito todavía", "procesos sin éxito todavía") : null,
      unknown > 0 ? plural(unknown, "proceso en estado desconocido", "procesos en estado desconocido") : null,
    ]
      .filter(Boolean)
      .join(" · ");
    alert = true;
  } else if (never > 0) {
    summary = plural(never, "proceso sin latido todavía", "procesos sin latido todavía");
    alert = false;
  } else {
    summary = "Todos los procesos al día.";
    alert = false;
  }

  return (
    <Card data-testid="jobs-status">
      <Card.Header>
        <Card.Title>Procesos</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-2">
        <p
          role={alert ? "alert" : "status"}
          data-testid="jobs-status-summary"
          className={alert ? "text-sm font-semibold text-danger" : "text-sm"}
        >
          {summary}
        </p>
        {jobs.length > 0 ? (
          <ul className="flex flex-col">
            {jobs.map((job) => (
              <JobRow key={job.jobName} job={job} checkedAt={checkedAt} />
            ))}
          </ul>
        ) : null}
        {checkedAt ? (
          <p data-testid="jobs-status-checked-at" className="text-xs text-muted">
            Comprobado: {formatDateTimeInBogota(checkedAt, "es")}
          </p>
        ) : null}
      </Card.Content>
    </Card>
  );
}
