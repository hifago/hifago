import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Les `notFound()` de l'admin (produit, établissement, commande introuvables) et les URL inconnues
// rendaient la page 404 anglaise de Next : cet écran les remplace, en espagnol (l'app admin n'est
// pas localisée), avec un retour à l'accueil.

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

const { default: NotFoundAdmin } = await import("./not-found");

describe("app/not-found (admin)", () => {
  it("rend un écran en espagnol avec un retour à l'accueil", () => {
    render(<NotFoundAdmin />);
    expect(screen.getByText("Página no encontrada")).not.toBeNull();
    expect(screen.getByTestId("not-found-admin-volver").getAttribute("href")).toBe("/");
  });
});
