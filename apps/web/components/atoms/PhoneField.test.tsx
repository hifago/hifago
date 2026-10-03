import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { PhoneField } from "./PhoneField";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
function rendu(element: React.ReactElement) {
  // `PhoneField` appelle `useLocale()` (next-intl) pour choisir les noms de pays traduits par la
  // lib — un rendu hors provider lèverait, comme tout composant client du dépôt qui traduit.
  const { container } = render(
    <NextIntlClientProvider locale="es" messages={{}}>
      {element}
    </NextIntlClientProvider>
  );
  return {
    container,
    input: container.querySelector("input") as HTMLInputElement,
    select: container.querySelector("select") as HTMLSelectElement,
    label: container.querySelector("label") as HTMLLabelElement,
  };
}

describe("PhoneField", () => {
  it("rend un sélecteur de pays et un champ numéro, reliés au même libellé", () => {
    const { input, select, label } = rendu(
      <PhoneField
        label="WhatsApp"
        countryLabel="Indicativo del país"
        value=""
        onChange={() => {}}
        testId="holder-phone"
      />
    );
    expect(label.textContent).toBe("WhatsApp");
    expect(label.getAttribute("for")).toBe(input.id);
    expect(select.getAttribute("aria-label")).toBe("Indicativo del país");
  });

  // Plan 41, item S11 : indicatif et numéro forment UN groupe visuel — collés, arrondis seulement
  // dehors, la bordure de l'indicatif servant de filet. Le rendu se mesure dans la story ; ici, le
  // contrat des classes, et la hauteur de 48 px des champs.
  it("colle l'indicatif et le numéro en un seul groupe, à 48 px", () => {
    const { input, select } = rendu(
      <PhoneField label="WhatsApp" countryLabel="País" value="" onChange={() => {}} />
    );
    expect(select.parentElement).toBe(input.parentElement);
    expect(select.parentElement?.className).not.toContain("gap-");
    expect(select.className).toContain("rounded-r-none");
    expect(input.className).toContain("rounded-l-none");
    expect(input.className).toContain("border-l-0");
    expect(input.className).toContain("min-h-12");
  });

  it("présélectionne le pays par défaut (Colombie, sauf indication contraire)", () => {
    const { select } = rendu(
      <PhoneField label="WhatsApp" countryLabel="País" value="" onChange={() => {}} />
    );
    expect(select.value).toBe("CO");
  });

  it("appelle onChange avec un numéro au format E.164 quand on tape un numéro", () => {
    const onChange = vi.fn();
    const { input } = rendu(
      <PhoneField label="WhatsApp" countryLabel="País" value="" onChange={onChange} />
    );
    fireEvent.change(input, { target: { value: "3001234567" } });
    expect(onChange).toHaveBeenCalledWith("+573001234567");
  });

  it("bascule d'indicatif quand un autre pays est choisi, sans perdre le numéro déjà saisi", () => {
    const onChange = vi.fn();
    const { input, select } = rendu(
      <PhoneField label="WhatsApp" countryLabel="País" value="" onChange={onChange} />
    );
    fireEvent.change(input, { target: { value: "3001234567" } });
    fireEvent.change(select, { target: { value: "US" } });
    expect(onChange).toHaveBeenLastCalledWith("+13001234567");
  });

  // ⚠️ Comme Checkbox (même raison, cf. son en-tête) : ce champ n'a pas de conteneur react-aria
  // (TextField) pour poser aria-describedby tout seul — la lib pilote elle-même le DOM des deux
  // sous-champs. Le lien est écrit à la main ; s'il disparaissait, rien à l'écran ne le montrerait.
  it("relie son texte d'aide et son erreur au champ numéro", () => {
    const { container, input } = rendu(
      <PhoneField
        label="WhatsApp"
        countryLabel="País"
        value=""
        onChange={() => {}}
        hint="Te escribiremos ahí"
        error="Número inválido"
        testId="holder-phone"
      />
    );
    const aide = container.querySelector('[data-testid="holder-phone-hint"]') as HTMLElement;
    const erreur = container.querySelector('[data-testid="holder-phone-error"]') as HTMLElement;
    const decrits = input.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(decrits).toContain(aide.id);
    expect(decrits).toContain(erreur.id);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("ne décrit rien quand il n'y a ni aide ni erreur", () => {
    const { input } = rendu(
      <PhoneField label="WhatsApp" countryLabel="País" value="" onChange={() => {}} />
    );
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });

  // ⚠️ Piège CLAUDE.md §11 point 11 (formulaire qui ne se soumet pas) : ce champ n'a jamais son
  // attribut natif `required`, jamais dépendant d'un `noValidate` sur le <form> appelant.
  it("marque le champ requis en aria seulement, jamais en validation native", () => {
    const { input } = rendu(
      <PhoneField
        label="WhatsApp"
        countryLabel="País"
        value=""
        onChange={() => {}}
        isRequired
      />
    );
    expect(input.hasAttribute("required")).toBe(false);
    expect(input.getAttribute("aria-required")).toBe("true");
  });

  it("se désactive entièrement (numéro et sélecteur de pays)", () => {
    const { input, select } = rendu(
      <PhoneField
        label="WhatsApp"
        countryLabel="País"
        value=""
        onChange={() => {}}
        isDisabled
      />
    );
    expect(input.hasAttribute("disabled")).toBe(true);
    expect(select.hasAttribute("disabled")).toBe(true);
  });
});
