// @vitest-environment node
//
// Node, pas jsdom : ce fichier LIT deux fichiers du dépôt (les messages, et la source de la
// Route Handler) pour vérifier que la table ne périme pas. Sous jsdom, `import.meta.url` n'est
// pas une URL `file:` et `fileURLToPath` refuse — mesuré, pas supposé.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MOTIVOS_PMS, motivoPms } from "./pms";
import { loadMessages } from "@/messages";

describe("motivoPms", () => {
  it("pms_rate_limited est retentable ET porte son message propre", () => {
    expect(motivoPms("pms_rate_limited")).toEqual({
      reintentable: true,
      claveI18n: "pmsAvailabilityRateLimited",
    });
  });

  it("pms_unreachable reste retentable — la panne mesurée est transitoire", () => {
    // Novembre est revenu 0, puis 29/30, puis 30/30 (2026-08-28). Ce qui manquait n'était pas un
    // meilleur message, c'était de REDEMANDER.
    expect(motivoPms("pms_unreachable").reintentable).toBe(true);
  });

  it("connector_inactive n'est pas retentable — rien ne changera sans qu'un admin agisse", () => {
    expect(motivoPms("connector_inactive").reintentable).toBe(false);
  });

  it("pms_category_not_quoted n'est PLUS retentable — la dette du backlog", () => {
    expect(motivoPms("pms_category_not_quoted").reintentable).toBe(false);
  });

  it("month_out_of_range n'est PLUS retentable non plus — et personne ne l'avait réclamé", () => {
    // Réessayer un mois hors horizon ne réussira jamais. Il héritait pourtant de « retentable »
    // par le `reason !== "connector_inactive"` d'origine. Trouvé en écrivant la table.
    expect(motivoPms("month_out_of_range").reintentable).toBe(false);
  });

  it("un motif INCONNU n'est pas retentable — le défaut est fermé, délibérément", () => {
    // Si le défaut était « retentable », un motif ajouté côté route sans être ajouté ici resterait
    // invisible : le bouton s'afficherait et le visiteur cliquerait en vain. Fermé, l'oubli se voit.
    expect(motivoPms("motif_qui_nexiste_pas").reintentable).toBe(false);
  });

  it("un motif ABSENT de la réponse retombe sur le même repli", () => {
    expect(motivoPms(undefined).reintentable).toBe(false);
  });

  it("tout motif rend une clé i18n qui existe vraiment dans le namespace ProductPage", () => {
    const messages = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../messages/es/ProductPage.json", import.meta.url)),
        "utf8"
      )
    ) as Record<string, string>;
    for (const [motivo, { claveI18n }] of Object.entries(MOTIVOS_PMS)) {
      expect(messages, `${motivo} → ${claveI18n}`).toHaveProperty(claveI18n);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// LE TEST QUI EMPÊCHE LA TABLE DE PÉRIMER.
//
// Une table de motifs écrite à la main périme dès qu'on ajoute un `reason` côté Route Handler — et
// elle périme EN SILENCE : le motif nouveau retombe simplement sur le repli. C'est exactement le
// défaut que ce lot corrige (le formulaire connaissait DEUX motifs sur dix), donc le reproduire
// sous une autre forme serait absurde.
//
// D'où ce test, qui relit la source de la route. Il n'est pas élégant ; il est le seul qui échoue
// quand quelqu'un ajoute un motif sans se poser la question « est-ce que réessayer peut marcher ? ».
// CLAUDE.md §11.20 : une règle que rien ne vérifie n'est pas une règle, c'est un souhait.
// ------------------------------------------------------------------------------------------------
describe("la table couvre TOUS les motifs de /api/pms/night-availability", () => {
  it("aucun motif de la Route Handler n'échappe à la table", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../app/api/pms/night-availability/route.ts", import.meta.url)),
      "utf8"
    );

    const motifs = new Set<string>();
    // Forme 1 — le littéral posé directement dans la réponse : `reason: "pms_rate_limited"`.
    for (const m of source.matchAll(/reason:\s*"([a-z_]+)"/g)) motifs.add(m[1]);
    // Forme 2 — le motif calculé avant la réponse : `const reason = … ? "pms_rejected" : …`.
    //
    // ⚠️ On retire d'abord les littéraux de COMPARAISON (`failure.kind === "rejected"`), sans quoi
    // les valeurs testées sont prises pour des motifs. Ce faux positif s'est produit à la première
    // exécution de ce test — ce qui est aussi la démonstration qu'il regarde vraiment la source.
    for (const bloc of source.matchAll(/const reason\s*=([\s\S]*?);/g)) {
      const sansComparaisons = bloc[1].replace(/[=!]==?\s*"[a-z_]+"/g, "");
      for (const m of sansComparaisons.matchAll(/"([a-z_]+)"/g)) motifs.add(m[1]);
    }

    // Garde-fou du garde-fou : si les deux regex cessaient de trouver quoi que ce soit (la route
    // refactorisée autrement), le test passerait pour de mauvaises raisons.
    expect(motifs.size).toBeGreaterThanOrEqual(10);

    const inconnus = [...motifs].filter((motif) => !(motif in MOTIVOS_PMS));
    expect(
      inconnus,
      `Motifs émis par la route et absents de MOTIVOS_PMS : ${inconnus.join(", ")}. ` +
        "Ajoute-les à la table en décidant, pour chacun, si RÉESSAYER peut réussir."
    ).toEqual([]);
  });
});

// Connecteur coupé : réessayer ne changera rien tant qu'un admin n'agit pas. Le texte ne doit donc
// pas inviter à réessayer (il renvoie vers l'établissement), contrairement à une panne passagère.
describe("motivoPms — texte du connecteur coupé", () => {
  it("connector_inactive a son propre message, sans invitation à réessayer", () => {
    const { claveI18n } = motivoPms("connector_inactive");
    expect(claveI18n).toBe("pmsAvailabilityConnectorOff");
    const es = loadMessages("es").ProductPage as unknown as Record<string, string>;
    expect(es[claveI18n]).toBeTruthy();
    expect(es[claveI18n]).not.toMatch(/intenta|inténtalo|de nuevo/i);
  });
});

