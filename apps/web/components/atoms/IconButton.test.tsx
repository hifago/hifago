import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { IconButton } from "./IconButton";
import { Button } from "./Button";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Ce fichier teste la seule chose qui justifie un composant séparé de `Button` : un bouton sans
// texte a toujours un nom accessible, par construction.
function bouton(element: React.ReactElement) {
  const { container } = render(element);
  return container.querySelector("button") as HTMLButtonElement;
}

const Croix = () => <svg data-testid="icone" />;

describe("IconButton", () => {
  it("donne au bouton un nom accessible, sans texte visible", () => {
    const el = bouton(<IconButton icon={<Croix />} label="Quitar del carrito" testId="quitar" />);
    expect(el.getAttribute("aria-label")).toBe("Quitar del carrito");
    expect(el.textContent).toBe("");
    expect(el.getAttribute("data-testid")).toBe("quitar");
  });

  it("rend l'icône décorative, jamais porteuse du nom", () => {
    const el = bouton(<IconButton icon={<Croix />} label="Cerrar" />);
    const cache = el.querySelector('[aria-hidden="true"]');
    expect(cache).not.toBeNull();
    expect(cache?.querySelector('[data-testid="icone"]')).not.toBeNull();
  });

  // ⚠️ Depuis le passage du rayon au jeton du thème (2026-09-02), `circle` est la seule façon
  // d'obtenir un rond : le bouton d'icône ne l'est plus par accident de rabotage du rayon. En carré,
  // il prend le rayon unique des boutons (`--rayon-bouton`, plan 41 F4).
  it("est rond par défaut, et suit le rayon du bouton texte en carré", () => {
    expect(bouton(<IconButton icon={<Croix />} label="C" />).className).toContain("rounded-full");
    const carre = bouton(<IconButton icon={<Croix />} label="C" shape="square" />).className;
    expect(carre).toContain("rounded-[var(--rayon-bouton)]");
    expect(carre).not.toContain("rounded-full");
  });

  it("passe en icon-only chez HeroUI (largeur carrée) et garde la taille lg par défaut", () => {
    const el = bouton(<IconButton icon={<Croix />} label="C" />);
    expect(el.className).toContain("button--icon-only");
    expect(el.className).toContain("button--lg");
  });

  // Plan 41, item F4 : 44 × 44 px à toutes les tailles (HeroUI descendait à 32 px en `sm` desktop).
  it("garde 44 × 44 px à toutes les tailles", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      expect(bouton(<IconButton icon={<Croix />} label="C" size={size} />).className).toContain("size-11");
    }
  });

  it("bascule son nom accessible pendant l'envoi", () => {
    const el = bouton(
      <IconButton icon={<Croix />} label="Quitar" isPending pendingLabel="Quitando…" />
    );
    expect(el.getAttribute("aria-label")).toBe("Quitando…");
    expect(el.getAttribute("data-pending")).toBe("true");
  });

  it("déclenche onPress au clic, et plus rien une fois désactivé", () => {
    const onPress = vi.fn();
    fireEvent.click(bouton(<IconButton icon={<Croix />} label="C" onPress={onPress} />));
    expect(onPress).toHaveBeenCalledTimes(1);

    const onPress2 = vi.fn();
    fireEvent.click(bouton(<IconButton icon={<Croix />} label="C" isDisabled onPress={onPress2} />));
    expect(onPress2).not.toHaveBeenCalled();
  });

  // ⚠️ Le garde-fou anti-divergence : les deux composants partagent la MÊME table de couleurs
  // (buttonToneClasses). Si quelqu'un recopiait un jour les classes dans IconButton, ce test
  // tomberait — c'est le vrai risque d'avoir deux composants plutôt qu'un.
  it("partage exactement les classes de couleur de Button", () => {
    const b = bouton(<Button variant="soft" color="danger">A</Button>).className;
    const i = bouton(<IconButton icon={<Croix />} label="C" variant="soft" color="danger" />)
      .className;
    for (const classe of ["[--btn-fill:var(--danger)]", "[--button-bg:var(--btn-tint)]"]) {
      expect(b).toContain(classe);
      expect(i).toContain(classe);
    }
  });
});
