import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Un compte peut avoir plusieurs facteurs (app TOTP, clé de sécurité) : l'écran de défi montre le
// champ de code pour un TOTP et un BOUTON pour une clé (le navigateur exige un geste de la personne),
// et appelle l'API qui correspond au facteur choisi — jamais challengeAndVerify avec une clé.

const toast = vi.hoisted(() => ({ success: vi.fn(), danger: vi.fn(), info: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const mfa = vi.hoisted(() => ({
  challengeAndVerify: vi.fn(),
  webauthn: { authenticate: vi.fn() },
}));

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast,
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({ auth: { mfa } }),
}));

const { MfaVerifyForm } = await import("./MfaVerifyForm");

const APP = { id: "f-app", type: "totp" as const, label: "App de autenticación 1" };
const CLE = { id: "f-key", type: "webauthn" as const, label: "Llave de seguridad 1" };

describe("MfaVerifyForm — défi à la connexion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mfa.challengeAndVerify.mockResolvedValue({ error: null });
    mfa.webauthn.authenticate.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("un seul TOTP : champ de code, aucun choix d'appareil, aucun bouton de clé", () => {
    render(<MfaVerifyForm factors={[APP]} next="/admin" />);
    expect(screen.getByTestId("mfa-verify-submit")).toBeTruthy();
    expect(screen.queryByTestId("mfa-verify-factors")).toBeNull();
    expect(screen.queryByTestId("mfa-verify-use-key")).toBeNull();
  });

  it("une clé seule : un bouton, pas de champ de code ; la présenter appelle webauthn.authenticate", async () => {
    render(<MfaVerifyForm factors={[CLE]} next="/admin" />);
    expect(screen.queryByTestId("mfa-verify-submit")).toBeNull();
    fireEvent.click(screen.getByTestId("mfa-verify-use-key"));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/admin"));
    expect(mfa.webauthn.authenticate).toHaveBeenCalledWith({ factorId: "f-key" });
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("deux facteurs : le choix bascule entre le champ de code et le bouton de la clé", async () => {
    render(<MfaVerifyForm factors={[APP, CLE]} next="/admin" />);
    expect(screen.getByTestId("mfa-verify-submit")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: CLE.label }));
    expect(screen.queryByTestId("mfa-verify-submit")).toBeNull();
    expect(screen.getByTestId("mfa-verify-use-key")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: APP.label }));
    expect(screen.getByTestId("mfa-verify-submit")).toBeTruthy();
  });

  it("une cérémonie annulée est dite comme telle, sans quitter l'écran", async () => {
    mfa.webauthn.authenticate.mockResolvedValue({
      error: { name: "WebAuthnError", code: "ERROR_CEREMONY_ABORTED", message: "x" },
    });
    render(<MfaVerifyForm factors={[CLE]} next="/admin" />);
    fireEvent.click(screen.getByTestId("mfa-verify-use-key"));
    await waitFor(() => expect(toast.danger).toHaveBeenCalled());
    expect(toast.danger.mock.calls[0][0]).toMatch(/cancelada/i);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("une clé refusée par le serveur reste sur l'écran, avec un message d'échec", async () => {
    mfa.webauthn.authenticate.mockResolvedValue({ error: { name: "AuthError", message: "x" } });
    render(<MfaVerifyForm factors={[CLE]} next="/admin" />);
    fireEvent.click(screen.getByTestId("mfa-verify-use-key"));
    await waitFor(() => expect(toast.danger).toHaveBeenCalled());
    expect(toast.danger.mock.calls[0][0]).toMatch(/No se pudo verificar/);
    expect(router.push).not.toHaveBeenCalled();
  });
});
