// Une lecture Supabase dont l'échec est une PANNE, jamais une absence (2026-10-02).
//
// supabase-js ne lève pas : il rend `{ data: null, error }`. Lu sans son `error`, un échec devenait
// « introuvable » (404), une liste vide, un compteur à zéro — autant de réponses fausses mais
// plausibles. `checkedRead` lève à la place ; app/error.tsx affiche alors l'écran d'erreur, qui
// propose de réessayer. Le résultat rendu a son `error` à `null` : `data` et `count` s'y lisent
// comme d'habitude.
//
//   const { data: media } = checkedRead(await supabase.from("establishment_media")…, "establishment_media");
//
// ⚠️ Pour une absence LÉGITIME (fiche introuvable), c'est `data === null` après la lecture, jamais
// l'erreur, qui décide du 404. Un identifiant d'URL qui n'est pas un UUID se refuse AVANT la lecture
// (lib/routing/requireUuidParam.ts), sinon la lecture échoue et la page afficherait l'écran d'erreur.
type Lecture = { error: { message: string } | null };

export function checkedRead<R extends Lecture>(result: R, source: string): R & { error: null } {
  if (result.error) {
    throw new Error(`Lecture impossible (${source}) : ${result.error.message}`);
  }
  return result as R & { error: null };
}
