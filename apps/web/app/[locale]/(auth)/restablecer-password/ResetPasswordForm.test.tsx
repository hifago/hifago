import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";

const state = vi.hoisted(() => ({
  updateUser: vi.fn(async (): Promise<{ error: { code: string } | null }> => ({ error: null })),
  push: vi.fn(),
}));

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({ auth: { updateUser: state.updateUser } }),
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: state.push, refresh: vi.fn() }) }));

const { ResetPasswordForm } = await import("./ResetPasswordForm");

async function soumettre(password: string) {
  const { container } = render(
    <NextIntlClientProvider locale="es" messages={loadMessages("es")}>
      <ResetPasswordForm />
    </NextIntlClientProvider>
  );
  const champ = (nom: string) => container.querySelector(`input[name="${nom}"]`) as HTMLInputElement;
  await act(async () => {
    fireEvent.change(champ("password"), { target: { value: password } });
    fireEvent.change(champ("confirm-password"), { target: { value: password } });
  });
  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
  });
}

const erreur = () => screen.getByTestId("reset-password-error").textContent;

describe("ResetPasswordForm (vitrine) — règle de mot de passe", () => {
  beforeEach(() => {
    state.updateUser.mockClear();
    state.push.mockClear();
  });

  it("refuse un mot de passe hors règle avant l'envoi", async () => {
    await soumettre("abcdefgh");
    expect(state.updateUser).not.toHaveBeenCalled();
    expect(erreur()).toBe("La contraseña debe tener al menos 8 caracteres, con letras y números.");
  });

  it("un mot de passe conforme est posé, puis retour à l'accueil", async () => {
    await soumettre("abcdefg1");
    expect(state.updateUser).toHaveBeenCalledWith({ password: "abcdefg1" });
    expect(state.push).toHaveBeenCalledWith("/");
  });

  it.each([
    ["weak_password", "La contraseña debe tener al menos 8 caracteres, con letras y números."],
    ["same_password", "La nueva contraseña debe ser distinta de la actual."],
    ["unexpected_failure", "No se pudo restablecer la contraseña. Inténtalo de nuevo."],
  ])("refus serveur %s : message dédié", async (code, message) => {
    state.updateUser.mockResolvedValueOnce({ error: { code } });
    await soumettre("abcdefg1");
    expect(erreur()).toBe(message);
    expect(state.push).not.toHaveBeenCalled();
  });
});
