// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Contrat entre la route du webhook et le trigger d'e-mails admin (migration 20261002125023).
//
// Le trigger notify_admin_new_reconciliation_exception étrangle les e-mails d'UNE classe d'entrées :
// les échecs de signature, qu'il reconnaît à leur `failure_reason` (« signature invalide (… ») et à
// l'absence de payment_id. Ce texte est écrit ICI, en TypeScript ; le trigger le lit en SQL. Si l'un
// change sans l'autre, l'étranglement s'éteint en silence — un e-mail par entrée et par admin, ce que
// la migration est venue arrêter. Aucun des deux tests (Vitest de la route, pgTAP du trigger) ne le
// verrait : chacun épingle son propre littéral. Celui-ci les compare (CLAUDE.md §11.20).

const PREFIXE = "signature invalide (";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf-8");

/** La dernière migration qui crée ou redéfinit le trigger — celle qui fait foi. */
function derniereDefinitionDuTrigger(): string {
  const dossier = new URL("../../../../../../supabase/migrations/", import.meta.url);
  const definition = /create\s+(or\s+replace\s+)?function\s+("?public"?\.)?"?notify_admin_new_reconciliation_exception"?\s*\(/i;
  const fichiers = readdirSync(dossier)
    .filter((nom) => nom.endsWith(".sql"))
    .sort()
    .filter((nom) => definition.test(readFileSync(new URL(nom, dossier), "utf-8")));
  expect(fichiers.length, "aucune migration ne définit le trigger").toBeGreaterThan(0);
  return readFileSync(new URL(fichiers[fichiers.length - 1], dossier), "utf-8");
}

describe("contrat route du webhook ↔ trigger d'e-mails admin", () => {
  it("la route écrit l'échec de signature avec le préfixe que le trigger étrangle", () => {
    const occurrences = route.split(`failureReason: \`${PREFIXE}\${`).length - 1;
    expect(occurrences).toBe(1);
  });

  it("le trigger reconnaît la classe à ce même préfixe", () => {
    const sql = derniereDefinitionDuTrigger();
    expect(sql).toContain(`new.failure_reason like '${PREFIXE}%'`);
    expect(sql).toContain(`e.failure_reason like '${PREFIXE}%'`);
  });

  it("la route écrit cet échec SANS payment_id, comme le trigger l'attend", () => {
    // Tout l'appel, avant ET après le littéral. Fin sur `});` : `})` figure déjà dans `${reason})`.
    const litteral = route.indexOf(`failureReason: \`${PREFIXE}\${`);
    const debut = route.lastIndexOf("recordFailure({", litteral);
    const fin = route.indexOf("});", litteral);
    expect(debut).toBeGreaterThan(0);
    expect(fin).toBeGreaterThan(litteral);
    expect(route.slice(debut, fin)).not.toContain("paymentId");
  });
});
