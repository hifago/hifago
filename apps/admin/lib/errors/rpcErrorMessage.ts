// Ce qu'un dialogue affiche quand une RPC échoue (2026-10-01).
//
// POURQUOI. Sept dialogues affichaient `rpcError.message` tel quel : un texte écrit pour un
// développeur, souvent en français dans une app en espagnol, avec des noms de fonctions, de tables
// ou de colonnes. L'écran reçoit désormais le texte du dialogue (écrit pour lui), sauf pour un refus
// de droits, qui mérite d'être dit comme tel ; le détail part au journal du navigateur, où il reste
// disponible pour le diagnostic. Un motif métier précis à afficher passe par un `reason` rendu par
// la RPC elle-même, jamais par l'analyse de son message.
//
// SEULE EXCEPTION, fermée : un refus métier que la base LÈVE (sans `reason`) et qu'un admin peut
// provoquer en usage normal. Son texte exact est ici, et `rpcErrorMessage.contract.test.ts` le
// relit dans la migration qui le lève : si la base change son texte, le test rougit au lieu que
// l'écran retombe en silence sur le message générique. Jamais une recherche de sous-chaîne.

type RpcError = { code?: string; message?: string } | null | undefined;

const SANS_PERMISSION = "No tienes permiso para esta acción.";

/** Refus métier levés par la base → texte pour l'écran. Égalité stricte du message. */
export const REFUS_LEVES: Readonly<Record<string, string>> = {
  // close_order_line_locked (20261006192424) : une commande payée n'expire pas.
  "transition refusée : une commande payée n'expire pas":
    "Una reserva pagada no puede marcarse como expirada. Elige otro estado.",
};

export function rpcErrorMessage(error: RpcError, fallback: string): string {
  if (!error) return fallback;
  console.error("RPC en échec", error.code, error.message);
  // 42501 (insufficient_privilege) : le code que lèvent les RPC du projet sur un appelant sans le
  // rôle requis.
  if (error.code === "42501") return SANS_PERMISSION;
  if (error.message && Object.hasOwn(REFUS_LEVES, error.message)) return REFUS_LEVES[error.message];
  return fallback;
}
