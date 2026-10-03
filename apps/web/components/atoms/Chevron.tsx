// Le petit chevron rotatif d'un déclencheur ouvrant/fermant un panneau (`LanguageSwitcher`) —
// extrait le 2026-09-15 : la même forme existait EN DOUBLE (une copie par composant), et
// `SelectorTipo` en aurait fait une 3e. `components/README.md` : on ne remonte dans `components/`
// que ce qui sert au moins deux endroits — condition remplie dès la 2e copie.
//
// ⚠️ Depuis le 2026-10-01, `LanguageSwitcher` est son SEUL consommateur : `SelectorTipo` a été
// supprimé avec la maquette de l'accueil (remplacé par `MenuTiposPortada`, qui ne replie rien), et
// le chevron statique de `DateRangeField` a disparu avec le restylage de « Fechas / Personas ». Laissé
// ici plutôt que rapatrié : un atome stable, testé, que rien ne pousse à déplacer.
export type ChevronProps = {
  ouvert: boolean;
  testId?: string;
};

export function Chevron({ ouvert, testId }: ChevronProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`size-4 shrink-0 transition-transform ${ouvert ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      data-testid={testId}
    >
      <path d="M3.5 6l4.5 4.5L12.5 6" />
    </svg>
  );
}
