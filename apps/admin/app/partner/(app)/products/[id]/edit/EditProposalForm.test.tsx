import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// « Proponer edición » d'une activité — les horaires (demande Jérôme du 2026-11-04, migration
// 20261104120000). Ce fichier prouve au rendu : l'éditeur montre les horaires en place, la clé
// `slot_rules` ne part QUE s'ils ont changé (sinon l'approbation écraserait les horaires en place),
// et une activité ne se propose jamais sans horaire.

const toast = vi.hoisted(() => ({ success: vi.fn(), danger: vi.fn(), info: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@hifago/supabase/client", () => ({ createClient: () => ({ rpc }) }));

const { EditProposalForm } = await import("./EditProposalForm");

const KAYAK = { name: { es: "Kayak" }, description: null, price_cop: 50000, pricing_unit: "per_person" };
const HORARIO = { weekdays: [1], start_time: "09:00:00", end_time: "12:00:00", slot_duration_minutes: 60, capacity: 4 };

function rendre(currentSlotRules: unknown[] = [HORARIO]) {
  render(
    <EditProposalForm
      productId="kayak-1"
      type="activity"
      currentPayload={KAYAK}
      pendingProposal={null}
      availableTags={[]}
      currentTagIds={[]}
      availableAmenities={[]}
      currentAmenityIds={[]}
      currentSlotRules={currentSlotRules}
      establishmentId="est-1"
      establishmentLobbyConnected={false}
    />,
  );
}

async function envoyer() {
  fireEvent.click(screen.getByTestId("submit-proposal-button"));
  await waitFor(() => expect(rpc).toHaveBeenCalled());
  return rpc.mock.calls[0][1].p_payload as Record<string, unknown>;
}

describe("EditProposalForm — horarios de una actividad", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { ok: true, proposal_id: "p-1" }, error: null });
    toast.danger.mockClear();
  });

  it("l'éditeur montre les horaires en place", () => {
    rendre();
    expect((screen.getByTestId("slot-rule-start-0") as HTMLInputElement).value).toBe("09:00");
    expect((screen.getByTestId("slot-rule-capacity-0") as HTMLInputElement).value).toBe("4");
  });

  it("horaires inchangés : la proposition ne porte pas slot_rules", async () => {
    rendre();
    expect(await envoyer()).not.toHaveProperty("slot_rules");
  });

  it("une capacité changée : la proposition porte tous les horaires", async () => {
    rendre();
    fireEvent.change(screen.getByTestId("slot-rule-capacity-0"), { target: { value: "6" } });
    expect((await envoyer()).slot_rules).toEqual([
      { weekdays: [1], start_time: "09:00", end_time: "12:00", slot_duration_minutes: 60, capacity: 6 },
    ]);
  });

  it("tous les horaires retirés : refusé avant l'envoi", () => {
    rendre();
    fireEvent.click(screen.getByTestId("remove-slot-rule-0"));
    fireEvent.click(screen.getByTestId("submit-proposal-button"));
    expect(toast.danger).toHaveBeenCalledWith("Una actividad necesita al menos un horario.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("une fiche ancienne sans horaire corrige encore son nom sans en créer un", async () => {
    rendre([]);
    expect(await envoyer()).not.toHaveProperty("slot_rules");
  });
});
