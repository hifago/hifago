import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Écran de modération d'une proposition d'ÉDITION — ce que l'admin VOIT et ce qu'il APPROUVE.
// Constat de Jérôme (2026-10-13, « Exposición Mirarte ») : la date et l'heure saisies par le
// partenaire n'apparaissaient plus ici. Ce fichier prouve, au rendu, les trois gestes de l'écran :
// afficher les valeurs proposées, garder celles de la fiche pour ce que la proposition ne porte
// pas, et renvoyer les unes ou les autres — jamais un champ vide — à l'approbation.

const toast = vi.hoisted(() => ({ success: vi.fn(), danger: vi.fn(), info: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@hifago/supabase/client", () => ({ createClient: () => ({ rpc }) }));

const { ModerateProposalForm } = await import("./ModerateProposalForm");

const MIRARTE_EN_BASE = {
  name: { es: "Exposición Mirarte" },
  description: null,
  price_label: "Entrada libre",
  occurrence_type: "once",
  occurrence_date: "2026-10-15",
  recurrence_frequency_days: null,
  recurrence_end_date: null,
  recurrence_end_count: null,
  start_time: "16:00:00",
  duration_minutes: null,
  online_bookable: false,
};

function rendre(proposedPayload: Record<string, unknown>) {
  render(
    <ModerateProposalForm
      proposalId="propuesta-1"
      expectedVersion={1}
      type="evento"
      currentPayload={MIRARTE_EN_BASE}
      proposedPayload={proposedPayload}
      availableTags={[]}
      currentTagIds={[]}
      availableAmenities={[]}
      currentAmenityIds={[]}
    />,
  );
}

function fechaPropuesta() {
  return (screen.getByTestId("occurrence-date-input") as HTMLInputElement).value;
}

function horaPropuesta() {
  return (screen.getByLabelText("Hora de inicio — opcional") as HTMLInputElement).value;
}

async function aprobar() {
  fireEvent.click(screen.getByTestId("approve-button"));
  await waitFor(() => expect(rpc).toHaveBeenCalled());
  return rpc.mock.calls[0][1].p_corrected_payload as Record<string, unknown>;
}

describe("ModerateProposalForm — evento", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    toast.danger.mockClear();
    toast.success.mockClear();
  });

  it("affiche la date et l'heure PROPOSÉES par le partenaire, à côté de celles en place", async () => {
    rendre({
      name: { es: "Exposición Mirarte" },
      description: null,
      price_label: "gratis",
      occurrence_type: "once",
      occurrence_date: "2026-10-22",
      start_time: "17:30",
      duration_minutes: 90,
    });

    expect(fechaPropuesta()).toBe("2026-10-22");
    expect(horaPropuesta()).toBe("17:30");

    const actual = within(screen.getByTestId("current-values"));
    expect(actual.getByTestId("current-occurrence-date").textContent).toContain("2026-10-15");
    expect(actual.getByTestId("current-start-time").textContent).toContain("16:00");

    expect(await aprobar()).toMatchObject({
      occurrence_date: "2026-10-22",
      start_time: "17:30",
      duration_minutes: 90,
      price_label: "gratis",
    });
  });

  it("une proposition qui ne porte ni date ni heure montre celles de la fiche, et les renvoie", async () => {
    rendre({ name: { es: "Exposición Mirarte" }, description: null, price_label: "gratis" });

    expect(fechaPropuesta()).toBe("2026-10-15");
    expect(horaPropuesta()).toBe("16:00");

    expect(await aprobar()).toMatchObject({
      occurrence_type: "once",
      occurrence_date: "2026-10-15",
      start_time: "16:00",
    });
  });

  it("refuse d'approuver un evento dont la date a été vidée", () => {
    rendre({ name: { es: "Exposición Mirarte" }, occurrence_type: "once", occurrence_date: null });

    fireEvent.click(screen.getByTestId("approve-button"));

    expect(toast.danger).toHaveBeenCalledWith("La fecha es obligatoria para un evento puntual.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("dit pourquoi un evento réservé ne change pas de date : le détail de la base, tel quel", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "HF002",
        message: "occurrence_change_orphans_reservations",
        details: "1 reserva en curso quedaría fuera de las nuevas fechas: 22/10/2026",
      },
    });
    rendre({ name: { es: "Exposición Mirarte" }, occurrence_type: "once", occurrence_date: "2026-10-29" });

    fireEvent.click(screen.getByTestId("approve-button"));

    await waitFor(() =>
      expect(toast.danger).toHaveBeenCalledWith(
        "No se puede guardar el cambio de fecha — 1 reserva en curso quedaría fuera de las nuevas fechas: 22/10/2026.",
      ),
    );
  });
});
