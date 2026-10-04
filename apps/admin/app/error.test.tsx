import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// La frontière d'erreur de toute l'app admin + socio (aucune n'existait : une lecture en panne
// rendait la page d'erreur nue de Next). Ce que ce test protège : le message brut — fragment SQL,
// nom de table — n'atteint jamais l'écran, et « Reintentar » relance la lecture serveur (`retry`),
// jamais un simple `reset` qui réafficherait le même échec.

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

const { default: ErrorAdmin } = await import("./error");

function monter(retry = () => {}) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const erreur = Object.assign(new Error('relation "public.orders" does not exist'), { digest: "d1" });
  const propsNext = { error: erreur, retry, reset: vi.fn() };
  return render(<ErrorAdmin {...propsNext} />);
}

describe("app/error (admin)", () => {
  it("rend un texte en espagnol, jamais le message brut", () => {
    const { container } = monter();
    expect(screen.getByText("Algo salió mal")).not.toBeNull();
    expect(container.textContent).not.toContain("public.orders");
    expect(container.textContent).not.toContain("d1");
    expect(console.error).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("réessaie par retry et propose de revenir à l'accueil", () => {
    const retry = vi.fn();
    monter(retry);
    (screen.getByTestId("error-admin-reintentar") as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("error-admin-volver").getAttribute("href")).toBe("/");
    vi.restoreAllMocks();
  });
});
