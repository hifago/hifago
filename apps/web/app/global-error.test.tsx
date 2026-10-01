import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// `global-error.tsx` remplace le layout racine `[locale]` quand c'est LUI qui échoue : plus de
// NextIntlClientProvider, plus de `lang`, plus de coquille. Ce fichier prouve que l'écran parle
// quand même la langue de l'URL, ne montre jamais le message brut, et ramène à l'accueil de cette
// langue.

// `ErrorScreen` importe le `Link` localisé (inutilisé ici : `inicioHref` est fourni) — même
// simulation que ses autres tests, le module réel ne se charge pas hors de Next.
vi.mock("@/i18n/navigation", () => ({ Link: () => null }));

const { default: GlobalError } = await import("./global-error");

function monter(chemin: string) {
  window.history.pushState({}, "", chemin);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const erreur = Object.assign(new Error('relation "public.products" does not exist'), {
    digest: "abc123",
  });
  render(<GlobalError error={erreur} retry={() => {}} />);
  return document.documentElement;
}

describe("app/global-error", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("parle anglais sous /en, et ramène à /en", () => {
    const racine = monter("/en/productos/kayak");
    expect(racine.textContent).toContain("Something went wrong");
    expect(racine.querySelector('[data-testid="global-error-volver"]')?.getAttribute("href")).toBe("/en");
  });

  it("parle espagnol par défaut, y compris sous une locale inconnue", () => {
    const racine = monter("/pt/x");
    expect(racine.textContent).toContain("Algo salió mal");
    expect(racine.querySelector('[data-testid="global-error-volver"]')?.getAttribute("href")).toBe("/es");
  });

  it("ne montre jamais le message brut de l'erreur", () => {
    const racine = monter("/es");
    expect(racine.textContent).not.toContain("public.products");
  });
});
