import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages, type Locale } from "@/messages";
import { SiteFooter } from "./SiteFooter";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, locale, children, ...props }: React.ComponentProps<"a"> & { locale?: string }) => (
    <a href={locale ? `/${locale}${href}` : String(href)} data-localized="true" {...props}>
      {children}
    </a>
  ),
  usePathname: () => "/productos/kayak",
  // `LanguageSwitcher`, monté par ce composant, appelle `useRouter` depuis le lot du
  // 2026-09-16 (conservation de la query string au changement de langue).
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const messages = loadMessages("es");

function rendu(locale: Locale = "es") {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <SiteFooter testId="footer" />
    </NextIntlClientProvider>
  );
  return { container, pied: container.querySelector("footer") as HTMLElement };
}

const CLES = [
  "footerLegalNotice",
  "footerPrivacy",
  "footerContact",
  "footerHelp",
  "footerTerms",
] as const;

describe("SiteFooter", () => {
  it("est un vrai <footer> avec une navigation nommée", () => {
    const { pied } = rendu();
    expect(pied).not.toBeNull();
    const nav = pied.querySelector("nav") as HTMLElement;
    expect(nav.getAttribute("aria-label")).toBe(messages.Chrome.footerNavLabel);
  });

  // ⚠️ RÉÉCRIT LE 2026-09-07, et c'est une décision, pas une régression. Ce test exigeait les cinq
  // liens institutionnels (mentions légales, confidentialité, contact, aide, conditions). Ils
  // pointaient vers des routes qui n'existent pas : le footer menait à cinq 404. Jérôme a repoussé
  // ces pages à la fin du chantier (cahier §1 : « seule leur présence est actée », le contenu reste
  // à rédiger). Le test garde donc la trace de ce qui est attendu À TERME, et vérifie en attendant
  // qu'aucun lien mort n'est servi.
  it("ne sert AUCUN lien institutionnel tant que les pages n'existent pas", () => {
    const { container } = rendu();
    for (const cle of CLES) {
      expect(container.querySelector(`[data-testid="footer-${cle}"]`)).toBeNull();
    }
  });

  it("gardera ses liens localisés le jour où les pages arriveront", () => {
    // Ce test ne vérifie pas le footer : il verrouille la CONVENTION que le lot des pages
    // institutionnelles devra respecter — cinq clés, et des liens qui passent par le `Link` de
    // @/i18n/navigation, seul à conserver le préfixe de locale. Un `<a href="/legal">` renverrait
    // un hispanophone sur une page sans langue.
    expect(CLES).toHaveLength(5);
    for (const cle of CLES) {
      expect(messages.Chrome[cle]).toBeTruthy();
    }
  });

  it("confie sa cible tactile au design system, pas à une classe posée à la main", () => {
    // ⚠️ RÉÉCRIT LE 2026-09-07. Ce test mesurait `min-h-11` sur les cinq liens institutionnels,
    // qui portaient cette classe eux-mêmes ; ils ont été retirés (pages inexistantes) et le test
    // n'avait plus de sujet. Le seul lien encore servi est le bouton WhatsApp, et il ne porte
    // AUCUNE classe de hauteur : sa cible vient de la taille de l'atome (`md` par défaut, 44 px à
    // toute largeur depuis le plan 41, item F4). Vérifier ici une classe Tailwind serait vérifier
    // une implémentation que ce composant n'a pas — la garantie des 44 px appartient à l'atome
    // Button et à ses propres tests.
    const { container } = rendu();
    const whatsapp = container.querySelector('[data-testid="footer-whatsapp"]') as HTMLElement;
    expect(whatsapp).not.toBeNull();
    expect(whatsapp.className).toContain("button--md");
  });

  // ⚠️ Le lien externe passe par `LinkButton`, qui impose `rel="noopener noreferrer"` (sa prop
  // `rel` n'existe pas) et exige le libellé « nouvel onglet », rendu en sr-only. Écrire un `<a>` à
  // la main aurait remis ces deux garanties à la vigilance de qui relit.
  it("ouvre WhatsApp dans un nouvel onglet, en le disant et sans fuite d'opener", () => {
    const { container } = rendu();
    const lien = container.querySelector('[data-testid="footer-whatsapp"]') as HTMLAnchorElement;
    expect(lien.getAttribute("href")).toBe("https://wa.me/573215764841");
    expect(lien.getAttribute("target")).toBe("_blank");
    expect(lien.getAttribute("rel")).toBe("noopener noreferrer");
    expect(lien.textContent).toContain(messages.Chrome.footerWhatsApp);
    expect(lien.textContent).toContain(messages.Chrome.footerWhatsAppNewTab);
  });

  // ⚠️ LE point du lot : le footer réutilise le sélecteur du header, il n'en écrit pas un second.
  // Deux implémentations divergentes (l'une avec de vrais liens, l'autre en JavaScript seul) est
  // le défaut classique de la paire header/footer — et ici il coûterait la découverte de la
  // version anglaise.
  it("réutilise le LanguageSwitcher du header, avec ses vrais liens", () => {
    const { container } = rendu();
    const declencheur = container.querySelector('[data-testid="footer-language-trigger"]');
    expect(declencheur).not.toBeNull();
    const en = container.querySelector('[data-testid="footer-language-en"]') as HTMLAnchorElement;
    expect(en.tagName).toBe("A");
    expect(en.getAttribute("href")).toBe("/en/productos/kayak");
  });

  it("affiche la ligne d'identité reprise du footer legacy", () => {
    const { container } = rendu();
    expect((container.querySelector('[data-testid="footer-identity"]') as HTMLElement).textContent).toBe(
      "Hifago · Guatapé, Colombia"
    );
  });

  it("traduit tout ce qu'il affiche", () => {
    // Réécrit le 2026-09-07 : la clé `footerHelp` n'a plus de lien à traduire tant que les pages
    // institutionnelles n'existent pas. On vérifie donc la traduction sur ce qui est RÉELLEMENT
    // affiché — le nom accessible de la navigation, le bouton WhatsApp et la ligne d'identité.
    const { container } = rendu("en");
    expect((container.querySelector("nav") as HTMLElement).getAttribute("aria-label")).toBe(
      "Institutional links"
    );
    expect(
      (container.querySelector('[data-testid="footer-whatsapp"]') as HTMLElement).textContent
    ).toContain("WhatsApp");
  });

  // ⚠️ Aucune couleur en dur : cinq pistes de thème sont montées et aucune n'est adoptée. Le couple
  // fond/texte vient du thème, donc sa lisibilité est garantie par lui — dans les cinq pistes et
  // dans les deux modes.
  // ⚠️ `--surface-tertiary` retenu après mesure des cinq candidats sur 5 pistes × 2 modes : c'est
  // le plus marqué des jetons qui laissent intacts les composants posés dessus (LinkButton,
  // LanguageSwitcher), dont les couleurs supposent un fond de surface claire.
  it("prend sa bande de couleur dans les jetons, jamais en dur", () => {
    const { pied } = rendu();
    expect(pied.className).toContain("bg-[var(--surface-tertiary)]");
    expect(pied.className).toContain("text-[var(--surface-tertiary-foreground)]");
    expect(pied.className).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("livre tous ses liens dans le HTML SERVI", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="es" messages={messages}>
        <SiteFooter testId="footer" />
      </NextIntlClientProvider>
    );
    // ⚠️ La raison d'être de ce test n'est pas la liste des href, c'est le rendu SERVEUR : Google
    // indexe le HTML servi, et c'est le sélecteur de langue du footer qui fait découvrir la version
    // anglaise par le maillage interne. Les cinq liens institutionnels ont été retirés le
    // 2026-09-07 (pages inexistantes) ; ce qui reste doit toujours être SERVI, pas hydraté.
    for (const href of ["/legal", "/privacy", "/contact", "/help", "/terms"]) {
      expect(html).not.toContain(`href="${href}"`);
    }
    expect(html).toContain("https://wa.me/573215764841");
    expect(html).toContain('href="/en/productos/kayak"');
  });
});
