import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import esOrderResult from "@/messages/es/OrderResultPage.json";
import {
  PuceEstado,
  TONO_POR_ESTADO_LINEA,
  TONO_POR_ESTADO_PEDIDO,
  tonoDeLinea,
  type PuceEstadoTono,
} from "./PuceEstado";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Ce que ce fichier tient : un ton ne repose jamais sur la seule couleur (une icône par ton, le
// libellé en clair), la puce garde son fond opaque sur toutes les surfaces, et la table état → ton
// couvre chaque état que les messages savent dire. Les contrastes, eux, se mesurent au navigateur.

function rendre(tono: PuceEstadoTono, libelle = "Pagada") {
  const { container } = render(
    <PuceEstado tono={tono} testId="puce">
      {libelle}
    </PuceEstado>
  );
  return container.querySelector("[data-testid='puce']") as HTMLElement;
}

const TONOS: PuceEstadoTono[] = ["exito", "alerta", "error", "info", "neutro"];

describe("PuceEstado", () => {
  it("rend une pilule de 28 px, Poppins 600 à 13 px, avec son libellé", () => {
    const puce = rendre("exito");
    expect(puce.tagName).toBe("SPAN");
    expect(puce.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["h-7", "rounded-full", "text-[13px]", "font-semibold"])
    );
    expect(puce.textContent).toBe("Pagada");
    expect(puce.getAttribute("data-tono")).toBe("exito");
  });

  // Plan 41, P3 : une puce de FAIT (occurrence d'un événement, horaires) passe à la ligne au lieu
  // de cacher la fin de sa phrase sous une ellipse ; un statut reste tronqué sur une ligne.
  it("multilinea : la hauteur suit le texte, plus aucune troncature", () => {
    const { container } = render(
      <PuceEstado tono="neutro" multilinea testId="fait">
        Los martes, cada 7 días, hasta el 12 de diciembre de 2026.
      </PuceEstado>
    );
    const puce = container.querySelector("[data-testid='fait']") as HTMLElement;
    const classes = puce.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["min-h-7", "py-1"]));
    expect(classes).not.toContain("h-7");
    expect(puce.querySelector(".truncate")).toBeNull();
    expect(rendre("neutro").querySelector(".truncate")).not.toBeNull();
  });

  // Jamais la couleur seule : cinq tracés différents, et l'icône muette (le libellé parle).
  it("dessine une icône différente par ton, cachée aux technologies d'assistance", () => {
    const icones = TONOS.map((tono) => rendre(tono).querySelector("svg") as SVGElement);
    expect(new Set(icones.map((svg) => svg.innerHTML)).size).toBe(5);
    for (const svg of icones) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("class")).toContain("size-3.5");
    }
  });

  // Le fond est mélangé au BLANC (`--surface`), jamais à la transparence : posée sur l'or, une teinte
  // transparente prendrait la couleur de l'or et le texte du ton y tomberait sous 4,5:1.
  // L'alerte est teintée à 8 % et non 12 : à 12 %, son texte tombait à 4,53:1 (mesuré), au ras du
  // seuil.
  it.each([
    ["exito", "--success", "12%", "text-success"],
    ["alerta", "--warning", "8%", "text-warning"],
    ["error", "--danger", "12%", "text-danger"],
    ["info", "--charte-bleu-moyen", "12%", "text-[var(--charte-bleu-moyen)]"],
  ] as const)("ton %s : fond teinté opaque de %s à %s, texte %s", (tono, jeton, part, texte) => {
    const classes = rendre(tono).className;
    expect(classes).toContain(`bg-[color-mix(in_oklab,var(${jeton})_${part},var(--surface))]`);
    expect(classes.split(/\s+/)).toContain(texte);
    expect(classes).not.toContain("transparent");
  });

  it("neutre : bleu poudre et marine", () => {
    const classes = rendre("neutro").className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(["bg-[var(--default)]", "text-[var(--default-foreground)]"])
    );
  });

  // La table couvre CHAQUE état que l'écran sait dire : un état ajouté aux messages sans ton
  // tomberait sinon sur `undefined`, et la puce perdrait sa couleur sans que rien ne rougisse.
  it("donne un ton à chaque état de commande et de ligne que les messages savent dire", () => {
    const etats = Object.keys(esOrderResult.status).filter((cle) => !cle.endsWith("Detail"));
    expect(Object.keys(TONO_POR_ESTADO_PEDIDO).sort()).toEqual(etats.sort());
    expect(Object.keys(TONO_POR_ESTADO_LINEA).sort()).toEqual(Object.keys(esOrderResult.lineStatus).sort());
  });

  it("applique la correspondance du plan (S7)", () => {
    expect(TONO_POR_ESTADO_PEDIDO).toEqual({
      paid: "exito",
      confirmed: "exito",
      unpaid: "alerta",
      awaiting: "info",
      failed: "error",
      expired: "error",
      paid_not_honored: "error",
      cancelled: "neutro",
      refunded: "info",
    });
    expect(tonoDeLinea("fulfilled")).toBe("exito");
    expect(tonoDeLinea("no_show")).toBe("alerta");
    expect(tonoDeLinea("cancelled_by_provider")).toBe("error");
    expect(tonoDeLinea("superseded")).toBe("neutro");
    // Un état inconnu (ajouté en base avant ce fichier) reste neutre, jamais sans couleur.
    expect(tonoDeLinea("inconnu")).toBe("neutro");
  });

  it("reste un Server Component : ni \"use client\", ni @hifago/ui", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "PuceEstado.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/from ["']@hifago\/ui/);
  });
});
