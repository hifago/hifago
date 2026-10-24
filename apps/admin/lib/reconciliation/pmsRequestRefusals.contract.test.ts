// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pmsRefusalMessage, REFUS_PMS_PAR_RAISON } from "./pmsRequestRefusals";

// Chaque raison de la table doit être rendue par la dernière définition de la RPC : si la base
// changeait de code, l'écran retomberait en silence sur le message générique.
const MIGRATION = new URL("../../../../supabase/migrations/20261023150000_lobby_reprise_admin.sql", import.meta.url);

function corpsDeLaRpc(): string {
  const sql = readFileSync(MIGRATION, "utf-8");
  const debut = sql.indexOf("create function public.admin_resolve_pms_booking_request");
  const fin = sql.indexOf("revoke all on function public.admin_resolve_pms_booking_request", debut);
  expect(debut).toBeGreaterThan(-1);
  expect(fin).toBeGreaterThan(debut);
  return sql
    .slice(debut, fin)
    .split("\n")
    .map((ligne) => ligne.replace(/--.*$/, ""))
    .join("\n");
}

describe("REFUS_PMS_PAR_RAISON — code verrouillé sur la RPC qui le rend", () => {
  it.each(Object.keys(REFUS_PMS_PAR_RAISON))("%s est rendu par admin_resolve_pms_booking_request", (raison) => {
    expect(corpsDeLaRpc()).toContain(`'reason', '${raison}'`);
  });

  it("chaque refus que la RPC rend avec un reason a son texte (aucun oubli)", () => {
    const rendus = [...corpsDeLaRpc().matchAll(/'ok', false, 'reason', '([a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(rendus)].sort()).toEqual(Object.keys(REFUS_PMS_PAR_RAISON).sort());
  });

  it("une raison inconnue ou une réponse sans reason → null (le message générique prend le relais)", () => {
    expect(pmsRefusalMessage({ ok: false, reason: "inconnue" })).toBeNull();
    expect(pmsRefusalMessage({ ok: false })).toBeNull();
    expect(pmsRefusalMessage(null)).toBeNull();
    expect(pmsRefusalMessage({ ok: false, reason: "booking_in_use" })).toMatch(/otra orden/);
  });
});
