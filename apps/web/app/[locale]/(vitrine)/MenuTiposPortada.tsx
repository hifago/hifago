import { Link } from "@/i18n/navigation";
import type { TipoOferta } from "@/lib/catalog/tipos";

// LA NAVIGATION PAR TYPE DU HÉROS DE L'ACCUEIL — « Actividades • Alojamiento • Transporte •
// Retiros • Eventos » (maquette de Jérôme, 2026-10-01). Elle remplace `SelectorTipo` sur l'accueil,
// son seul écran : du texte en Poppins, marine sur l'or, séparé par des points.
//
// ⚠️ ELLE PASSE À LA LIGNE, ELLE NE REPLIE RIEN. `SelectorTipo` mesurait la rangée pour cacher
// derrière un bouton « Más » ce qui ne tenait pas ; la maquette montre les cinq types, toujours.
// À 390 px ils tiennent sur deux lignes : c'est la seule façon de garder le texte lisible (16 px)
// SANS rien masquer — ce que `.claude/rules/ui.md` interdit de toute façon (Google indexe le
// mobile). Plus aucune mesure, donc plus de JavaScript : composant serveur, liens servis en HTML.
//
// ⚠️ Les liens portent les critères de recherche actifs (`href` construit par `tiposDeBarra.ts`) :
// le bug du 2026-09-16 (« en changeant de page les filtres s'enlèvent ») reste fermé.
export type MenuTiposPortadaProps = {
  /** Les cinq types, dans l'ordre d'affichage — libellés déjà traduits, `href` déjà construits. */
  tipos: { tipo: TipoOferta; label: string; href: string }[];
  /** Nom accessible du `<nav>`, déjà traduit. */
  etiqueta: string;
  testId?: string;
};

export function MenuTiposPortada({ tipos, etiqueta, testId }: MenuTiposPortadaProps) {
  return (
    <nav aria-label={etiqueta} data-testid={testId}>
      {/* Taille proportionnelle à la colonne (`cqw`, posé par le héros) : 3,35 % de la colonne, celle de
          la maquette — bornée à 16 px (texte courant, `.claude/rules/ui.md`) et à 28 px. */}
      <ul className="flex flex-wrap items-center gap-x-[0.45em] text-[clamp(1rem,3.35cqw,1.75rem)] leading-tight">
        {tipos.map(({ tipo, label, href }, indice) => (
          <li key={tipo} className="flex items-center gap-x-[0.45em]">
            {/* Le point qui sépare deux types : décoratif, donc hors de l'arbre d'accessibilité —
                un lecteur d'écran annonce déjà « liste, 5 éléments ». Porté par l'élément SUIVANT,
                jamais par le précédent : une ligne qui se coupe commence par un point plutôt que de
                laisser un point orphelin en fin de ligne. */}
            {indice > 0 ? (
              <span aria-hidden="true" className="size-[0.2em] shrink-0 rounded-full bg-current" />
            ) : null}
            {/* `md:min-h-11` : 44 px de cible tactile, sans changer l'apparence d'une ligne de texte.
                ⚠️ EXCEPTION SOUS `md` : 34 px (Jérôme, 2026-10-02 : « réduis l'espace entre les deux
                lignes du menu », 15 px demandés, ramenés à 10 après rappel de la règle des 44 px de
                `.claude/rules/ui.md`). La hauteur du lien EST l'interligne du menu : les deux lignes
                sont collées, sans `gap-y`, donc les rapprocher, c'est réduire la cible. 34 px reste
                au-dessus du minimum WCAG 2.5.8 (24 px). Compensé dans `PortadaInicio` (marges du
                menu) pour que la recherche ne bouge pas. */}
            <Link
              href={href}
              className="inline-flex min-h-[34px] items-center md:min-h-11 rounded-[var(--radius)] underline-offset-4 hover:underline focus-visible:status-focused"
              data-testid={testId ? `${testId}-${tipo}` : undefined}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
