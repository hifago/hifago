import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// `global-error.tsx` remplace le layout racine de l'admin quand c'est LUI qui échoue : il pose son
// propre document et réutilise l'écran de `error.tsx`. Ce test prouve qu'il rend bien cet écran
// (espagnol, sans le message brut) avec `retry`.

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

const { default: GlobalErrorAdmin } = await import("./global-error");

describe("app/global-error (admin)", () => {
  it("rend l'écran d'erreur espagnol, sans le message brut, et réessaie par retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    render(<GlobalErrorAdmin error={new Error("relation secrète")} retry={retry} />);
    const racine = document.documentElement;
    expect(racine.textContent).toContain("Algo salió mal");
    expect(racine.textContent).not.toContain("relation secrète");
    (racine.querySelector('[data-testid="error-admin-reintentar"]') as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
