import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { Button, type ButtonColor, type ButtonSize, type ButtonVariant } from "./Button";
import { LinkButton } from "./LinkButton";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Même mock que BackLink.test.tsx, et pour la même raison : `@/i18n/navigation` tire
// next-intl/navigation → next/navigation, dont la résolution casse sous Vitest. L'attribut
// `data-localized` est repris tel quel de ce fichier — sans lui, ce test passerait à l'identique
// si LinkButton utilisait `next/link` ou un `<a href>` nu, or c'est précisément ce que le
// composant existe pour empêcher sur un lien interne.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} data-localized="true" {...props}>
      {children}
    </a>
  ),
}));

function lien(element: React.ReactElement) {
  const { container } = render(element);
  return container.querySelector("a") as HTMLAnchorElement;
}

const VARIANTS: ButtonVariant[] = ["solid", "soft", "outline", "ghost"];
const COLORS: ButtonColor[] = ["accent", "neutral", "danger"];
const SIZES: ButtonSize[] = ["sm", "md", "lg"];

describe("LinkButton", () => {
  it("rend un vrai <a href>, pas un <button>", () => {
    const { container } = render(<LinkButton href="/pago">Reservar</LinkButton>);
    expect(container.querySelector("button")).toBeNull();
    const el = container.querySelector("a") as HTMLAnchorElement;
    expect(el.getAttribute("href")).toBe("/pago");
    expect(el.textContent).toBe("Reservar");
  });

  it("passe par le Link localisé de @/i18n/navigation pour un lien interne", () => {
    expect(lien(<LinkButton href="/orders">Mis reservas</LinkButton>).getAttribute("data-localized")).toBe("true");
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // Le lien externe : les deux garanties portées par le type
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it("pose target=_blank ET rel=noopener noreferrer sur un lien externe", () => {
    const el = lien(
      <LinkButton href="https://tickets.example.com/evt" external newTabLabel="(se abre en una pestaña nueva)">
        Reservar
      </LinkButton>
    );
    expect(el.getAttribute("target")).toBe("_blank");
    expect(el.getAttribute("rel")).toBe("noopener noreferrer");
    // ⚠️ Un lien externe ne passe PAS par le Link localisé : préfixer une URL absolue de la locale
    // produirait /es/https://… — c'est la seule raison d'être de la discrimination du type.
    expect(el.getAttribute("data-localized")).toBeNull();
  });

  it("annonce l'ouverture dans un nouvel onglet sans rien changer à l'œil", () => {
    const el = lien(
      <LinkButton href="https://tickets.example.com/evt" external newTabLabel="(se abre en una pestaña nueva)">
        Reservar
      </LinkButton>
    );
    const mention = el.querySelector(".sr-only") as HTMLElement;
    expect(mention).not.toBeNull();
    expect(mention.textContent?.trim()).toBe("(se abre en una pestaña nueva)");
    // Le nom accessible du lien contient la mention…
    expect(el.textContent).toContain("(se abre en una pestaña nueva)");
    // …et le libellé visible, lui, reste exactement celui qu'on a donné.
    expect(el.firstChild?.textContent).toBe("Reservar");
  });

  it("n'ajoute rien à un lien interne : ni target, ni rel, ni mention", () => {
    const el = lien(<LinkButton href="/orders">Mis reservas</LinkButton>);
    expect(el.getAttribute("target")).toBeNull();
    expect(el.getAttribute("rel")).toBeNull();
    expect(el.querySelector(".sr-only")).toBeNull();
  });

  // ⚠️ La garantie « `rel` ne peut pas être oublié » se vérifie à la COMPILATION, pas au rendu :
  // elle tient à l'absence de la prop dans le type. Ces trois directives échouent au `tsc --noEmit`
  // le jour où quelqu'un rouvre la porte — un test de rendu ne le verrait jamais.
  it("interdit à l'appelant de toucher rel/target, et exige newTabLabel sur un lien externe", () => {
    const rejets = (
      <>
        {/* @ts-expect-error `rel` n'est pas une prop : il est posé par le composant. */}
        <LinkButton href="https://x.test" external newTabLabel="(nueva pestaña)" rel="opener">
          A
        </LinkButton>
        {/* @ts-expect-error `target` n'est pas une prop non plus. */}
        <LinkButton href="/interne" target="_blank">
          B
        </LinkButton>
        {/* @ts-expect-error `newTabLabel` est REQUIS dès que `external` vaut true. */}
        <LinkButton href="https://x.test" external>
          C
        </LinkButton>
      </>
    );
    expect(rejets).toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // ⚠️ LA PREUVE D'IDENTITÉ AVEC `Button` — le cœur de ce fichier
  // ─────────────────────────────────────────────────────────────────────────────────────────
  //
  // Deux tables de couleurs qui divergent est LE défaut classique d'une paire bouton/lien. Ici les
  // 36 combinaisons (4 formes × 3 couleurs × 3 tailles) sont comparées classe à classe entre les
  // deux composants : ajouter une couleur à `Button` sans la répercuter, ou recopier une table ici,
  // casse ce test au lieu de se voir en production six mois plus tard.
  //
  // Le seul écart TOLÉRÉ est nommé explicitement, jamais « à peu près égal » : l'anneau de focus,
  // que `LinkButton` doit poser lui-même parce que `.button` ne le rend que sur l'attribut
  // `data-focus-visible` de react-aria, qu'un `<a>` ne reçoit pas (cf. l'en-tête du composant).
  const ECART_ATTENDU = ["focus-visible:status-focused"];

  function classes(element: HTMLElement): string[] {
    return element.className.split(/\s+/).filter(Boolean);
  }

  for (const variant of VARIANTS) {
    for (const color of COLORS) {
      for (const size of SIZES) {
        it(`rend exactement les mêmes classes que Button en ${variant}/${color}/${size}`, () => {
          const { container } = render(
            <Button variant={variant} color={color} size={size}>
              A
            </Button>
          );
          const duBouton = classes(container.querySelector("button") as HTMLElement);
          const duLien = classes(
            lien(
              <LinkButton href="/x" variant={variant} color={color} size={size}>
                A
              </LinkButton>
            )
          );

          expect(duLien.filter((c) => !ECART_ATTENDU.includes(c))).toEqual(duBouton);
          expect(duLien.filter((c) => ECART_ATTENDU.includes(c))).toEqual(ECART_ATTENDU);
        });
      }
    }
  }

  it("suit Button sur la pleine largeur", () => {
    const { container } = render(
      <Button width="full">A</Button>
    );
    const duBouton = classes(container.querySelector("button") as HTMLElement);
    const duLien = classes(lien(<LinkButton href="/x" width="full">A</LinkButton>));
    expect(duLien.filter((c) => !ECART_ATTENDU.includes(c))).toEqual(duBouton);
    expect(duBouton).toContain("button--full-width");
  });

  it("prend la taille md par défaut, comme Button (44 px à toute largeur, plan 41 F4)", () => {
    expect(lien(<LinkButton href="/x">A</LinkButton>).className).toContain("button--md");
    expect(lien(<LinkButton href="/x">A</LinkButton>).className).toContain("h-11");
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────

  it("rend les icônes décoratives hors de l'arbre d'accessibilité", () => {
    const el = lien(
      <LinkButton href="/x" iconBefore={<svg data-testid="glyphe" />}>
        Reservar
      </LinkButton>
    );
    const enveloppe = el.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(enveloppe).not.toBeNull();
    expect(enveloppe.querySelector("[data-testid='glyphe']")).not.toBeNull();
    // Le libellé reste seul porteur du sens.
    expect(el.textContent).toBe("Reservar");
  });

  it("expose testId sur le lien", () => {
    expect(lien(<LinkButton href="/x" testId="evento-reserve-link">A</LinkButton>).getAttribute("data-testid")).toBe(
      "evento-reserve-link"
    );
    expect(
      lien(
        <LinkButton href="https://x.test" external newTabLabel="(n)" testId="evento-reserve-link">
          A
        </LinkButton>
      ).getAttribute("data-testid")
    ).toBe("evento-reserve-link");
  });
});
