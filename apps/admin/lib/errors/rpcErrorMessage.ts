// Ce qu'un dialogue affiche quand une RPC échoue (2026-10-01).
//
// POURQUOI. Sept dialogues affichaient `rpcError.message` tel quel : un texte écrit pour un
// développeur, souvent en français dans une app en espagnol, avec des noms de fonctions, de tables
// ou de colonnes. L'écran reçoit désormais le texte du dialogue (écrit pour lui), sauf pour un refus
// de droits, qui mérite d'être dit comme tel ; le détail part au journal du navigateur, où il reste
// disponible pour le diagnostic. Un motif métier précis à afficher passe par un `reason` rendu par
// la RPC elle-même, jamais par l'analyse de son message.

type RpcError = { code?: string; message?: string } | null | undefined;

const SANS_PERMISSION = "No tienes permiso para esta acción.";

export function rpcErrorMessage(error: RpcError, fallback: string): string {
  if (!error) return fallback;
  console.error("RPC en échec", error.code, error.message);
  // 42501 (insufficient_privilege) : le code que lèvent les RPC du projet sur un appelant sans le
  // rôle requis.
  if (error.code === "42501") return SANS_PERMISSION;
  return fallback;
}
