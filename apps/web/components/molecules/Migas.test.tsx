import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Migas } from "./Migas";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Le sujet de ce fichier tient en deux règles que l'œil ne voit pas :
//
//  1. ⚠️ LE PRÉFIXE DE LANGUE. `Breadcrumbs.Item` rend un `<a href>` NATIF, pas le `Link` de
//     `@/i18n/navigation` : le préfixe est posé à la main dans le composant. S'il disparaissait,
//     rien ne casserait à l'écran — le proxy rattraperait chaque lien par une redirection qui
//     redevine la langue depuis un cookie, au lieu de garder celle de la page lue. Un visiteur
//     anglophone se retrouverait en espagnol sans que personne ne s'en aperçoive.
//  2. La page courante n'est PAS un lien vers elle-même.

const ITEMS = [
  { nombre: "Inicio", href: "/" },
  { nombre: "Actividades", href: "/actividades" },
  { nombre: "Kayak" },
];

function rendre(locale: "es" | "en" = "es") {
  const { container } = render(
    <Migas items={ITEMS} etiqueta="Ruta de navegación" locale={locale} testId="migas" />
  );
  return container;
}

describe("Migas", () => {
  // ⚠️ LE test de structure, et il a servi : HeroUI rend un `<ol>` NU, sans `<nav>`. Un `<ol>`
  // portant un `aria-label` n'est pas un landmark ARIA — le fil d'Ariane aurait disparu de la
  // liste des repères de la page, précisément pour le public à qui il sert le plus. L'enveloppe
  // est à nous ; ce test est ce qui empêche qu'on la retire en croyant simplifier.
  it("rend un repère de navigation NOMMÉ, et pas seulement une liste", () => {
    const nav = rendre().querySelector("nav");
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute("aria-label")).toBe("Ruta de navegación");
    expect(nav?.querySelector("ol")).not.toBeNull();
  });

  it("marque la page courante — aria-current, posé par HeroUI", () => {
    const courant = rendre().querySelector('[aria-current="page"]');
    expect(courant?.textContent).toBe("Kayak");
  });

  it("rend un élément par entrée, dans l'ordre reçu", () => {
    const nav = rendre().querySelector("nav");
    expect(nav?.textContent).toContain("Inicio");
    expect(nav?.textContent).toContain("Actividades");
    expect(nav?.textContent).toContain("Kayak");
  });

  // ⚠️ LE test de ce fichier.
  it("préfixe CHAQUE lien avec la locale — jamais une URL sans langue", () => {
    const liens = Array.from(rendre("es").querySelectorAll("a"));
    expect(liens.map((a) => a.getAttribute("href"))).toEqual(["/es/", "/es/actividades"]);
  });

  it("…et suit la locale servie, sans jamais retomber sur l'espagnol", () => {
    const liens = Array.from(rendre("en").querySelectorAll("a"));
    expect(liens.map((a) => a.getAttribute("href"))).toEqual(["/en/", "/en/actividades"]);
  });

  it("ne fait PAS de la page courante un lien vers elle-même", () => {
    // Le dernier élément n'a pas de `href` : c'est là où l'on est. Un lien vers la page courante
    // est un piège classique de fil d'Ariane — il ajoute une cible de tabulation qui ne mène nulle
    // part, et il fait croire à un crawler que la page se référence elle-même.
    const container = rendre();
    const liens = Array.from(container.querySelectorAll("a"));
    expect(liens.length).toBe(2);
    expect(liens.some((a) => a.textContent === "Kayak")).toBe(false);
    expect(container.querySelector("nav")?.textContent).toContain("Kayak");
  });

  // Plan 41, item C3 : le fil ne fait plus défiler la page (551, 803 et 407 px mesurés à 390 sur
  // trois fiches). jsdom n'applique pas les media queries : ce qui est vérifié ici, c'est QUI reçoit
  // la troncature — ni le premier niveau ni la page courante, qui a ses deux lignes. Le reste
  // (retour à la ligne, largeur de page) se prouve au rendu.
  it("ne tronque que les niveaux intermédiaires, et borne la page courante à deux lignes", () => {
    const { container } = render(
      <Migas
        items={[
          { nombre: "Inicio", href: "/" },
          { nombre: "Actividades", href: "/actividades" },
          { nombre: "Deportes náuticos", href: "/actividades/deportes-nauticos" },
          { nombre: "Kayak" },
        ]}
        etiqueta="Ruta de navegación"
        locale="es"
      />
    );
    const niveaux = Array.from(container.querySelectorAll("li"));
    expect(niveaux.map((li) => li.className.includes("max-sm:[&>a]:truncate"))).toEqual([false, true, true, false]);
    expect(niveaux[3].className).toContain("[&>[aria-current=page]]:line-clamp-2");
    // Tronqué à l'écran seulement : le nom entier reste dans le DOM.
    expect(niveaux[2].textContent).toContain("Deportes náuticos");
  });

  it("expose testId sur le repère", () => {
    expect(rendre().querySelector('[data-testid="migas"]')).not.toBeNull();
  });
});
