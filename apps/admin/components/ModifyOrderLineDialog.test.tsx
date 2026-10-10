import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// modify_order_line refuse de modifier en place une prestation liée au PMS ou qui occupe l'espace
// partagé (20261006204938) : l'écran le dit, au lieu de « No se pudo modificar ».

const toast = vi.hoisted(() => ({ success: vi.fn(), danger: vi.fn(), info: vi.fn() }));
let reponse: { data: unknown; error: { code?: string; message: string } | null } = {
  data: { ok: true },
  error: null,
};

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast,
}));

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({ rpc: async () => reponse }),
}));

const { ModifyOrderLineDialog, describeModifyFailure } = await import("./ModifyOrderLineDialog");

const PMS = "Esta reserva está vinculada al PMS del alojamiento y no se puede modificar desde aquí.";
const RESSOURCE = "Esta reserva ocupa el espacio compartido del establecimiento y no se puede modificar.";

async function soumettre() {
  render(
    <ModifyOrderLineDialog
      orderLineId="ol-1"
      initialDate="2026-11-01"
      initialEndDate={null}
      initialQty={2}
      open
      onOpenChange={() => {}}
      onSuccess={() => {}}
    />
  );
  fireEvent.change(await screen.findByTestId("modify-reason-input"), { target: { value: "Cambio pedido" } });
  fireEvent.click(screen.getByTestId("confirm-modify-button"));
}

describe("ModifyOrderLineDialog — refus de modification", () => {
  beforeEach(() => {
    toast.danger.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["pms_line_not_modifiable", PMS],
    ["resource_line_not_modifiable", RESSOURCE],
  ])("refus %s rendu par la RPC : son texte dans le toast", async (reason, texte) => {
    reponse = { data: { ok: false, reason }, error: null };
    await soumettre();
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith(texte));
  });

  it("exception de la RPC : le texte générique, jamais le message SQL", async () => {
    reponse = { data: null, error: { code: "P0001", message: "capacité insuffisante" } };
    await soumettre();
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith("No se pudo modificar la reserva."));
  });

  it("describeModifyFailure : motif inconnu ou absent → générique ; 42501 → permission", () => {
    expect(describeModifyFailure(null, "motif_inconnu")).toBe("No se pudo modificar la reserva.");
    expect(describeModifyFailure(null, undefined)).toBe("No se pudo modificar la reserva.");
    expect(describeModifyFailure({ code: "42501", message: "refus" }, undefined)).toBe(
      "No tienes permiso para esta acción."
    );
  });
});
