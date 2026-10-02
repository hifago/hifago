import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages, type Locale } from "@/messages";
import { LanguageSwitcher } from "./LanguageSwitcher";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Le mock rend la prop `locale` en préfixe, comme le vrai `Link` de next-intl : sans elle, rien de
// ce que ce composant existe pour garantir ne serait vérifiable.
const pushMock = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, locale, children, ...props }: React.ComponentProps<"a"> & { locale?: string }) => (
    <a href={locale ? `/${locale}${href}` : String(href)} {...props}>
      {children}
    </a>
  ),
  usePathname: () => "/productos/kayak",
  useRouter: () => ({ push: pushMock }),
}));

function rendu(locale: Locale = "es") {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <LanguageSwitcher testId="lang" />
    </NextIntlClientProvider>
  );
  return {
    container,
    declencheur: container.querySelector('[data-testid="lang-trigger"]') as HTMLButtonElement,
    panneau: container.querySelector('[data-testid="lang-panneau"]') as HTMLElement,
  };
}

describe("LanguageSwitcher", () => {
  // ⚠️ Deux fuites entre tests sinon : `pushMock` est un mock de MODULE (partagé par tous les
  // tests de ce fichier), et `window.history.pushState` modifie l'état RÉEL de jsdom, qui persiste
  // d'un test à l'autre dans le même fichier.
  beforeEach(() => {
    pushMock.mockClear();
  });
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("affiche la langue courante en toutes lettres, dans sa propre langue", () => {
    expect(rendu("es").declencheur.textContent).toContain("Español");
    // ⚠️ « English » et non « Inglés » : un anglophone perdu sur /es doit reconnaître sa langue.
    expect(rendu("en").declencheur.textContent).toContain("English");
  });

  it("propose les deux langues, chacune en vrai lien préfixé", () => {
    const { container } = rendu("es");
    expect((container.querySelector('[data-testid="lang-es"]') as HTMLAnchorElement).getAttribute("href")).toBe(
      "/es/productos/kayak"
    );
    const en = container.querySelector('[data-testid="lang-en"]') as HTMLAnchorElement;
    expect(en.tagName).toBe("A");
    expect(en.getAttribute("href")).toBe("/en/productos/kayak");
  });

  // Bug Jérôme du 2026-09-16 : changer de langue effaçait les filtres actifs (l'ancien `href`
  // statique de `usePathname` ne portait jamais la query string). `href`/`locale` restent
  // statiques dans le DOM (voir le test précédent) ; c'est l'`onClick` qui lit
  // `window.location.search` en direct et navigue avec, via `router.push`.
  it("conserve la query string active en cliquant un lien de langue", () => {
    window.history.pushState({}, "", "/es/productos/kayak?q=kayak&personas=2");
    const { container, declencheur } = rendu();
    fireEvent.click(declencheur);
    fireEvent.click(container.querySelector('[data-testid="lang-en"]') as HTMLAnchorElement);
    expect(pushMock).toHaveBeenCalledWith("/productos/kayak?q=kayak&personas=2", { locale: "en" });
  });

  it("marque la langue active autrement que par un signe visuel", () => {
    const { container } = rendu("es");
    expect((container.querySelector('[data-testid="lang-es"]') as HTMLElement).getAttribute("aria-current")).toBe(
      "true"
    );
    expect((container.querySelector('[data-testid="lang-en"]') as HTMLElement).getAttribute("aria-current")).toBeNull();
  });

  // ⚠️ Mesuré en rendu SERVEUR : un `Dropdown`/`Popover` de HeroUI ne contient AUCUN de ses liens
  // dans le HTML servi tant qu'il est fermé. Ici le panneau est rendu puis masqué — c'est ce qui
  // permet à la version anglaise d'être découverte par le maillage interne, y compris sur mobile
  // où ce sélecteur vit dans le menu du header.
  it("laisse ses liens dans le HTML SERVI alors qu'il est fermé", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="es" messages={loadMessages("es")}>
        <LanguageSwitcher testId="lang" />
      </NextIntlClientProvider>
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("hidden=");
    expect(html).toContain('href="/en/productos/kayak"');
  });

  it("annonce son état et ce qu'il commande", () => {
    const { declencheur, panneau } = rendu();
    expect(declencheur.getAttribute("aria-expanded")).toBe("false");
    expect(declencheur.getAttribute("aria-controls")).toBe(panneau.id);
    expect(panneau.hasAttribute("hidden")).toBe(true);

    fireEvent.click(declencheur);
    expect(declencheur.getAttribute("aria-expanded")).toBe("true");
    expect(panneau.hasAttribute("hidden")).toBe(false);
  });

  it("se ferme par Échap et rend le focus au déclencheur", () => {
    const { declencheur, panneau } = rendu();
    fireEvent.click(declencheur);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panneau.hasAttribute("hidden")).toBe(true);
    expect(document.activeElement).toBe(declencheur);
  });

  it("se ferme au clic à l'extérieur", () => {
    const { declencheur, panneau } = rendu();
    fireEvent.click(declencheur);
    expect(panneau.hasAttribute("hidden")).toBe(false);
    fireEvent.mouseDown(document.body);
    expect(panneau.hasAttribute("hidden")).toBe(true);
  });

  it("garde une cible tactile de 44 px sur le déclencheur et sur chaque entrée", () => {
    const { container, declencheur } = rendu();
    expect(declencheur.className).toContain("min-h-11");
    for (const valeur of ["es", "en"]) {
      expect((container.querySelector(`[data-testid="lang-${valeur}"]`) as HTMLElement).className).toContain(
        "min-h-11"
      );
    }
  });

  // Le drapeau accompagne, il n'informe pas : aucun n'est juste pour une langue (l'espagnol porte
  // celui de l'Espagne depuis la maquette du 2026-10-01). Le nom écrit à côté porte l'information.
  it("rend les drapeaux invisibles au lecteur d'écran", () => {
    const { container } = rendu();
    const drapeaux = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(drapeaux.length).toBeGreaterThanOrEqual(3);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // L'APPARENCE `banderas` — « 🇪🇸 ESP  🇬🇧 ING », le header transparent de l'accueil (2026-10-01)
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe("apparence `banderas`", () => {
    function enLigne(locale: Locale = "es") {
      return render(
        <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
          <LanguageSwitcher apariencia="banderas" testId="lang" />
        </NextIntlClientProvider>
      ).container;
    }

    it("pose les deux langues en liens directs, sans déclencheur ni panneau", () => {
      const container = enLigne();
      expect(container.querySelector('[data-testid="lang-trigger"]')).toBeNull();
      expect(container.querySelector('[data-testid="lang-panneau"]')).toBeNull();
      const es = container.querySelector('[data-testid="lang-es"]') as HTMLAnchorElement;
      const en = container.querySelector('[data-testid="lang-en"]') as HTMLAnchorElement;
      expect(es.getAttribute("href")).toBe("/es/productos/kayak");
      expect(en.getAttribute("href")).toBe("/en/productos/kayak");
      // `hreflang` : chaque lien dit dans quelle langue il mène.
      expect(es.getAttribute("hreflang")).toBe("es");
      expect(en.getAttribute("hreflang")).toBe("en");
      // Un `<nav>` NOMMÉ : il cohabite avec celui du compte dans le même header.
      expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe(
        loadMessages("es").Chrome.languageLabel
      );
    });

    // Les abréviations de la maquette : « ESP · ING » sur /es. Libellés d'INTERFACE, donc traduits —
    // « ENG » sur /en, là où l'espagnol écrit « ING » (Inglés).
    it("affiche les abréviations de la maquette, dans la langue de l'interface", () => {
      expect(enLigne("es").textContent).toContain("ESP");
      expect(enLigne("es").textContent).toContain("ING");
      expect(enLigne("en").textContent).toContain("ENG");
    });

    // ⚠️ WCAG 2.5.3 : le nom accessible doit CONTENIR le texte affiché — « ING » seul ne dit rien à
    // un lecteur d'écran, « English » seul ne serait pas trouvé par la commande vocale « clique sur
    // ING ». Les deux, l'abréviation d'abord, le nom complet dans SA langue (`lang`).
    it("nomme chaque lien par l'abréviation visible PUIS le nom complet de la langue", () => {
      const en = enLigne("es").querySelector('[data-testid="lang-en"]') as HTMLAnchorElement;
      const nom = (en.textContent ?? "").replace(/\s+/g, " ").trim();
      expect(nom.startsWith("ING")).toBe(true);
      expect(nom).toContain("English");
      expect(en.querySelector('[lang="en"]')?.textContent).toContain("English");
    });

    it("signale la langue courante par `aria-current`, et seulement elle", () => {
      const container = enLigne("es");
      expect(container.querySelector('[data-testid="lang-es"]')?.getAttribute("aria-current")).toBe("true");
      expect(container.querySelector('[data-testid="lang-en"]')?.hasAttribute("aria-current")).toBe(false);
    });

    it("conserve la query string active, comme le menu", () => {
      window.history.pushState({}, "", "/es/productos/kayak?q=kayak");
      fireEvent.click(enLigne().querySelector('[data-testid="lang-en"]') as HTMLAnchorElement);
      expect(pushMock).toHaveBeenCalledWith("/productos/kayak?q=kayak", { locale: "en" });
    });

    it("garde 44 px de cible tactile sur chaque lien", () => {
      const container = enLigne();
      for (const valeur of ["es", "en"]) {
        expect((container.querySelector(`[data-testid="lang-${valeur}"]`) as HTMLElement).className).toContain(
          "min-h-11"
        );
      }
    });

    // Rendu SERVEUR : les liens `/en/…` sont ce qui fait découvrir la version anglaise.
    it("met les deux liens dans le HTML servi", () => {
      const html = renderToStaticMarkup(
        <NextIntlClientProvider locale="es" messages={loadMessages("es")}>
          <LanguageSwitcher apariencia="banderas" testId="lang" />
        </NextIntlClientProvider>
      );
      expect(html).toContain('href="/es/productos/kayak"');
      expect(html).toContain('href="/en/productos/kayak"');
    });
  });
});
