// L'avertissement de passage du job payments-reconcile quand des décisions ont été prises sans
// contrôle d'identité Mercado Pago (paiement sans compte encaisseur enregistré, migration
// 20261014030249). Il s'affiche TEL QUEL dans l'admin, qui est en espagnol : texte espagnol, accordé
// au nombre. Pur — testé sans réseau. null quand il n'y a rien à signaler.

export function identityUncheckedWarning(count: number): string | null {
  if (!Number.isInteger(count) || count <= 0) return null;
  return count === 1
    ? "1 decisión tomada sin control de identidad de Mercado Pago: la cuenta receptora no estaba registrada al crear el pago"
    : `${count} decisiones tomadas sin control de identidad de Mercado Pago: la cuenta receptora no estaba registrada al crear los pagos`;
}
