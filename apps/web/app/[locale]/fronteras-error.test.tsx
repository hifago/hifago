import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";

// Les trois frontières d'erreur de zone de la vitrine. Ce que l'écran affiche est prouvé par
// `components/organisms/ErrorScreen.test.tsx` ; ici, seulement que CHAQUE zone qui lit Supabase a
// sa frontière, qu'elle porte son identifiant de test, et qu'elle transmet `retry` (la relecture
// serveur) — jamais `reset`, qui réafficherait le même échec.

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

const ZONES = [
  ["(vitrine)", "error-vitrine", () => import("./(vitrine)/error")],
  ["(tunnel)", "error-tunnel", () => import("./(tunnel)/error")],
  ["(cuenta)", "error-cuenta", () => import("./(cuenta)/error")],
] as const;

describe("frontières d'erreur de zone", () => {
  it.each(ZONES)("%s rend l'écran d'erreur et relance la lecture serveur", async (_zone, testId, charger) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: Frontiere } = await charger();
    const retry = vi.fn();
    const reset = vi.fn();
    // Next passe `retry` ET `reset` à toute frontière : les deux sont fournis, seul `retry` doit
    // servir. (Étalés depuis un objet : l'enveloppe ne déclare que ce qu'elle utilise.)
    const propsNext = { error: new Error("panne"), retry, reset };
    render(
      <NextIntlClientProvider locale="es" messages={loadMessages("es")}>
        <Frontiere {...propsNext} />
      </NextIntlClientProvider>
    );
    (screen.getByTestId(`${testId}-reintentar`) as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
