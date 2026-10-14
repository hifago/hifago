import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";

// Deux parcours, une seule consommation du jeton chacun : sans session, POST
// /api/auth/invitation-signup crée le compte ET consomme l'invitation côté serveur — le navigateur
// ne doit plus la consommer une seconde fois (elle échouerait en `already_consumed` après un
// succès). Avec une session existante (retour Google), c'est ce formulaire qui consomme.

const state = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  rpc: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  toastSuccess: vi.fn(),
  toastDanger: vi.fn(),
}));

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({ rpc: state.rpc, auth: { signOut: state.signOut } }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, replace: state.replace, refresh: state.refresh }),
}));
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

  it("sans session : un mot de passe hors règle n'est jamais envoyé", async () => {
    const { container } = render(<JoinForm token="jeton" initialUser={null} />);
    await remplirEtSoumettre(container, {
      name: "Ana Pérez",
      email: "socio@test.local",
      password: "sinchiffres",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.toastDanger).toHaveBeenCalledWith(
      "La contraseña debe tener al menos 8 caracteres, con letras y números."
    );
  });

  it("sans session : le refus `weak_password` de la route affiche la règle", async () => {
    reponseInscription = { ok: false, reason: "weak_password" };
    const { container } = render(<JoinForm token="jeton" initialUser={null} />);
    await remplirEtSoumettre(container, {
      name: "Ana Pérez",
      email: "socio@test.local",
      password: "secret1234",
    });

    expect(state.toastDanger).toHaveBeenCalledWith(
      "La contraseña debe tener al menos 8 caracteres, con letras y números."
    );
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

// Invitation envoyée PAR E-MAIL : l'inscription exige cette même adresse (consume_partner_invitation
// refuse sinon : `email_mismatch`). Le champ est verrouillé ; une invitation par simple lien reste libre.
describe("JoinForm — invitation liée à son e-mail", () => {
  const INVITEE = "socio@ejemplo.co";
  const MESSAGE = `Esta invitación fue enviada a ${INVITEE}: usa esa misma dirección para unirte.`;

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    reponseInscription = { ok: true };
    fetchMock.mockClear();
    state.push.mockClear();
    state.refresh.mockClear();
    state.replace.mockClear();
    state.signOut.mockClear();
    state.rpc.mockReset();
    state.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    state.toastSuccess.mockClear();
    state.toastDanger.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const champEmail = (container: HTMLElement) =>
    container.querySelector('input[name="email"]') as HTMLInputElement;

  it("sans session : champ pré-rempli, non modifiable, avec la mention ; l'inscription part avec cette adresse", async () => {
    const { container, getByTestId } = render(
      <JoinForm token="jeton" initialUser={null} invitedEmail={INVITEE} />
    );
    expect(champEmail(container).value).toBe(INVITEE);
    expect(champEmail(container).readOnly).toBe(true);
    expect(getByTestId("join-invited-email").textContent).toBe(`Esta invitación fue enviada a ${INVITEE}.`);

    await remplirEtSoumettre(container, { name: "Ana Pérez", password: "secret1234" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).email).toBe(INVITEE);
  });

  it("invitation par simple lien : champ libre, vide, sans mention", () => {
    const { container, queryByTestId } = render(<JoinForm token="jeton" initialUser={null} invitedEmail={null} />);
    expect(champEmail(container).value).toBe("");
    expect(champEmail(container).readOnly).toBe(false);
    expect(queryByTestId("join-invited-email")).toBeNull();
  });

  it("refus `email_mismatch` de la route : le message nomme l'adresse de l'invitation", async () => {
    reponseInscription = { ok: false, reason: "email_mismatch" };
    const { container } = render(<JoinForm token="jeton" initialUser={null} invitedEmail={INVITEE} />);
    await remplirEtSoumettre(container, { name: "Ana Pérez", password: "secret1234" });
    expect(state.toastDanger).toHaveBeenCalledWith(MESSAGE);
    expect(state.push).not.toHaveBeenCalled();
  });

  it("retour du callback Google avec le motif : alerte en tête, adresse nommée si connue", () => {
    const { getByTestId, unmount } = render(
      <JoinForm token="jeton" initialUser={null} invitedEmail={INVITEE} initialError="email_mismatch" />
    );
    expect(getByTestId("join-email-mismatch").getAttribute("role")).toBe("alert");
    expect(getByTestId("join-email-mismatch").textContent).toBe(MESSAGE);
    unmount();

    const sansAdresse = render(<JoinForm token="jeton" initialUser={null} initialError="email_mismatch" />);
    expect(sansAdresse.getByTestId("join-email-mismatch").textContent).toBe(
      "Esta invitación fue enviada a otra dirección de correo: usa esa misma dirección para unirte."
    );
  });

  it("session sur un autre compte : prévenu, et peut se déconnecter sans quitter l'invitation", async () => {
    const { getByTestId } = render(
      <JoinForm token="jeton" initialUser={{ email: "otra@gmail.com", fullName: "Ana" }} invitedEmail={INVITEE} />
    );
    expect(getByTestId("join-invited-email-session").textContent).toBe(`Esta invitación fue enviada a ${INVITEE}.`);
    expect(getByTestId("join-wrong-account").getAttribute("role")).toBe("alert");
    await act(async () => {
      fireEvent.click(getByTestId("join-switch-account"));
    });
    expect(state.signOut).toHaveBeenCalledTimes(1);
    // Reste sur l'invitation, sans le motif d'erreur.
    expect(state.replace).toHaveBeenCalledWith("/partner/join?token=jeton");
    expect(state.push).not.toHaveBeenCalled();
  });

  it("session sur le bon compte (casse différente) : aucun avertissement", () => {
    const { queryByTestId } = render(
      <JoinForm token="jeton" initialUser={{ email: "Socio@Ejemplo.co", fullName: "Ana" }} invitedEmail={INVITEE} />
    );
    expect(queryByTestId("join-wrong-account")).toBeNull();
  });

  it("session : refus `email_mismatch` de la consommation, message nommant l'adresse", async () => {
    state.rpc.mockResolvedValue({ data: { ok: false, reason: "email_mismatch" }, error: null });
    const { container } = render(
      <JoinForm token="jeton" initialUser={{ email: "otra@gmail.com", fullName: "Ana" }} invitedEmail={INVITEE} />
    );
    await remplirEtSoumettre(container, {});
    expect(state.toastDanger).toHaveBeenCalledWith(MESSAGE);
    expect(state.push).not.toHaveBeenCalled();
  });
});
