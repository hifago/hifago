import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";

// Le lien de l'email de confirmation est `{{ .RedirectTo }}&token_hash=…`
// (supabase/templates/confirmation.html). Sans `emailRedirectTo`, `.RedirectTo` retombe sur le
// site_url NU : le lien renvoyé devient `https://<site>&token_hash=…`, inutilisable. Ce test prouve
// que le renvoi passe la même URL de callback que l'inscription (SignupForm.tsx).

const state = vi.hoisted(() => ({ resend: vi.fn(async () => ({ error: null })) }));

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({ auth: { resend: state.resend } }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@hifago/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hifago/ui")>()),
  toast: { success: vi.fn(), danger: vi.fn() },
}));

const { ResendConfirmationForm } = await import("./ResendConfirmationForm");

describe("ResendConfirmationForm (vitrine)", () => {
  beforeEach(() => state.resend.mockClear());

  it.each([["es"], ["en"]] as const)("renvoie avec l'URL de callback vers l'accueil /%s", async (locale) => {
    render(
      <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
        <ResendConfirmationForm email="ana@test.local" />
      </NextIntlClientProvider>
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("resend-confirmation-button"));
    });
    const attendu = new URL("/auth/callback", window.location.origin);
    attendu.searchParams.set("next", `/${locale}`);
    expect(state.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "ana@test.local",
      options: { emailRedirectTo: attendu.toString() },
    });
  });
});
