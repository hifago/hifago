import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@hifago/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@hifago/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hifago/ui")>()),
  toast: { danger: vi.fn(), success: vi.fn() },
}));

const { ResolvePmsRequestDialog } = await import("./ResolvePmsRequestDialog");
const { toast } = await import("@hifago/ui");

const NUIT_1 = { orderLineId: "l1", productName: "Noche A", date: "2030-01-10", endDate: "2030-01-11" };
const NUIT_2 = { orderLineId: "l2", productName: "Noche B", date: "2030-01-11", endDate: "2030-01-12" };

function monter(action: "retry" | "confirm" | "cancel", lines = [NUIT_1]) {
  const onSuccess = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ResolvePmsRequestDialog
      requestId="r1"
      lines={lines}
      action={action}
      open
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />
  );
  return { onSuccess, onOpenChange };
}

describe("ResolvePmsRequestDialog", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.mocked(toast.danger).mockClear();
  });

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

  it("confirm : UN champ par nuit sans booking, tous facultatifs, envoyés ensemble", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    const { onSuccess } = monter("confirm", [NUIT_1, NUIT_2]);
    expect(screen.getAllByTestId(/^pms-booking-id-input-/)).toHaveLength(2);
    fireEvent.change(screen.getByTestId("pms-booking-id-input-l1"), { target: { value: " 95000123 " } });
    fireEvent.change(screen.getByTestId("pms-booking-id-input-l2"), { target: { value: "95000124" } });
    fireEvent.click(screen.getByTestId("confirm-pms-request-button"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("confirm"));
    expect(rpc).toHaveBeenCalledWith("admin_resolve_pms_booking_request", {
      p_request_id: "r1",
      p_action: "confirm",
      p_bookings: [
        { order_line_id: "l1", pms_booking_id: "95000123" },
        { order_line_id: "l2", pms_booking_id: "95000124" },
      ],
    });
  });

  it("confirm : un champ laissé vide n'est pas envoyé (nuit relogée hors Lobby)", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    const { onSuccess } = monter("confirm", [NUIT_1, NUIT_2]);
    fireEvent.change(screen.getByTestId("pms-booking-id-input-l2"), { target: { value: "95000124" } });
    fireEvent.click(screen.getByTestId("confirm-pms-request-button"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(rpc.mock.calls[0][1].p_bookings).toEqual([{ order_line_id: "l2", pms_booking_id: "95000124" }]);
  });

  it("retry et cancel n'affichent aucun champ de saisie", () => {
    monter("retry", [NUIT_1, NUIT_2]);
    expect(screen.queryAllByTestId(/^pms-booking-id-input-/)).toHaveLength(0);
  });

  it.each([
    ["booking_in_use", /otra orden del mismo establecimiento/],
    ["invalid_bookings", /solo números/],
    ["already_booked", /otra reserva de Lobby/],
    ["not_resolvable", /ya fue procesada/],
    ["line_not_pms", /no está vinculada a Lobby/],
  ])("le refus typé %s affiche son texte, pas le message générique", async (reason, texte) => {
    rpc.mockResolvedValue({ data: { ok: false, reason }, error: null });
    monter("confirm");
    fireEvent.click(screen.getByTestId("confirm-pms-request-button"));
    await waitFor(() => expect(toast.danger).toHaveBeenCalled());
    expect(String(vi.mocked(toast.danger).mock.calls.at(-1)?.[0])).toMatch(texte);
  });

  it("un refus inconnu retombe sur le message générique", async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: "nouveau_code" }, error: null });
    monter("cancel");
    fireEvent.click(screen.getByTestId("confirm-pms-request-button"));
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith("No se pudo procesar la solicitud."));
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
