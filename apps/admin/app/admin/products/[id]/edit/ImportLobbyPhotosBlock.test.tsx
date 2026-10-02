import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Import des photos LobbyPMS d'un logement. La route répond 503 quand elle n'a pas pu lire ce dont
// elle a besoin (échec fermé) : ce fichier prouve que l'admin lit « réessaie », jamais le texte
// générique qui laisse croire à un refus.

const toast = vi.hoisted(() => ({ success: vi.fn(), danger: vi.fn(), info: vi.fn() }));

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { ImportLobbyPhotosBlock } = await import("./ImportLobbyPhotosBlock");

function repondre(status: number, reason: string) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: false, reason }), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

describe("ImportLobbyPhotosBlock — réponses 503", () => {
  beforeEach(() => toast.danger.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["authorization_unavailable", "No se pudo verificar tu acceso en este momento. Vuelve a intentarlo."],
    ["catalog_unavailable", "No se pudo leer la actividad en este momento. Vuelve a intentarlo."],
  ])("%s : invite à réessayer", async (reason, attendu) => {
    repondre(503, reason);
    render(<ImportLobbyPhotosBlock productId="11111111-1111-4111-8111-111111111111" />);
    fireEvent.click(screen.getByTestId("import-lobby-photos-button"));
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith(attendu));
  });
});
