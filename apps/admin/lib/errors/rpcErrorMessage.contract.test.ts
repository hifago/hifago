// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REFUS_PAR_CODE } from "./rpcErrorMessage";

// Chaque code de REFUS_PAR_CODE doit être levé par la dernière définition de la fonction qui le
// porte : si la base changeait de code, l'écran retomberait en silence sur le message générique.
const DOSSIER = new URL("../../../../supabase/migrations/", import.meta.url);

/**
 * Corps SQL (commentaires `--` retirés) de la DERNIÈRE définition de `fonction` : de son
 * `create … function` à la fin de son bloc dollar-quoté — jamais le fichier entier, qui définit
 * d'autres fonctions et cite des messages en commentaire.
 */
function derniereDefinition(fonction: string): string {
  const motif = new RegExp(`create (or replace )?function public\\.${fonction}\\b`, "gi");
  const fichiers = readdirSync(DOSSIER)
    .filter((nom) => nom.endsWith(".sql"))
    .sort()
    .filter((nom) => new RegExp(motif.source, "i").test(readFileSync(new URL(nom, DOSSIER), "utf-8")));
  expect(fichiers.length).toBeGreaterThan(0);
  const sql = readFileSync(new URL(fichiers[fichiers.length - 1], DOSSIER), "utf-8");
  const debut = [...sql.matchAll(motif)].at(-1)!.index!;
  const ouverture = /\bas\s+(\$[A-Za-z_]*\$)/i.exec(sql.slice(debut))!;
  const corpsDebut = debut + ouverture.index + ouverture[0].length;
  const corpsFin = sql.indexOf(ouverture[1], corpsDebut);
  expect(corpsFin).toBeGreaterThan(corpsDebut);
  return sql
    .slice(corpsDebut, corpsFin)
    .split("\n")
    .map((ligne) => ligne.replace(/--.*$/, ""))
    .join("\n");
}

const PORTEURS: Record<string, string> = {
  HF001: "close_order_line_locked",
};

describe("REFUS_PAR_CODE — code verrouillé sur la migration qui le lève", () => {
  it("chaque code a sa fonction porteuse", () => {
    expect(Object.keys(REFUS_PAR_CODE).sort()).toEqual(Object.keys(PORTEURS).sort());
  });

  it.each(Object.entries(PORTEURS))("%s est levé par %s", (code, fonction) => {
    expect(derniereDefinition(fonction)).toMatch(new RegExp(`raise exception[^;]*errcode\\s*=\\s*'${code}'`, "i"));
  });
});
