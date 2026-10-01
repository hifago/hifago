import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// Le lien de l'email de confirmation est `{{ .RedirectTo }}&token_hash=…`
// (supabase/templates/confirmation.html). Sans `emailRedirectTo`, `.RedirectTo` retombe sur le
// site_url NU : le lien renvoyé devient `https://<site>&token_hash=…`, inutilisable. Ce test prouve
// que le renvoi passe l'URL du callback de l'admin.

const state = vi.hoisted(() => ({ resend: vi.fn(async () => ({ error: null })) }));

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({ auth: { resend: state.resend } }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
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

describe("ResendConfirmationForm (admin)", () => {
  beforeEach(() => state.resend.mockClear());

  it("renvoie avec l'URL du callback de l'admin", async () => {
    render(<ResendConfirmationForm email="socio@test.local" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("resend-confirmation-button"));
    });
    const attendu = new URL("/auth/callback", window.location.origin);
    attendu.searchParams.set("next", "/");
    expect(state.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "socio@test.local",
      options: { emailRedirectTo: attendu.toString() },
    });
  });
});
