import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobsStatus, type JobStatusRow } from "./JobsStatus";

// Le bloc « Procesos » est le second canal quand l'alerte par e-mail ne part pas : il ne doit
// JAMAIS dire « al día » sur une panne de lecture, ni compter « sin latido » comme à jour, et il
// doit dire quand un retard n'a déclenché aucune alerte.

const CHECKED_AT = "2026-10-06T20:00:00Z"; // 15:00 à Guatapé

function job(partiel: Partial<JobStatusRow> & { jobName: string }): JobStatusRow {
  return {
    staleAfterMinutes: 20,
    lastOkAt: "2026-10-06T19:55:00Z",
    lastError: null,
    alertedAt: null,
    state: "ok",
    alertActive: false,
    ...partiel,
  };
}

const resume = () => screen.getByTestId("jobs-status-summary");

describe("JobsStatus — bloc « Procesos » de l'accueil admin", () => {
  it("lecture en panne : « no disponible » en alerte, ni liste ni « al día »", () => {
    render(<JobsStatus unavailable />);
    const message = screen.getByTestId("jobs-status-unavailable");
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.textContent).toBe("Estado de los procesos no disponible.");
    expect(screen.queryByTestId("jobs-status-summary")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("tout à jour : résumé en statut, libellé lisible, nom technique, heure de Guatapé et ancienneté", () => {
    render(<JobsStatus jobs={[job({ jobName: "send-notification-emails" })]} checkedAt={CHECKED_AT} />);
    expect(resume().getAttribute("role")).toBe("status");
    expect(resume().textContent).toBe("Todos los procesos al día.");
    const ligne = screen.getByTestId("job-row-send-notification-emails");
    expect(ligne.textContent).toContain("Envío de correos");
    expect(ligne.textContent).toContain("send-notification-emails");
    expect(ligne.textContent).toContain("14:55:00");
    expect(ligne.textContent).toContain("(hace 5 min)");
    expect(ligne.textContent).toContain("Umbral: 20 min");
    expect(screen.getByTestId("job-state-send-notification-emails").textContent).toBe("Al día");
    expect(screen.getByTestId("jobs-status-checked-at").textContent).toContain("15:00:00");
  });

  it("« sin latido todavía » n'est jamais compté à jour", () => {
    render(
      <JobsStatus
        jobs={[
          job({ jobName: "payments-reconcile" }),
          job({ jobName: "pms-nightly-contract-check", state: "never", lastOkAt: null, staleAfterMinutes: 2160 }),
        ]}
        checkedAt={CHECKED_AT}
      />
    );
    expect(resume().textContent).toBe("1 proceso sin latido todavía");
    expect(resume().textContent).not.toContain("al día");
    const ligne = screen.getByTestId("job-row-pms-nightly-contract-check");
    expect(ligne.textContent).toContain("Último éxito: nunca");
    expect(ligne.textContent).toContain("Umbral: 36 h");
    expect(screen.getByTestId("job-state-pms-nightly-contract-check").textContent).toBe("Sin latido todavía");
  });

  it("retard AVEC alerte en cours : résumé en alerte, heure de l'alerte", () => {
    render(
      <JobsStatus
        jobs={[
          job({
            jobName: "pms-poll-bookings",
            state: "stale",
            lastOkAt: "2026-10-06T18:00:00Z",
            alertActive: true,
            alertedAt: "2026-10-06T18:46:00Z",
          }),
        ]}
        checkedAt={CHECKED_AT}
      />
    );
    expect(resume().getAttribute("role")).toBe("alert");
    expect(resume().textContent).toBe("1 proceso con retraso");
    expect(screen.getByTestId("job-row-pms-poll-bookings").textContent).toContain("(hace 2 h)");
    expect(screen.getByTestId("job-state-pms-poll-bookings").textContent).toBe("Con retraso");
    expect(screen.getByTestId("job-alert-pms-poll-bookings").textContent).toContain("Alerta enviada por correo");
  });

  it("retard SANS alerte : « Sin alerta por correo » (le canal e-mail est sans doute tombé)", () => {
    render(
      <JobsStatus
        jobs={[job({ jobName: "send-notification-emails", state: "stale", alertActive: false })]}
        checkedAt={CHECKED_AT}
      />
    );
    expect(screen.getByTestId("job-alert-send-notification-emails").textContent).toBe(
      "Sin alerta por correo todavía"
    );
  });

  it("a tourné sans jamais réussir (`failing`, rendu par la base) : jamais « al día »", () => {
    render(
      <JobsStatus
        jobs={[
          job({ jobName: "payments-reconcile" }),
          job({ jobName: "pms-poll-bookings", state: "failing", lastOkAt: null, lastError: "clave rechazada" }),
        ]}
        checkedAt={CHECKED_AT}
      />
    );
    expect(resume().getAttribute("role")).toBe("alert");
    expect(resume().textContent).toBe("1 proceso sin éxito todavía");
    expect(screen.getByTestId("job-state-pms-poll-bookings").textContent).toBe("Sin éxito todavía");
    expect(screen.getByTestId("job-row-pms-poll-bookings").textContent).toContain("Último éxito: nunca");
  });

  it("affiche la dernière erreur", () => {
    render(
      <JobsStatus
        jobs={[job({ jobName: "pms-sync-availability", lastError: "Lobby 503 (relais injoignable)" })]}
        checkedAt={CHECKED_AT}
      />
    );
    expect(screen.getByTestId("job-error-pms-sync-availability").textContent).toBe(
      "Último error: Lobby 503 (relais injoignable)"
    );
  });

  it("état inconnu ou job sans libellé : rien n'est compté à jour, le nom brut s'affiche", () => {
    render(<JobsStatus jobs={[job({ jobName: "nouveau-job", state: "paused" })]} checkedAt={CHECKED_AT} />);
    expect(resume().getAttribute("role")).toBe("alert");
    expect(resume().textContent).toBe("1 proceso en estado desconocido");
    expect(screen.getByTestId("job-state-nouveau-job").textContent).toBe("paused");
  });

  it("aucun job déclaré : dit en alerte, jamais « al día »", () => {
    render(<JobsStatus jobs={[]} checkedAt={null} />);
    expect(resume().getAttribute("role")).toBe("alert");
    expect(resume().textContent).toBe("Ningún proceso declarado.");
  });
});
