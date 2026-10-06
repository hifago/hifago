import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// `secure_password_change` actif : une session de plus de 24 h reçoit `reauthentication_needed`.
// Le bloc fait alors envoyer un code par e-mail et renvoie le MÊME mot de passe avec ce code. Une
// session récente change directement, sans code.

type Reponse = { error: { code: string } | null };
const state = vi.hoisted(() => ({
  updateUser: vi.fn(async (): Promise<Reponse> => ({ error: null })),
  reauthenticate: vi.fn(async (): Promise<Reponse> => ({ error: null })),
  toastSuccess: vi.fn(),
  toastDanger: vi.fn(),
}));

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({ auth: { updateUser: state.updateUser, reauthenticate: state.reauthenticate } }),
}));
vi.mock("@hifago/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hifago/ui")>()),
  toast: { success: state.toastSuccess, danger: state.toastDanger },
}));

const { PasswordBlock } = await import("./PasswordBlock");

const POLITIQUE = "La contraseña debe tener al menos 8 caracteres, con letras y números.";

function champ(testId: string) {
  return screen.getByTestId(testId) as HTMLInputElement;
}

async function saisir(testId: string, valeur: string) {
  await act(async () => {
    fireEvent.change(champ(testId), { target: { value: valeur } });
  });
}

async function soumettre(container: HTMLElement) {
  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
  });
}

async function demanderChangement(password = "NuevaClave1") {
  const rendu = render(<PasswordBlock />);
  await saisir("account-password-input", password);
  await saisir("account-confirm-password-input", password);
  await soumettre(rendu.container);
  return rendu;
}

describe("PasswordBlock — règle et ré-authentification", () => {
  beforeEach(() => {
    state.updateUser.mockReset();
    state.updateUser.mockResolvedValue({ error: null });
    state.reauthenticate.mockReset();
    state.reauthenticate.mockResolvedValue({ error: null });
    state.toastSuccess.mockClear();
    state.toastDanger.mockClear();
  });

  it("refuse un mot de passe hors règle avant l'envoi", async () => {
    await demanderChangement("sinchiffres");
    expect(state.updateUser).not.toHaveBeenCalled();
    expect(state.toastDanger).toHaveBeenCalledWith(POLITIQUE);
  });

  it("session récente : changement direct, aucun code demandé", async () => {
    await demanderChangement();
    expect(state.updateUser).toHaveBeenCalledWith({ password: "NuevaClave1" });
    expect(state.reauthenticate).not.toHaveBeenCalled();
    expect(state.toastSuccess).toHaveBeenCalledWith("Contraseña actualizada.");
    expect(screen.queryByTestId("account-reauth-code-input")).toBeNull();
  });

  it("session ancienne : envoie un code, puis renvoie le même mot de passe avec ce code", async () => {
    state.updateUser.mockResolvedValueOnce({ error: { code: "reauthentication_needed" } });
    const { container } = await demanderChangement();

    expect(state.reauthenticate).toHaveBeenCalledTimes(1);
    expect(state.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId("account-reauth-code-hint").textContent).toContain("código a tu correo");
    expect(document.activeElement).toBe(champ("account-reauth-code-input"));

    await saisir("account-reauth-code-input", " 123456 ");
    await soumettre(container);

    expect(state.updateUser).toHaveBeenLastCalledWith({ password: "NuevaClave1", nonce: "123456" });
    expect(state.toastSuccess).toHaveBeenCalledWith("Contraseña actualizada.");
    expect(screen.queryByTestId("account-reauth-code-input")).toBeNull();
    expect(champ("account-password-input").value).toBe("");
  });

  it("code refusé : le dit, et laisse redemander un code", async () => {
    state.updateUser.mockResolvedValueOnce({ error: { code: "reauthentication_needed" } });
    const { container } = await demanderChangement();
    state.updateUser.mockResolvedValueOnce({ error: { code: "reauthentication_not_valid" } });
    await saisir("account-reauth-code-input", "000000");
    await soumettre(container);

    expect(state.toastDanger).toHaveBeenCalledWith("El código no es válido o ya venció. Pide uno nuevo.");
    expect(screen.getByTestId("account-reauth-code-input")).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("resend-reauth-code-button"));
    });
    expect(state.reauthenticate).toHaveBeenCalledTimes(2);
    expect(state.toastSuccess).toHaveBeenCalledWith("Te enviamos un código nuevo.");
  });

  it("refus après le code (même mot de passe) : se corrige sans redemander de code", async () => {
    state.updateUser.mockResolvedValueOnce({ error: { code: "reauthentication_needed" } });
    const { container } = await demanderChangement();
    state.updateUser.mockResolvedValueOnce({ error: { code: "same_password" } });
    await saisir("account-reauth-code-input", "123456");
    await soumettre(container);
    expect(state.toastDanger).toHaveBeenCalledWith("La nueva contraseña debe ser distinta de la actual.");
    expect(champ("account-password-input").disabled).toBe(false);
    expect(champ("account-confirm-password-input").disabled).toBe(false);

    await saisir("account-password-input", "OtraClave2");
    await saisir("account-confirm-password-input", "OtraClave2");
    await soumettre(container);
    expect(state.updateUser).toHaveBeenLastCalledWith({ password: "OtraClave2", nonce: "123456" });
    expect(state.reauthenticate).toHaveBeenCalledTimes(1);
  });

  it("code vide : rien n'est envoyé", async () => {
    state.updateUser.mockResolvedValueOnce({ error: { code: "reauthentication_needed" } });
    const { container } = await demanderChangement();
    await soumettre(container);
    expect(state.updateUser).toHaveBeenCalledTimes(1);
    expect(state.toastDanger).toHaveBeenCalledWith("Ingresa el código que te enviamos por correo.");
  });

  it("envoi du code impossible : le dit, sans afficher de champ de code", async () => {
    state.updateUser.mockResolvedValueOnce({ error: { code: "reauthentication_needed" } });
    state.reauthenticate.mockResolvedValueOnce({ error: { code: "over_email_send_rate_limit" } });
    await demanderChangement();
    expect(state.toastDanger).toHaveBeenCalledWith("Espera unos segundos antes de pedir otro código.");
    expect(screen.queryByTestId("account-reauth-code-input")).toBeNull();
  });

  it("annuler revient au formulaire vide", async () => {
    state.updateUser.mockResolvedValueOnce({ error: { code: "reauthentication_needed" } });
    await demanderChangement();
    await act(async () => {
      fireEvent.click(screen.getByTestId("cancel-password-change-button"));
    });
    expect(screen.queryByTestId("account-reauth-code-input")).toBeNull();
    expect(champ("account-password-input").value).toBe("");
  });

  it("second facteur exigé : message dédié", async () => {
    state.updateUser.mockResolvedValueOnce({ error: { code: "insufficient_aal" } });
    await demanderChangement();
    expect(state.toastDanger).toHaveBeenCalledWith(
      "Para cambiar la contraseña, primero confirma tu verificación en dos pasos."
    );
  });

  it("même mot de passe qu'avant : message dédié", async () => {
    state.updateUser.mockResolvedValueOnce({ error: { code: "same_password" } });
    await demanderChangement();
    expect(state.toastDanger).toHaveBeenCalledWith("La nueva contraseña debe ser distinta de la actual.");
  });
});
