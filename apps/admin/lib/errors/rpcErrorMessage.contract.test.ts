// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REFUS_LEVES } from "./rpcErrorMessage";

// Chaque refus de REFUS_LEVES doit être levé, À L'IDENTIQUE, par la dernière définition de la
// fonction qui le porte : sinon l'écran retomberait en silence sur le message générique.
const DOSSIER = new URL("../../../../supabase/migrations/", import.meta.url);

/** Corps SQL de la dernière migration qui (re)définit `fonction`. */
function derniereDefinition(fonction: string): string {
  const motif = new RegExp(`create (or replace )?function public\\.${fonction}\\b`, "i");
  const fichiers = readdirSync(DOSSIER)
    .filter((nom) => nom.endsWith(".sql"))
    .sort()
    .filter((nom) => motif.test(readFileSync(new URL(nom, DOSSIER), "utf-8")));
  expect(fichiers.length).toBeGreaterThan(0);
  return readFileSync(new URL(fichiers[fichiers.length - 1], DOSSIER), "utf-8");
}

const PORTEURS: Record<string, string> = {
  "transition refusée : une commande payée n'expire pas": "close_order_line_locked",
};

describe("REFUS_LEVES — texte verrouillé sur la migration qui le lève", () => {
  it("chaque refus a sa fonction porteuse", () => {
    expect(Object.keys(REFUS_LEVES).sort()).toEqual(Object.keys(PORTEURS).sort());
  });

  it.each(Object.entries(PORTEURS))("« %s » est levé par %s", (message, fonction) => {
    // Côté SQL, l'apostrophe est doublée dans le littéral.
    const litteral = `raise exception '${message.replaceAll("'", "''")}'`;
    expect(derniereDefinition(fonction)).toContain(litteral);
  });
});
