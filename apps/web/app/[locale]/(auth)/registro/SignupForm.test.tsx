import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";

// Règle de mot de passe (8 caractères, lettres et chiffres) : dite AVANT l'envoi, et la même
// phrase si le serveur la refuse (`weak_password`) — jamais l'erreur générique.

const state = vi.hoisted(() => ({
  signUp: vi.fn(
    async (): Promise<{ data: { session: null }; error: { code: string } | null }> => ({
      data: { session: null },
      error: null,
    })
  ),
  push: vi.fn(),
}));

vi.mock("@hifago/supabase/client", () => ({ createClient: () => ({ auth: { signUp: state.signUp } }) }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: state.push, refresh: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/molecules/GoogleButton", () => ({ OAuthSection: () => null }));

const { SignupForm } = await import("./SignupForm");

const POLITIQUE = "La contraseña debe tener al menos 8 caracteres, con letras y números.";

async function soumettre(password: string, confirmation = password) {
  const { container } = render(
    <NextIntlClientProvider locale="es" messages={loadMessages("es")}>
      <SignupForm next="/" />
    </NextIntlClientProvider>
  );
  const champ = (nom: string) => container.querySelector(`input[name="${nom}"]`) as HTMLInputElement;
  await act(async () => {
    fireEvent.change(champ("email"), { target: { value: "ana@test.local" } });
    fireEvent.change(champ("password"), { target: { value: password } });
    fireEvent.change(champ("confirm-password"), { target: { value: confirmation } });
  });
  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
  });
}

describe("SignupForm — règle de mot de passe", () => {
  beforeEach(() => {
    state.signUp.mockClear();
    state.push.mockClear();
  });

  it("annonce la règle sous le champ", async () => {
    await soumettre("");
    expect(screen.getByTestId("password-hint").textContent).toBe(
      "Mínimo 8 caracteres, con letras y números."
    );
  });

  it.each([["abc1234"], ["abcdefgh"], ["12345678"]])(
    "refuse %s avant l'envoi, avec la règle en clair",
    async (password) => {
      await soumettre(password);
      expect(state.signUp).not.toHaveBeenCalled();
      expect(screen.getByTestId("signup-error").textContent).toBe(POLITIQUE);
    }
  );

  it("un mot de passe conforme part au serveur", async () => {
    await soumettre("abcdefg1");
    expect(state.signUp).toHaveBeenCalledTimes(1);
    expect(state.push).toHaveBeenCalledWith("/verificar-email?email=ana%40test.local");
  });

  it("la confirmation différente reste signalée", async () => {
    await soumettre("abcdefg1", "abcdefg2");
    expect(state.signUp).not.toHaveBeenCalled();
    expect(screen.getByTestId("signup-error").textContent).toBe("Las contraseñas no coinciden.");
  });

  it("un refus `weak_password` du serveur affiche la règle, pas l'erreur générique", async () => {
    state.signUp.mockResolvedValueOnce({ data: { session: null }, error: { code: "weak_password" } });
    await soumettre("abcdefg1");
    expect(screen.getByTestId("signup-error").textContent).toBe(POLITIQUE);
  });
});
