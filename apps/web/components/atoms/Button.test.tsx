import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Button } from "./Button";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
// (Il est bien présent dans node_modules, mais comme dépendance TRANSITIVE : apps/web ne déclare
// que @testing-library/dom et react. L'importer serait une dépendance fantôme, comme lucide-react.)
//
// Ce fichier teste ce que la surcouche AJOUTE à HeroUI : les deux axes séparés, l'état « en cours »
// qui remplace le couple isDisabled/libellé ternaire, et le nom accessible des icônes. Le
// comportement du bouton react-aria lui-même n'est pas retesté ici.
function bouton(element: React.ReactElement) {
  const { container } = render(element);
  return container.querySelector("button") as HTMLButtonElement;
}

describe("Button", () => {
  it("rend un <button> avec son libellé et son testId", () => {
    const el = bouton(<Button testId="reserver">Reservar</Button>);
    expect(el.tagName).toBe("BUTTON");
    expect(el.textContent).toBe("Reservar");
    expect(el.getAttribute("data-testid")).toBe("reserver");
  });

  it("déclenche onPress au clic", () => {
    const onPress = vi.fn();
    const el = bouton(<Button onPress={onPress}>Reservar</Button>);
    fireEvent.click(el);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // ⚠️ Le cœur de la surcouche : forme et couleur sont deux axes indépendants, ce que le `variant`
  // à 7 valeurs de HeroUI ne permet pas. On vérifie que les deux jeux de classes sont bien posés
  // ET qu'ils varient indépendamment — pas la couleur rendue, qui se mesure dans le navigateur.
  it("pose deux axes indépendants : la couleur ne dépend pas de la forme", () => {
    const solideAccent = bouton(<Button variant="solid" color="accent">A</Button>).className;
    const solideDanger = bouton(<Button variant="solid" color="danger">A</Button>).className;
    const ghostAccent = bouton(<Button variant="ghost" color="accent">A</Button>).className;

    // Même forme, couleurs différentes.
    expect(solideAccent).toContain("[--btn-fill:var(--accent)]");
    expect(solideDanger).toContain("[--btn-fill:var(--danger)]");
    // Même couleur, formes différentes — et la déclaration de couleur, elle, est identique.
    expect(ghostAccent).toContain("[--btn-fill:var(--accent)]");
    expect(solideAccent).toContain("[--button-bg:var(--btn-fill)]");
    expect(ghostAccent).toContain("[--button-bg:transparent]");
  });

  it("colore aussi la bordure de la variante outline", () => {
    const el = bouton(<Button variant="outline" color="danger">A</Button>);
    expect(el.className).toContain("[border-color:var(--btn-line)]");
    expect(el.className).toContain("[--btn-line:var(--danger)]");
    // La bordure elle-même vient de HeroUI, on ne la réimplémente pas.
    expect(el.className).toContain("button--outline");
  });

  // Plan 41, item F4 : `md` par défaut (44 px), `lg` (48 px) réservé aux CTA de conversion. Les
  // hauteurs se MESURENT dans la story `Tailles` (jsdom ne calcule pas la cascade) ; ici, le contrat :
  // la classe de taille de l'atome est posée, et elle ne descend jamais sous `h-11` (44 px).
  it("prend la taille md par défaut, et 44 px au moins à toutes les tailles", () => {
    const parDefaut = bouton(<Button>A</Button>).className;
    expect(parDefaut).toContain("button--md");
    expect(parDefaut).toContain("h-11");
    expect(bouton(<Button size="sm">A</Button>).className).toContain("h-11");
    expect(bouton(<Button size="sm">A</Button>).className).toContain("text-sm");
    const conversion = bouton(<Button size="lg">A</Button>).className;
    expect(conversion).toContain("button--lg");
    expect(conversion).toContain("h-12");
    expect(conversion).not.toContain("h-11");
  });

  // ⚠️ Le rayon UNIQUE des boutons (plan 41, item F4 ; arbitrage D4 : 8 px) vient du jeton
  // `--rayon-bouton` (globals.css, le double de `--radius`), pas d'une valeur en dur. Que cette
  // classe l'emporte sur le `rounded-3xl` de `.button` est un fait de CASCADE CSS, que jsdom ne
  // calcule pas : il se mesure au rendu (story `Tailles`), pas ici.
  // Histoire de ce test (2026-09-02) : deux assertions tautologiques s'y sont succédé —
  // `toContain("button")`, que `button--lg` satisfait toujours, puis `not.toContain("rounded-3xl")`,
  // tout aussi creuse, `rounded-3xl` vivant dans le CSS de `.button` et jamais dans le className.
  it("pose la classe du rayon unique des boutons", () => {
    const el = bouton(<Button>A</Button>);
    expect(el.className).toContain("rounded-[var(--rayon-bouton)]");
  });

  // `shape="pill"` (2026-09-02, demande de Jérôme pour le bouton de `organisms/SearchBar`) : un
  // bouton logé dans une forme déjà arrondie doit pouvoir l'être aussi. Deux valeurs seulement —
  // un rayon libre serait une valeur en dur, qui cesserait de suivre le jeton.
  it("arrondit complètement avec shape=pill, et suit le rayon des boutons par défaut", () => {
    const pilule = bouton(<Button shape="pill">A</Button>).className;
    expect(pilule).toContain("rounded-full");
    expect(pilule).not.toContain("rounded-[var(--rayon-bouton)]");
    expect(bouton(<Button shape="square">A</Button>).className).toContain("rounded-[var(--rayon-bouton)]");
  });

  // La couleur `marine` (plan 41, item F4) : l'action principale sur une surface or. Elle lit ses
  // propres jetons — jamais ceux de l'accent, qui disparaîtraient sur l'or.
  it("pose les jetons du bouton marine avec color=marine", () => {
    const el = bouton(<Button color="marine">A</Button>).className;
    expect(el).toContain("[--btn-fill:var(--bouton-marine)]");
    expect(el).toContain("[--btn-on-fill:var(--bouton-marine-texte)]");
    expect(el).not.toContain("[--btn-fill:var(--accent)]");
  });

  it("passe en pleine largeur avec width=full", () => {
    expect(bouton(<Button width="full">A</Button>).className).toContain("button--full-width");
    expect(bouton(<Button>A</Button>).className).not.toContain("button--full-width");
  });

  describe("état en cours", () => {
    it("affiche le libellé de remplacement et annonce l'état", () => {
      const el = bouton(
        <Button isPending pendingLabel="Enviando…">
          Pagar
        </Button>
      );
      expect(el.textContent).toContain("Enviando…");
      expect(el.textContent).not.toContain("Pagar");
      expect(el.getAttribute("data-pending")).toBe("true");
      // ⚠️ aria-disabled, PAS disabled : le bouton garde le focus et le lecteur d'écran est prévenu.
      expect(el.getAttribute("aria-disabled")).toBe("true");
      expect(el.hasAttribute("disabled")).toBe(false);
    });

    it("neutralise la soumission le temps de l'envoi", () => {
      const onPress = vi.fn();
      const el = bouton(
        <Button type="submit" isPending onPress={onPress}>
          Pagar
        </Button>
      );
      // react-aria force type="button" pendant l'attente : un double clic ne resoumet pas.
      expect(el.getAttribute("type")).toBe("button");
      fireEvent.click(el);
      expect(onPress).not.toHaveBeenCalled();
    });

    it("garde le libellé normal si aucun pendingLabel n'est fourni", () => {
      const el = bouton(<Button isPending>Pagar</Button>);
      expect(el.textContent).toContain("Pagar");
    });
  });

  it("désactive vraiment avec isDisabled", () => {
    const onPress = vi.fn();
    const el = bouton(
      <Button isDisabled onPress={onPress}>
        Pagar
      </Button>
    );
    expect(el.hasAttribute("disabled")).toBe(true);
    fireEvent.click(el);
    expect(onPress).not.toHaveBeenCalled();
  });

  // ⚠️ Une icône ne porte jamais l'information : elle accompagne un libellé, et reste invisible
  // pour un lecteur d'écran. Sans ce garde-fou, le nom accessible du bouton varierait selon que
  // l'icône expose un <title> ou non.
  it("rend les icônes décoratives inaccessibles au lecteur d'écran", () => {
    const { container } = render(
      <Button iconBefore={<svg data-testid="icone" />} iconAfter={<svg />}>
        Continuar
      </Button>
    );
    const caches = container.querySelectorAll('[aria-hidden="true"]');
    expect(caches.length).toBe(2);
    expect(caches[0].querySelector('[data-testid="icone"]')).not.toBeNull();
    expect(container.querySelector("button")?.textContent).toBe("Continuar");
  });
});
