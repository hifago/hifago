import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";

// Deux parcours, une seule consommation du jeton chacun : sans session, POST
// /api/auth/invitation-signup crée le compte ET consomme l'invitation côté serveur — le navigateur
// ne doit plus la consommer une seconde fois (elle échouerait en `already_consumed` après un
// succès). Avec une session existante (retour Google), c'est ce formulaire qui consomme.

const state = vi.hoisted(() => ({
  push: vi.fn(),
  rpc: vi.fn(),
  toastSuccess: vi.fn(),
  toastDanger: vi.fn(),
}));

vi.mock("@hifago/supabase/client", () => ({ createClient: () => ({ rpc: state.rpc }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/components/GoogleButton", () => ({ OAuthSection: () => null }));
vi.mock("./PartnerTermsModal", () => ({ PartnerTermsModal: () => null }));
vi.mock("@hifago/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hifago/ui")>()),
  toast: { success: state.toastSuccess, danger: state.toastDanger },
}));

const { JoinForm } = await import("./JoinForm");

let reponseInscription: unknown = { ok: true };
const fetchMock = vi.fn(async () => ({ json: async () => reponseInscription }));

async function remplirEtSoumettre(container: HTMLElement, champs: Record<string, string>) {
  await act(async () => {
    for (const [nom, valeur] of Object.entries(champs)) {
      const input = container.querySelector(`input[name="${nom}"]`) as HTMLInputElement;
      fireEvent.change(input, { target: { value: valeur } });
    }
  });
  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
  });
}

describe("JoinForm — une seule consommation de l'invitation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    reponseInscription = { ok: true };
    fetchMock.mockClear();
    state.push.mockClear();
    state.rpc.mockReset();
    state.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    state.toastSuccess.mockClear();
    state.toastDanger.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sans session : le serveur inscrit ET consomme, le navigateur ne consomme pas", async () => {
    const { container } = render(<JoinForm token="jeton" initialUser={null} />);
    await remplirEtSoumettre(container, {
      name: "Ana Pérez",
      email: "socio@test.local",
      password: "secret1234",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/invitation-signup");
    expect(JSON.parse(init.body as string)).toEqual({
      token: "jeton",
      email: "socio@test.local",
      password: "secret1234",
      name: "Ana Pérez",
    });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.toastSuccess).toHaveBeenCalled();
    expect(state.push).toHaveBeenCalledWith("/partner");
  });

  it("sans session : un échec de consommation côté serveur s'affiche, sans redirection", async () => {
    reponseInscription = { ok: false, reason: "consume_failed" };
    const { container } = render(<JoinForm token="jeton" initialUser={null} />);
    await remplirEtSoumettre(container, {
      name: "Ana Pérez",
      email: "socio@test.local",
      password: "secret1234",
    });

    expect(state.toastDanger).toHaveBeenCalledWith("Ocurrió un error. Inténtalo de nuevo.");
    expect(state.push).not.toHaveBeenCalled();
  });

  it("session existante : le formulaire consomme l'invitation lui-même", async () => {
    const { container } = render(
      <JoinForm token="jeton" initialUser={{ email: "g@test.local", fullName: "Gabi" }} />
    );
    await remplirEtSoumettre(container, {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.rpc).toHaveBeenCalledWith("consume_partner_invitation", {
      p_token: "jeton",
      p_signer_name: "Gabi",
      p_document_version: "v1",
    });
    expect(state.push).toHaveBeenCalledWith("/partner");
  });
});
