import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Suppression d'une activité. Représentatif des cinq formulaires (modération, suppression) qui
// réactivaient leur bouton aussitôt la RPC revenue, avant même la navigation : ce fichier prouve
// qu'après un succès le bouton reste inactif — un second clic ne relance jamais la RPC — et qu'après
// un échec il redevient utilisable.

const toast = vi.hoisted(() => ({ success: vi.fn(), danger: vi.fn(), info: vi.fn() }));
const rpc = vi.fn();
const router = { push: vi.fn(), refresh: vi.fn() };

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast,
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@hifago/supabase/client", () => ({ createClient: () => ({ rpc }) }));

const { DeleteProductButton } = await import("./DeleteProductButton");

async function ouvrirEtConfirmer() {
  render(<DeleteProductButton productId="p-1" />);
  fireEvent.click(screen.getByTestId("delete-product-button"));
  fireEvent.click(await screen.findByTestId("confirm-delete-product-button"));
}

describe("DeleteProductButton — double soumission", () => {
  beforeEach(() => {
    rpc.mockReset();
    router.push.mockClear();
    toast.success.mockClear();
  });

  it("succès : le bouton reste inactif pendant la navigation, un second clic ne relance rien", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await ouvrirEtConfirmer();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/admin/products"));
    const bouton = screen.getByTestId("confirm-delete-product-button");
    expect(bouton).toHaveProperty("disabled", true);
    fireEvent.click(bouton);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("échec : le bouton redevient utilisable", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "produit introuvable" } });
    await ouvrirEtConfirmer();
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith("No se pudo eliminar la actividad."));
    expect(screen.getByTestId("confirm-delete-product-button")).toHaveProperty("disabled", false);
  });
});
