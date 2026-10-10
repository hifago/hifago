// Budget de temps d'un passage de job : le délai à donner au prochain appel externe, ou null quand
// le passage doit s'arrêter (le reste attend le passage suivant). Pur — l'horloge est injectée —,
// pour que la règle soit testée sans attendre (Edge Functions : `performance.now`).
//
//   - jamais plus que `callTimeoutMs` par appel ;
//   - jamais au-delà de la fin du budget ;
//   - en dessous de `minCallMs`, un appel n'a plus le temps d'aboutir : null, plutôt qu'un échec.
export function createCallBudget(
  now: () => number,
  budgetMs: number,
  callTimeoutMs: number,
  minCallMs = 1_500
): () => number | null {
  const deadline = now() + budgetMs;
  return () => {
    const remaining = deadline - now();
    return remaining < minCallMs ? null : Math.min(callTimeoutMs, Math.floor(remaining));
  };
}
