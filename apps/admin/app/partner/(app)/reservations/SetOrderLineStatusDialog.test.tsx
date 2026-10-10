import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dialogue socio « Cliente no vino » / « Cancelar reserva ». Représentatif des sept dialogues qui
// affichaient le texte brut d'une erreur de RPC : ce fichier prouve que l'écran reçoit un texte
// écrit pour lui (lib/errors/rpcErrorMessage.ts), jamais le message SQL.

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

const { SetOrderLineStatusDialog } = await import("./SetOrderLineStatusDialog");

async function soumettre() {
  render(
    <SetOrderLineStatusDialog
      orderLineId="ol-1"
      targetStatus="no_show"
      open
      onOpenChange={() => {}}
      onSuccess={() => {}}
    />
  );
  fireEvent.change(await screen.findByTestId("status-reason-input"), { target: { value: "No vino" } });
  fireEvent.click(screen.getByTestId("confirm-status-button"));
}

describe("SetOrderLineStatusDialog — erreur de la RPC", () => {
  beforeEach(() => {
    toast.danger.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("erreur métier : le texte du dialogue, jamais le message SQL", async () => {
    reponse = {
      data: null,
      error: { code: "P0001", message: "transition interdite : cancelled_by_client → no_show" },
    };
    await soumettre();
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith("No se pudo actualizar la reserva."));
  });

  it("refus métier HF001 : son texte, reconnu par le code", async () => {
    reponse = {
      data: null,
      error: { code: "HF001", message: "transition refusée : une commande payée n'expire pas" },
    };
    await soumettre();
    await waitFor(() =>
      expect(toast.danger).toHaveBeenCalledWith("Una reserva pagada no puede marcarse como expirada. Elige otro estado.")
    );
  });

  it("refus de droits : dit comme tel", async () => {
    reponse = { data: null, error: { code: "42501", message: "has_capability: refus" } };
    await soumettre();
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith("No tienes permiso para esta acción."));
  });
});
