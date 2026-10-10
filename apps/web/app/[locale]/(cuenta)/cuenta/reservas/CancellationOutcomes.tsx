"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// L'issue d'une annulation (faite, ou refusée et pourquoi), gardée PAR LIGNE au niveau de la page.
//
// ⚠️ POURQUOI PAS UN SIMPLE ÉTAT DANS LE BOUTON. Après l'annulation, `router.refresh()` relit
// `list_my_orders` : une commande dont la dernière prestation à venir vient d'être annulée passe du
// groupe « à venir » au groupe « passées », donc dans une AUTRE section de la page. React y démonte
// et remonte sa carte, et un état local au bouton disparaîtrait avec elle — le client ne saurait pas
// que l'annulation a eu lieu (décision de Gabriel, 2026-10-06). Monté au-dessus des deux sections,
// ce fournisseur survit au déplacement.
//
// OBLIGATOIRE : `useCancellationIssue` lève sans lui. L'oublier casse l'écran au rendu, au lieu de
// perdre le message en silence.

export type CancellationIssue = { kind: "cancelled"; wholeOrder: boolean } | { kind: "failed"; message: string };

type Contexte = {
  issues: Readonly<Record<string, CancellationIssue>>;
  setIssue: (lineId: string, issue: CancellationIssue | null) => void;
};

const CancellationOutcomes = createContext<Contexte | null>(null);

export function CancellationOutcomesProvider({ children }: { children: ReactNode }) {
  const [issues, setIssues] = useState<Record<string, CancellationIssue>>({});
  const setIssue = useCallback((lineId: string, issue: CancellationIssue | null) => {
    setIssues((avant) => {
      const apres = { ...avant };
      if (issue) apres[lineId] = issue;
      else delete apres[lineId];
      return apres;
    });
  }, []);
  const valeur = useMemo(() => ({ issues, setIssue }), [issues, setIssue]);
  return <CancellationOutcomes.Provider value={valeur}>{children}</CancellationOutcomes.Provider>;
}

export function useCancellationIssue(
  lineId: string
): [CancellationIssue | null, (issue: CancellationIssue | null) => void] {
  const contexte = useContext(CancellationOutcomes);
  if (!contexte) {
    throw new Error("CancelLineButton exige CancellationOutcomesProvider au-dessus des groupes de la page");
  }
  const { issues, setIssue } = contexte;
  return [issues[lineId] ?? null, (issue) => setIssue(lineId, issue)];
}
