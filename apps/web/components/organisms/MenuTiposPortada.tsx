import { Link } from "@/i18n/navigation";
import type { TipoOferta } from "@/lib/catalog/tipos";

// LA NAVIGATION PAR TYPE DE LA MARQUE — « Actividades • Alojamiento • Transporte • Retiros •
// Eventos ». Née dans le héros de l'accueil, elle est remontée ici pour être réutilisée par la 404
// (plan 41, P11 ; arbitrage D13 de Jérôme, 2026-10-02). Les deux écrans servent ainsi exactement
// les mêmes cinq liens, avec la même typographie et le même comportement responsive.
//
// ⚠️ ELLE PASSE À LA LIGNE, ELLE NE REPLIE RIEN. À 390 px les cinq types tiennent sur deux lignes :
// c'est la seule façon de garder le texte lisible sans masquer de contenu. Plus aucune mesure, donc
// plus de JavaScript : composant serveur, liens servis en HTML.
//
// ⚠️ Les `href` arrivent déjà construits. Sur l'accueil ils conservent les critères de recherche ;
// sur la 404 ils pointent vers les cinq portes d'entrée du catalogue.
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
      {/* Taille proportionnelle à la colonne (`cqw`, posé par les deux hôtes) : 3,35 % de la
          colonne, bornée à 16 px (texte courant) et 28 px. */}
      <ul className="flex flex-wrap items-center gap-x-[0.45em] text-[clamp(1rem,3.35cqw,1.75rem)] leading-tight">
        {tipos.map(({ tipo, label, href }, indice) => (
          <li key={tipo} className="flex items-center gap-x-[0.45em]">
            {/* Le point est décoratif. Il appartient à l'élément suivant afin qu'une ligne qui se
                coupe commence par lui, au lieu de laisser un point orphelin en fin de ligne. */}
            {indice > 0 ? (
              <span aria-hidden="true" className="size-[0.2em] shrink-0 rounded-full bg-current" />
            ) : null}
            {/* Exception mobile décidée pour l'accueil le 2026-10-02 : 34 px rapproche ses deux
                lignes, tout en restant au-dessus du minimum WCAG 2.5.8 de 24 px. */}
            <Link
              href={href}
              className="inline-flex min-h-[34px] items-center rounded-[var(--radius)] underline-offset-4 hover:underline focus-visible:status-focused md:min-h-11"
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
