"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "./LanguageSwitcher";

// Le panneau de navigation du header (2026-09-02, vague 4 — extrait de `SiteHeader` à la demande
// de Jérôme le même jour). Il porte une LISTE d'entrées de navigation, puis la langue en bas.
//
// ⚠️ CE N'EST PAS « LE MENU MOBILE ». C'est UN SEUL balisage qui se réorganise :
//
//   - sous `md` : replié, et déplié en liste verticale sous le header — chaque entrée est une
//     ligne pleine largeur avec son libellé écrit ;
//   - à partir de `md` : rendu en ligne dans la barre, chaque entrée devenant un bouton rond à
//     icône seule.
//
// Deux versions séparées auraient mis deux fois les mêmes liens dans le DOM : contenu dupliqué,
// deux fois les mêmes cibles pour un lecteur d'écran, et deux balisages qui divergent au premier
// ajout. C'est aussi ce qu'axe refuse (`landmark-no-duplicate-banner`, rencontré sur une story de
// ce lot).
//
// ⚠️ LE LIBELLÉ EST TOUJOURS DANS LE DOM, jamais conditionné ni supprimé : `md:sr-only` le masque
// à l'œil sur desktop mais le laisse dans l'arbre d'accessibilité, donc le bouton rond garde son
// nom. Un `md:hidden` l'aurait retiré des deux à la fois, et le lien desktop serait devenu muet.
//
// ⚠️ Et le panneau entier reste rendu même fermé (`hidden`), jamais `{ouvert && …}` : Google
// indexe la version MOBILE, et c'est par les liens de langue d'ici que la version anglaise est
// découverte. `SiteHeader.test.tsx` le prouve en rendu serveur.
export type SiteMenuProps = {
  /** Résolu côté serveur et passé de main en main : ce composant est client. */
  isAuthenticated: boolean;
  /** Déplié ou non. N'a d'effet que sous `md` — au-dessus, le panneau est toujours en ligne. */
  isOpen: boolean;
  /** `id` du panneau, pour l'`aria-controls` du bouton qui le commande. */
  id: string;
  testId?: string;
};

// L'architecture des pages de compte sera revue (décision de Jérôme, 2026-09-02) : une seule
// constante à changer ce jour-là. ⚠️ CHANGÉ le 2026-09-11 (spec 35, décision ⑧) : `/cuenta/perfil`
// est désormais l'accueil de la zone compte, pas `/cuenta/reservas` — qui reste atteignable depuis
// un lien sur cet écran.
//
// EXPORTÉES depuis le 2026-10-01 : le header TRANSPARENT de l'accueil (`SiteHeader`) rend le même
// lien de compte hors de ce panneau. Une seule définition de la route, de l'icône et du choix
// compte/connexion — deux copies divergeraient au prochain déménagement de la zone compte.
export const ROUTE_COMPTE = "/cuenta/perfil";
export const ROUTE_CONNEXION = "/entrar";

export function IconeCompte() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-5 shrink-0">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

/**
 * Une entrée de navigation. Volontairement locale à ce fichier plutôt qu'un atome partagé : sa
 * particularité — ligne pleine largeur en bas de `md`, bouton rond au-dessus — n'a de sens que
 * dans ce menu, et un atome qui n'existe qu'à un seul endroit est une abstraction en avance de
 * phase (même règle que `components/README.md` pour la remontée dans `packages/`).
 */
function EntreeDeNavigation({
  href,
  icon,
  children,
  testId,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <li className="md:contents">
      <Link
        href={href}
        // `min-h-11` : 44 px de cible tactile (components/README.md), comme toute la famille des
        // boutons. `md:size-11 md:justify-center md:rounded-full md:px-0` : la même ligne devient
        // le bouton rond attendu dans la barre.
        className="inline-flex min-h-11 w-full items-center gap-3 rounded-[var(--radius)] px-3 text-sm hover:bg-default focus-visible:status-focused md:size-11 md:w-11 md:justify-center md:rounded-full md:px-0"
        data-testid={testId}
      >
        <span aria-hidden="true" className="contents">
          {icon}
        </span>
        {/* Visible sur mobile, seulement à l'oreille sur desktop — voir l'en-tête. */}
        <span className="md:sr-only">{children}</span>
      </Link>
    </li>
  );
}

export function SiteMenu({ isAuthenticated, isOpen, id, testId }: SiteMenuProps) {
  const t = useTranslations("Chrome");

  return (
    <div
      id={id}
      className={`${
        isOpen ? "flex" : "hidden"
      } absolute inset-x-0 top-full flex-col gap-2 border-b border-[var(--border)] bg-[var(--background)] p-3 md:static md:flex md:flex-row md:items-center md:gap-1 md:border-0 md:bg-transparent md:p-0`}
      data-testid={testId}
    >
      {/* Une vraie liste : c'est ce qu'annonce un lecteur d'écran (« liste de N éléments »), et
          c'est ce qui donnera sa structure aux entrées suivantes. `md:contents` fait disparaître la
          liste de la mise en page sur desktop sans la retirer du DOM — les entrées deviennent
          alors des enfants directs de la barre. */}
      <ul className="flex flex-col gap-1 md:contents">
        <EntreeDeNavigation
          href={isAuthenticated ? ROUTE_COMPTE : ROUTE_CONNEXION}
          icon={<IconeCompte />}
          testId={testId ? `${testId}-account` : undefined}
        >
          {isAuthenticated ? t("accountLabel") : t("loginLabel")}
        </EntreeDeNavigation>
      </ul>

      {/* La langue EN BAS (demande de Jérôme), détachée de la liste par un filet — elle ne navigue
          pas vers une page du site, elle rejoue la page courante dans l'autre langue. Le filet
          n'existe que replié : en ligne, il couperait la barre en deux. */}
      <div className="border-t border-[var(--border)] pt-2 md:border-0 md:pt-0">
        <LanguageSwitcher testId={testId ? `${testId}-language` : undefined} />
      </div>
    </div>
  );
}
