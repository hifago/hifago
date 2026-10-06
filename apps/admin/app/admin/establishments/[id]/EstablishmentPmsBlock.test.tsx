import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Case « misma cuenta de LobbyPMS » (décision D1, migration 20261004005336) : remplacer un jeton
// suppose un AUTRE compte, sauf rotation déclarée. Ce fichier prouve qu'elle n'apparaît que pour un
// remplacement (jeton existant + nouveau jeton tapé), qu'elle est décochée par défaut, et que la RPC
// reçoit exactement ce que l'admin a choisi — jamais `true` hors remplacement.

const toast = vi.hoisted(() => ({ success: vi.fn(), danger: vi.fn(), info: vi.fn() }));
const rpc = vi.fn();
const router = { push: vi.fn(), refresh: vi.fn() };

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast,
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@hifago/supabase/client", () => ({ createClient: () => ({ rpc }) }));

const { EstablishmentPmsBlock } = await import("./EstablishmentPmsBlock");

function afficher(initialHasToken: boolean) {
  render(
    <EstablishmentPmsBlock
      establishmentId="e-1"
      initialConnectorActive
      initialHasToken={initialHasToken}
      initialLastSyncedAt={null}
    />
  );
}

function taperJeton(valeur: string) {
  fireEvent.change(screen.getByTestId("pms-token-input"), { target: { value: valeur } });
}

async function enregistrer() {
  fireEvent.change(screen.getByTestId("pms-reason-input"), { target: { value: "rotation du jeton" } });
  fireEvent.click(screen.getByTestId("save-pms-connector-button"));
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  return rpc.mock.calls[0][1] as Record<string, unknown>;
}

describe("EstablishmentPmsBlock — même compte Lobby", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it("premier jeton (aucun en base) : pas de case, jamais `true`", async () => {
    afficher(false);
    taperJeton("nouveau-jeton");
    expect(screen.queryByTestId("pms-same-lobby-account-checkbox")).toBeNull();
    expect((await enregistrer()).p_same_lobby_account).toBe(false);
  });

  it("jeton en base, champ vide (bascule du connecteur) : pas de case", () => {
    afficher(true);
    expect(screen.queryByTestId("pms-same-lobby-account-checkbox")).toBeNull();
  });

  it("remplacement : case proposée, décochée par défaut — autre compte supposé", async () => {
    afficher(true);
    taperJeton("nouveau-jeton");
    const caseAcocher = within(screen.getByTestId("pms-same-lobby-account-checkbox")).getByRole("checkbox");
    expect((caseAcocher as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("pms-same-lobby-account-help").textContent).toContain("verificación manual");
    expect((await enregistrer()).p_same_lobby_account).toBe(false);
  });

  it("remplacement déclaré sur le même compte : la RPC le reçoit", async () => {
    afficher(true);
    taperJeton("nouveau-jeton");
    fireEvent.click(within(screen.getByTestId("pms-same-lobby-account-checkbox")).getByRole("checkbox"));
    const args = await enregistrer();
    expect(args).toMatchObject({ p_establishment_id: "e-1", p_lobby_api_token: "nouveau-jeton", p_same_lobby_account: true });
  });

  it("cochée puis jeton effacé : plus un remplacement, jamais `true`", async () => {
    afficher(true);
    taperJeton("nouveau-jeton");
    fireEvent.click(within(screen.getByTestId("pms-same-lobby-account-checkbox")).getByRole("checkbox"));
    taperJeton("");
    expect((await enregistrer()).p_same_lobby_account).toBe(false);
  });

  it("cochée, jeton effacé puis retapé : la case revient décochée — la déclaration est à refaire", () => {
    afficher(true);
    taperJeton("nouveau-jeton");
    fireEvent.click(within(screen.getByTestId("pms-same-lobby-account-checkbox")).getByRole("checkbox"));
    expect(screen.getByTestId("pms-same-lobby-account-help").textContent).toContain("Márcalo solo si es la misma cuenta");
    taperJeton("");
    taperJeton("autre-jeton");
    const caseAcocher = within(screen.getByTestId("pms-same-lobby-account-checkbox")).getByRole("checkbox");
    expect((caseAcocher as HTMLInputElement).checked).toBe(false);
  });

  it("après un enregistrement, « Editar de nuevo » repart d'une case décochée", async () => {
    afficher(true);
    taperJeton("nouveau-jeton");
    fireEvent.click(within(screen.getByTestId("pms-same-lobby-account-checkbox")).getByRole("checkbox"));
    expect((await enregistrer()).p_same_lobby_account).toBe(true);
    fireEvent.click(await screen.findByText("Editar de nuevo"));
    taperJeton("autre-jeton");
    const caseAcocher = within(screen.getByTestId("pms-same-lobby-account-checkbox")).getByRole("checkbox");
    expect((caseAcocher as HTMLInputElement).checked).toBe(false);
  });
});
