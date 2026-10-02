// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getActiveOperatorEstablishmentIds,
  getOperatorCapability,
} from "./activeOperatorEstablishments";

// Les deux lectures de `partner_capabilities` décident d'un ACCÈS (gardes des layouts socio, nav)
// et d'un PÉRIMÈTRE (établissements dont on liste les réservations). Ce fichier prouve qu'une
// panne LÈVE : lue comme « aucune capacité », elle renvoyait un operator sur /partner ou lui
// affichait « aucune réservation ».

type Reponse = { data: unknown; error: { message: string } | null };

function client(reponse: Reponse) {
  const requetes: string[] = [];
  const chaine = {
    select: () => chaine,
    eq: () => chaine,
    then: (resoudre: (r: Reponse) => unknown) => resoudre(reponse),
  };
  const supabase = {
    from: (table: string) => {
      requetes.push(table);
      return chaine;
    },
  } as unknown as SupabaseClient;
  return { supabase, requetes };
}

const PANNE: Reponse = { data: null, error: { message: "connection refused" } };

describe("getOperatorCapability", () => {
  it("sans organisation : false, sans requête", async () => {
    const { supabase, requetes } = client({ data: [], error: null });
    await expect(getOperatorCapability(supabase, null)).resolves.toBe(false);
    expect(requetes).toEqual([]);
  });

  it("vrai si l'organisation porte une capacité operator, quel que soit son statut", async () => {
    const { supabase } = client({
      data: [{ role: "operator", status: "suspended", establishment_id: "e-1" }],
      error: null,
    });
    await expect(getOperatorCapability(supabase, "p-1")).resolves.toBe(true);
  });

  it("faux pour un référent pur", async () => {
    const { supabase } = client({
      data: [{ role: "referrer", status: "active", establishment_id: null }],
      error: null,
    });
    await expect(getOperatorCapability(supabase, "p-1")).resolves.toBe(false);
  });

  it("lève sur une panne, au lieu de répondre « pas operator »", async () => {
    const { supabase } = client(PANNE);
    await expect(getOperatorCapability(supabase, "p-1")).rejects.toThrow(/partner_capabilities/);
  });
});

describe("getActiveOperatorEstablishmentIds", () => {
  it("sans organisation : [], sans requête", async () => {
    const { supabase, requetes } = client({ data: [], error: null });
    await expect(getActiveOperatorEstablishmentIds(supabase, null)).resolves.toEqual([]);
    expect(requetes).toEqual([]);
  });

  it("rend les établissements lus, sans les lignes sans établissement", async () => {
    const { supabase } = client({
      data: [{ establishment_id: "e-1" }, { establishment_id: null }, { establishment_id: "e-2" }],
      error: null,
    });
    await expect(getActiveOperatorEstablishmentIds(supabase, "p-1")).resolves.toEqual(["e-1", "e-2"]);
  });

  it("lève sur une panne, au lieu de répondre « aucun établissement »", async () => {
    const { supabase } = client(PANNE);
    await expect(getActiveOperatorEstablishmentIds(supabase, "p-1")).rejects.toThrow(
      /partner_capabilities/
    );
  });
});
