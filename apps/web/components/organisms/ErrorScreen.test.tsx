import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";
import { ErrorScreen } from "./ErrorScreen";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Ce que ce test protège tient en une phrase : **le message brut de l'erreur ne doit jamais
// atteindre l'écran**. Il peut porter un fragment de requête SQL ou un nom de table, et il arrive
// ici depuis une couche qui parle à Supabase. Le reste (un titre, deux actions) est du rendu.
// Repris de l'ancien `app/[locale]/(vitrine)/error.test.tsx` quand l'écran a été partagé.

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

// ⚠️ Le catalogue de messages est le VRAI (`loadMessages`), jamais un objet écrit à la main : un
// catalogue de test recopié à la main teste le catalogue de test (mesuré le 2026-09-08, cf. l'ancien
// test de la frontière vitrine).
const MESSAGES = loadMessages("es");

function monter({ retry = () => {}, inicioHref }: { retry?: () => void; inicioHref?: string } = {}) {
  const erreur = Object.assign(new Error('relation "public.products" does not exist'), {
    digest: "abc123",
  });
  return render(
    <NextIntlClientProvider locale="es" messages={MESSAGES}>
      <ErrorScreen
        error={erreur}
        retry={retry}
        zone="vitrine"
        testId="error-vitrine"
        inicioHref={inicioHref}
      />
    </NextIntlClientProvider>
  );
}

describe("ErrorScreen", () => {
  it("rend un texte traduit, jamais le message brut de l'erreur", () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = monter();

    expect(screen.getByText("Algo salió mal")).not.toBeNull();
    expect(container.textContent).not.toContain("public.products");
    expect(container.textContent).not.toContain("abc123");

    // Le message part tout de même au journal du navigateur : masqué au visiteur, jamais perdu.
    expect(journal).toHaveBeenCalled();
    journal.mockRestore();
  });

  it("propose de réessayer (relecture serveur via retry) et de revenir à l'accueil localisé", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    monter({ retry });

    (screen.getByTestId("error-vitrine-reintentar") as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId("error-vitrine-volver").getAttribute("href")).toBe("/");
    vi.restoreAllMocks();
  });

  it("hors routage localisé (global-error), pointe l'accueil complet fourni", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    monter({ inicioHref: "/en" });
    expect(screen.getByTestId("error-vitrine-volver").getAttribute("href")).toBe("/en");
    vi.restoreAllMocks();
  });

  it("pose l'unique <main> de la page et ne rend aucune coquille", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = monter();

    // ⚠️ Une frontière de zone est rendue À L'INTÉRIEUR du layout de sa zone : l'en-tête et le
    // pied de page sont déjà là. En rendre un second donnerait deux en-têtes — faute invisible au
    // typecheck, et que seule cette assertion attrape.
    expect(container.querySelectorAll("main").length).toBe(1);
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("footer")).toBeNull();
    vi.restoreAllMocks();
  });
});
