import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REF_CODE_MAX_LENGTH } from "@hifago/domain";

// Les deux saisies admin d'un code de parrainage (création de partenaire, invitation) refusent un
// code plus long que la borne de la vitrine (REF_CODE_MAX_LENGTH) : créé, il serait ignoré par la
// vitrine et son attribution perdue en silence. Refus explicite, sans aucun appel à la base.

const toast = vi.hoisted(() => ({ success: vi.fn(), danger: vi.fn(), info: vi.fn() }));
const rpc = vi.fn(async () => ({ data: null, error: { code: "P0001", message: "stop" } }));

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@hifago/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/components/address-autocomplete", () => ({ mountAddressAutocomplete: () => () => {} }));

const { NewPartnerForm } = await import("./NewPartnerForm");
const { NewInvitationForm } = await import("../../invitations/new/NewInvitationForm");

const TROP_LONG = "x".repeat(REF_CODE_MAX_LENGTH + 1);
const MESSAGE = `El código no puede tener más de ${REF_CODE_MAX_LENGTH} caracteres.`;

describe("borne de longueur d'un code de parrainage", () => {
  beforeEach(() => {
    toast.danger.mockClear();
    rpc.mockClear();
  });

  it("création de partenaire : un code trop long est refusé, sans appel", async () => {
    render(<NewPartnerForm />);
    fireEvent.change(screen.getByTestId("display-name-input"), { target: { value: "Socio" } });
    fireEvent.change(screen.getByTestId("code-input"), { target: { value: TROP_LONG } });
    fireEvent.click(screen.getByTestId("create-partner-button"));
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith(MESSAGE));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("création de partenaire : un code à la borne passe la validation", async () => {
    render(<NewPartnerForm />);
    fireEvent.change(screen.getByTestId("display-name-input"), { target: { value: "Socio" } });
    fireEvent.change(screen.getByTestId("code-input"), {
      target: { value: "x".repeat(REF_CODE_MAX_LENGTH) },
    });
    fireEvent.click(screen.getByTestId("create-partner-button"));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(toast.danger).not.toHaveBeenCalledWith(MESSAGE);
  });

  it("invitation : un code trop long est refusé, sans appel", async () => {
    const { container } = render(<NewInvitationForm />);
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: TROP_LONG } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith(MESSAGE));
    expect(rpc).not.toHaveBeenCalled();
  });
});
