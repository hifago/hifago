// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRODUCT_INLINE_REFUSALS, RENAME_REFUSALS } from "./inlineEdit";

// Les RPC d'édition en ligne (20261013145629) RENDENT leurs refus métier dans `reason` ; l'écran
// les traduit par ces deux tables. Si la base gagnait un motif sans que la table suive, l'admin
// lirait « No se pudo guardar. » sans savoir pourquoi — et un motif disparu de la base laisserait
// ici un texte mort. Ce test verrouille les deux sens, sur la DERNIÈRE définition de chaque fonction.
const DOSSIER = new URL("../../../../supabase/migrations/", import.meta.url);

/** Motifs `'reason', '<motif>'` de la dernière définition de `fonction`, commentaires retirés. */
function motifsRendus(fonction: string): string[] {
  const entete = new RegExp(`create (or replace )?function public\\.${fonction}\\b`, "gi");
  const fichiers = readdirSync(DOSSIER)
    .filter((nom) => nom.endsWith(".sql"))
    .sort()
    .filter((nom) => new RegExp(entete.source, "i").test(readFileSync(new URL(nom, DOSSIER), "utf-8")));
  expect(fichiers.length, `aucune migration ne définit ${fonction}`).toBeGreaterThan(0);
  const sql = readFileSync(new URL(fichiers[fichiers.length - 1], DOSSIER), "utf-8");
  const debut = [...sql.matchAll(entete)].at(-1)!.index!;
  const ouverture = /\bas\s+(\$[A-Za-z_]*\$)/i.exec(sql.slice(debut))!;
  const corpsDebut = debut + ouverture.index + ouverture[0].length;
  const corps = sql
    .slice(corpsDebut, sql.indexOf(ouverture[1], corpsDebut))
    .split("\n")
    .map((ligne) => ligne.replace(/--.*$/, ""))
    .join("\n");
  return [...new Set([...corps.matchAll(/'reason',\s*'([a-z_]+)'/g)].map((trouve) => trouve[1]))].sort();
}

describe("refus des RPC d'édition en ligne — chaque motif a son texte, et réciproquement", () => {
  it("admin_update_product_inline ↔ PRODUCT_INLINE_REFUSALS", () => {
    expect(motifsRendus("admin_update_product_inline")).toEqual(Object.keys(PRODUCT_INLINE_REFUSALS).sort());
  });

  it("admin_rename_establishment et admin_rename_partner ↔ RENAME_REFUSALS", () => {
    const attendus = Object.keys(RENAME_REFUSALS).sort();
    expect(motifsRendus("admin_rename_establishment")).toEqual(attendus);
    expect(motifsRendus("admin_rename_partner")).toEqual(attendus);
  });
});
