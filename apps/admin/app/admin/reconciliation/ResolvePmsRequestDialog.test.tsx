import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@hifago/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@hifago/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hifago/ui")>()),
  toast: { danger: vi.fn(), success: vi.fn() },
}));

const { ResolvePmsRequestDialog } = await import("./ResolvePmsRequestDialog");

function monter(action: "retry" | "confirm" | "cancel") {
  const onSuccess = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ResolvePmsRequestDialog
      requestId="r1"
      orderLineId="l1"
      action={action}
      open
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />
  );
  return { onSuccess, onOpenChange };
}

describe("ResolvePmsRequestDialog", () => {
  beforeEach(() => rpc.mockReset());

  it.each([
    ["retry", "Reintentar", /NO existe ninguna reserva/],
    ["confirm", "Confirmar", /correos de confirmación/],
    ["cancel", "Anular solicitud", /No se enviará nada a Lobby/],
  ] as const)("%s : explique le geste avant de l'envoyer", (action, bouton, texte) => {
    monter(action);
    expect(screen.getByTestId("pms-request-dialog-body").textContent).toMatch(texte);
    expect(screen.getByTestId("confirm-pms-request-button").textContent).toBe(bouton);
  });

  it("n'envoie qu'un id de demande et une action (retry), sans réservation", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    const { onSuccess } = monter("retry");
    fireEvent.click(screen.getByTestId("confirm-pms-request-button"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("retry"));
    expect(rpc).toHaveBeenCalledWith("admin_resolve_pms_booking_request", { p_request_id: "r1", p_action: "retry" });
  });

  it("confirm avec un id de booking saisi à la main : l'envoie rattaché à la ligne de l'entrée", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    const { onSuccess } = monter("confirm");
    fireEvent.change(screen.getByTestId("pms-booking-id-input"), { target: { value: " 95000123 " } });
    fireEvent.click(screen.getByTestId("confirm-pms-request-button"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("confirm"));
    expect(rpc).toHaveBeenCalledWith("admin_resolve_pms_booking_request", {
      p_request_id: "r1",
      p_action: "confirm",
      p_bookings: [{ order_line_id: "l1", pms_booking_id: "95000123" }],
    });
  });

  it("confirm sans id saisi : aucune réservation envoyée (relogement hors Lobby)", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    const { onSuccess } = monter("confirm");
    fireEvent.click(screen.getByTestId("confirm-pms-request-button"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(rpc.mock.calls[0][1]).toEqual({ p_request_id: "r1", p_action: "confirm" });
  });

  it("un refus de la base (not_resolvable) ne signale aucun succès à la liste", async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: "not_resolvable" }, error: null });
    const { onSuccess, onOpenChange } = monter("cancel");
    fireEvent.click(screen.getByTestId("confirm-pms-request-button"));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
