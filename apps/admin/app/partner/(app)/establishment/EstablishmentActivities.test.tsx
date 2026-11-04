import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Migration 20261104130000 — une proposition de service refusée reste sur l'écran du partenaire,
// avec son motif, « Corregir » (formulaire prérempli) et « Descartar ». « Corregir » n'apparaît pas
// tant que l'établissement, lui aussi refusé, n'a pas été corrigé : la RPC refuserait l'envoi.

const toast = vi.hoisted(() => ({ success: vi.fn(), danger: vi.fn(), info: vi.fn() }));
const rpc = vi.fn();

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast,
}));
vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    rpc,
    storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x/${path}` } }) }) },
  }),
}));

const { EstablishmentActivities } = await import("./EstablishmentActivities");

const rechazada = {
  id: "p-1",
  type: "activity",
  payload: { name: { es: "Cabalgata" } },
  created_at: "2026-11-04T10:00:00Z",
  status: "rejected",
  rejectionReason: "Faltan los horarios",
};

describe("EstablishmentActivities — proposition refusée", () => {
  beforeEach(() => {
    rpc.mockReset();
    toast.success.mockReset();
  });

  it("montre le motif et un lien « Corregir » vers le formulaire prérempli", () => {
    render(<EstablishmentActivities establishmentId="e-1" products={[]} pendingCreations={[rechazada]} />);

    expect(screen.getByText("Rechazada")).toBeTruthy();
    expect(screen.getByTestId("rejection-reason-p-1").textContent).toContain("Faltan los horarios");
    expect(screen.getByTestId("correct-product-proposal-p-1").getAttribute("href")).toBe(
      "/partner/products/new?corregir=p-1",
    );
    expect(screen.getByTestId("withdraw-product-creation-p-1").textContent).toBe("Descartar");
  });

  it("ne propose pas « Corregir » tant que l'établissement reste refusé", () => {
    render(
      <EstablishmentActivities
        establishmentId="ep-1"
        products={[]}
        pendingCreations={[rechazada]}
        establishmentRejected
      />,
    );

    expect(screen.queryByTestId("correct-product-proposal-p-1")).toBeNull();
    expect(screen.getByText("Podrás corregirla cuando corrijas el establecimiento.")).toBeTruthy();
  });

  it("« Descartar » retire la proposition refusée", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    render(<EstablishmentActivities establishmentId="e-1" products={[]} pendingCreations={[rechazada]} />);

    fireEvent.click(screen.getByTestId("withdraw-product-creation-p-1"));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Propuesta descartada."));
    expect(rpc).toHaveBeenCalledWith("withdraw_product_proposal", { p_proposal_id: "p-1" });
    expect(screen.queryByTestId("pending-product-creation-p-1")).toBeNull();
  });

  it("une proposition en attente garde « Retirar », sans motif", () => {
    render(
      <EstablishmentActivities
        establishmentId="e-1"
        products={[]}
        pendingCreations={[{ ...rechazada, status: "pending", rejectionReason: null }]}
      />,
    );

    expect(screen.getByText("Pendiente de revisión")).toBeTruthy();
    expect(screen.queryByTestId("rejection-reason-p-1")).toBeNull();
    expect(screen.getByTestId("withdraw-product-creation-p-1").textContent).toBe("Retirar");
  });
});
