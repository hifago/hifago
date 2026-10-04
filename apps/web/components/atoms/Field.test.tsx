import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Field } from "./Field";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Ce fichier teste ce que la surcouche AJOUTE aux primitives HeroUI : le champ requis qui ne
// bloque plus la soumission, et la relation entre le champ, son erreur et son aide. Le
// comportement de `TextField`/`Input` eux-mêmes n'est pas retesté.
function rendu(element: React.ReactElement) {
  const { container } = render(element);
  return {
    container,
    input: container.querySelector("input") as HTMLInputElement,
    racine: container.firstElementChild as HTMLElement,
  };
}

describe("Field", () => {
  it("rend un libellé relié à son champ, avec sa valeur et son testId", () => {
    const { container, input, racine } = rendu(
      <Field label="Correo" value="ada@example.com" onChange={() => {}} testId="email" />
    );
    expect(input.value).toBe("ada@example.com");
    expect(racine.getAttribute("data-testid")).toBe("email");
    expect(input.getAttribute("data-testid")).toBe("email-input");
    const label = container.querySelector("label") as HTMLLabelElement;
    expect(label.textContent).toBe("Correo");
    // Le lien label→champ passe par les id générés de react-aria, pas par le hasard du DOM.
    expect(label.getAttribute("for")).toBe(input.id);
  });

  it("remonte la saisie", () => {
    const onChange = vi.fn();
    const { input } = rendu(<Field label="Correo" value="" onChange={onChange} />);
    fireEvent.change(input, { target: { value: "a@b.co" } });
    expect(onChange).toHaveBeenCalledWith("a@b.co");
  });

  // ⚠️ LE test de ce lot (CLAUDE.md §11 point 11) : un champ `required` natif fait bloquer la
  // soumission par le navigateur AVANT le `onSubmit` React — ni message inline, ni toast. La
  // parade documentée (`noValidate` sur le <form>) dépend de la mémoire de qui écrit le
  // formulaire ; ici c'est le champ qui la rend inutile.
  it("annonce qu'il est requis SANS poser la contrainte native qui bloque la soumission", () => {
    const { input } = rendu(<Field label="Correo" value="" onChange={() => {}} isRequired />);
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.hasAttribute("required")).toBe(false);
  });

  it("ne bloque pas la soumission d'un <form> qui a oublié noValidate", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const { container } = render(
      <form onSubmit={onSubmit}>
        <Field label="Correo" value="" onChange={() => {}} isRequired />
        <button type="submit">Enviar</button>
      </form>
    );
    const formulaire = container.querySelector("form") as HTMLFormElement;
    // `checkValidity` est exactement ce que le navigateur consulte avant de soumettre : vide et
    // requis, il rendrait `false` avec la contrainte native, et la soumission n'aurait pas lieu.
    expect(formulaire.checkValidity()).toBe(true);
    fireEvent.submit(formulaire);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  describe("erreur et texte d'aide", () => {
    it("relie l'erreur au champ pour un lecteur d'écran", () => {
      const { container, input } = rendu(
        <Field label="Correo" value="" onChange={() => {}} error="Falta el correo" testId="email" />
      );
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const message = container.querySelector('[data-testid="email-error"]') as HTMLElement;
      expect(message.textContent).toBe("Falta el correo");
      // La relation, pas seulement la présence : un message affiché mais non relié n'existe pas
      // pour un lecteur d'écran, et rien à l'écran ne le signale.
      expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(message.id);
    });

    it("relie aussi le texte d'aide, et les deux à la fois", () => {
      const { container, input } = rendu(
        <Field label="Clave" value="" onChange={() => {}} hint="Mínimo 6 caracteres" error="Muy corta" testId="pwd" />
      );
      const decrits = input.getAttribute("aria-describedby")?.split(" ") ?? [];
      const aide = container.querySelector('[data-testid="pwd-hint"]') as HTMLElement;
      const erreur = container.querySelector('[data-testid="pwd-error"]') as HTMLElement;
      expect(decrits).toContain(aide.id);
      expect(decrits).toContain(erreur.id);
    });

    it("reste valide tant qu'aucune erreur n'est fournie", () => {
      const { input } = rendu(<Field label="Correo" value="" onChange={() => {}} hint="Aide" />);
      expect(input.getAttribute("aria-invalid")).not.toBe("true");
    });
  });

  // ⚠️ Remplace les `className` que quatre écrans passent aujourd'hui à `TextField`
  // (`min-w-48 flex-1` pour la recherche, `max-w-32` pour les trois quantités) — interdits par
  // components/README.md.
  it("porte la largeur en intention plutôt qu'en classes", () => {
    expect(rendu(<Field label="A" value="" onChange={() => {}} />).racine.className).toContain("w-full");
    expect(
      rendu(<Field label="A" value="" onChange={() => {}} width="short" />).racine.className
    ).toContain("max-w-32");
    const large = rendu(<Field label="A" value="" onChange={() => {}} width="grow" />).racine.className;
    expect(large).toContain("min-w-48");
    expect(large).toContain("flex-1");
  });

  it("garde une cible tactile d'au moins 44 px (48 px, plan 41 S11)", () => {
    // `.input` de HeroUI ne fixe aucune hauteur : sans ce plancher, le champ mesure 42 px sur
    // mobile et 38 px sur desktop (mesuré au rendu : 16 px de texte + py-2 + bordures, puis 14 px
    // de texte à partir de `sm`), sous la règle du README. Le champ de la charte fait 48 px.
    expect(rendu(<Field label="A" value="" onChange={() => {}} />).input.className).toContain("min-h-12");
  });

  it("ouvre le clavier numérique et porte les bornes pour un champ de quantité", () => {
    const { input } = rendu(
      <Field label="Cantidad" type="number" value="2" onChange={() => {}} min={1} max={9} width="short" />
    );
    expect(input.getAttribute("type")).toBe("number");
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("min")).toBe("1");
    expect(input.getAttribute("max")).toBe("9");
  });

  // ⚠️ Le champ mot de passe et son bouton de révélation (2026-09-02). Le masquage lui-même vient
  // du navigateur ; ce qui se teste ici, c'est que le type BASCULE et que le bouton porte le bon
  // nom accessible dans chaque état — un bouton d'icône dont le nom ne suit pas l'état ment au
  // lecteur d'écran une fois sur deux.
  describe("mot de passe", () => {
    // Signature volontairement étroite plutôt qu'un `Partial<FieldProps>` : `FieldProps` est une
    // union discriminée, et un spread partiel par-dessus ne se type pas (TypeScript ne peut plus
    // décider de quelle branche il s'agit).
    const motDePasse = ({ isDisabled }: { isDisabled?: boolean } = {}) =>
      rendu(
        <Field
          label="Contraseña"
          type="password"
          value="secreto"
          onChange={() => {}}
          revealLabel="Mostrar la contraseña"
          hideLabel="Ocultar la contraseña"
          isDisabled={isDisabled}
          testId="pwd"
        />
      );

    it("masque la saisie par défaut", () => {
      expect(motDePasse().input.getAttribute("type")).toBe("password");
    });

    it("révèle puis remasque au clic, en changeant le nom du bouton", () => {
      const { container, input } = motDePasse();
      const bouton = container.querySelector('[data-testid="pwd-reveal"]') as HTMLButtonElement;
      expect(bouton.getAttribute("aria-label")).toBe("Mostrar la contraseña");

      fireEvent.click(bouton);
      expect(input.getAttribute("type")).toBe("text");
      expect(bouton.getAttribute("aria-label")).toBe("Ocultar la contraseña");

      fireEvent.click(bouton);
      expect(input.getAttribute("type")).toBe("password");
      expect(bouton.getAttribute("aria-label")).toBe("Mostrar la contraseña");
    });

    it("ne soumet pas le formulaire quand on révèle", () => {
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
      const { container } = render(
        <form onSubmit={onSubmit}>
          <Field
            label="Contraseña"
            type="password"
            value="x"
            onChange={() => {}}
            revealLabel="Mostrar"
            hideLabel="Ocultar"
            testId="pwd"
          />
        </form>
      );
      const bouton = container.querySelector('[data-testid="pwd-reveal"]') as HTMLButtonElement;
      // Un bouton sans `type` explicite dans un <form> vaut `submit` : ce serait un envoi à chaque
      // coup d'œil sur son mot de passe.
      expect(bouton.getAttribute("type")).toBe("button");
      fireEvent.click(bouton);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("n'ajoute aucun bouton aux autres types", () => {
      const { container } = rendu(
        <Field label="Correo" type="email" value="" onChange={() => {}} testId="mail" />
      );
      expect(container.querySelector("button")).toBeNull();
    });

    it("réserve la place du bouton pour que le texte ne passe pas dessous", () => {
      expect(motDePasse().input.className).toContain("pr-11");
    });

    it("suit la désactivation du champ", () => {
      const { container } = motDePasse({ isDisabled: true });
      const bouton = container.querySelector('[data-testid="pwd-reveal"]') as HTMLButtonElement;
      expect(bouton.hasAttribute("disabled")).toBe(true);
    });
  });

  it("se désactive", () => {
    const { input } = rendu(<Field label="A" value="" onChange={() => {}} isDisabled />);
    expect(input.hasAttribute("disabled")).toBe(true);
  });
});
