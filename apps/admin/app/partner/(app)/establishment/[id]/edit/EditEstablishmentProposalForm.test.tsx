import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Proposition d'édition d'un établissement par le partenaire — toute la fiche depuis le 2026-10-14
// (migration 20261015004421). Ce fichier prouve, au rendu, ce que le formulaire ENVOIE : une clé
// de séjour, de contact, d'étiquettes ou d'équipements n'entre que si sa valeur a changé (présente,
// elle REMPLACE la valeur à l'approbation), et le séjour part toujours en bloc.

const toast = vi.hoisted(() => ({ success: vi.fn(), danger: vi.fn(), info: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast,
}));
vi.mock("@hifago/supabase/client", () => ({ createClient: () => ({ rpc }) }));
// La recherche d'adresse Google charge un script tiers : hors sujet ici.
vi.mock("@/components/use-address-autocomplete", () => ({ useAddressAutocomplete: () => ({ current: null }) }));

const { EditEstablishmentProposalForm } = await import("./EditEstablishmentProposalForm");

function rendre({ isPlace = false }: { isPlace?: boolean } = {}) {
  render(
    <EditEstablishmentProposalForm
      establishmentId="e-1"
      initialNameEs="Hostal Kayam"
      initialDescriptionEs=""
      initialDescriptionEn=""
      initialAddress="Cra 30"
      initialLat="6.23"
      initialLon="-75.16"
      initialStay={{ checkIn: "15:00", checkOut: "11:00", mode: "rooms" }}
      initialContactPhone="+573001112233"
      isPlace={isPlace}
      pendingProposal={null}
      availableTags={[]}
      currentTagIds={[]}
      availableAmenities={[]}
      currentAmenityIds={[]}
    />,
  );
}

function saisir(testId: string, valeur: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value: valeur } });
}

async function envoyer() {
  fireEvent.click(screen.getByTestId("submit-edit-proposal-button"));
  await waitFor(() => expect(rpc).toHaveBeenCalled());
  return rpc.mock.calls[0][1].p_payload as Record<string, unknown>;
}

describe("EditEstablishmentProposalForm", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { ok: true, proposal_id: "p-1" }, error: null });
    toast.danger.mockClear();
  });

  it("montre les sections de la fiche admin, Alojamiento compris", () => {
    rendre();
    for (const section of ["general", "stay", "contact", "catalog", "pms"]) {
      expect(screen.getByTestId(`edit-proposal-${section}-section`)).toBeTruthy();
    }
    expect((screen.getByTestId("establishment-check-in-input") as HTMLInputElement).value).toBe("15:00");
    expect((screen.getByTestId("establishment-contact-phone-input") as HTMLInputElement).value).toBe("+573001112233");
  });

  it("rien de changé : ni séjour, ni contact, ni étiquettes, ni équipements dans la proposition", async () => {
    rendre();
    const payload = await envoyer();
    for (const cle of ["check_in_time", "check_out_time", "mode", "contact_phone", "tag_ids", "amenity_ids"]) {
      expect(payload).not.toHaveProperty(cle);
    }
    expect(payload.name).toEqual({ es: "Hostal Kayam" });
  });

  it("un horaire changé envoie les trois clés du séjour, et seulement elles", async () => {
    rendre();
    saisir("establishment-check-in-input", "14:00");
    const payload = await envoyer();
    expect(payload).toMatchObject({ check_in_time: "14:00", check_out_time: "11:00", mode: "rooms" });
    expect(payload).not.toHaveProperty("contact_phone");
  });

  it("un contact vidé part à null : c'est une demande de retirer le bouton WhatsApp", async () => {
    rendre();
    saisir("establishment-contact-phone-input", "");
    const payload = await envoyer();
    expect(payload).toHaveProperty("contact_phone", null);
    expect(payload).not.toHaveProperty("check_in_time");
  });

  it("un numéro hors E.164 est signalé et bloque l'envoi", () => {
    rendre();
    saisir("establishment-contact-phone-input", "3001234567");
    expect(screen.getByTestId("establishment-contact-phone-error")).toBeTruthy();
    expect((screen.getByTestId("submit-edit-proposal-button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("un lieu n'a pas de section Alojamiento, et n'envoie jamais de séjour", async () => {
    rendre({ isPlace: true });
    expect(screen.queryByTestId("edit-proposal-stay-section")).toBeNull();
    const payload = await envoyer();
    expect(payload).not.toHaveProperty("mode");
  });
});
