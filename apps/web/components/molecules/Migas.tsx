"use client";

import { Breadcrumbs } from "@hifago/ui";
import type { Locale } from "@/messages";

// Le fil d'Ariane des pages de listing et de catégorie (2026-09-08, spec 29 §5a — décision 13).
//
// ⚠️ POURQUOI IL EXISTE. Un visiteur qui arrive par un moteur sur `/es/actividades/kayak` est dans
// un cul-de-sac : rien sur la page ne lui dit qu'il existe d'autres catégories, ni où il se trouve.
// Le menu du site et le bouton « précédent » ne remplacent pas ça — le second suppose qu'il vient
// d'ailleurs sur le site, ce qui est faux par construction pour une arrivée depuis Google.
//
// ⚠️ `"use client"` est imposé par l'import de `@hifago/ui` : le barrel tire tout son graphe et
// fait planter `next build` dès qu'il atteint un Server Component (CLAUDE.md §11.16). Ça ne coûte
// RIEN au référencement — un composant client est quand même pré-rendu en HTML par Next, donc le
// fil est bien dans la page servie au crawler. Le seul coût réel est l'hydratation, marginale pour
// trois liens.
//
// ⚠️ ET IL NE POSE PAS SON PROPRE JSON-LD. Le nœud `BreadcrumbList` est rendu par la PAGE
// (`buildBreadcrumbJsonLd`, déjà utilisé par les deux fiches), côté serveur : règle SEO 6 du dépôt
// — le JSON-LD se décrit dans `page.tsx`, jamais dans un composant de présentation. Ce composant
// affiche ; la page décrit. Les deux disent la même chose, et c'est la page qui garantit qu'ils ne
// divergent pas, puisqu'elle construit les deux depuis la même liste.

export type MigaItem = {
  /** Déjà traduit, ou déjà résolu depuis le contenu partenaire — une molécule ne traduit rien. */
  nombre: string;
  /**
   * Chemin SANS préfixe de langue (`/actividades`). Absent sur le DERNIER élément : la page
   * courante n'est pas un lien vers elle-même.
   */
  href?: string;
};

// ⚠️ Constaté au rendu (2026-09-08) et laissé tel quel : HeroUI rend le DERNIER élément en
// `<span role="link" aria-disabled="true" aria-current="page">`. Le `aria-current` est correct et
// posé tout seul — c'est ce qui compte. Le `role="link"` sur la page courante est discutable (un
// lecteur d'écran annoncera « lien désactivé »), mais c'est le comportement du design system : on
// le documente, on ne le contourne pas avec un composant parallèle.

// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE STYLE DU FIL (plan 41, item C3) — et la fin du débordement à 390 px
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ LE DÉFAUT CORRIGÉ, mesuré au navigateur le 2026-10-02 : HeroUI pose `shrink-0` sur chaque
// élément et le fil n'avait aucun retour à la ligne. Un nom de fiche ou de catégorie un peu long
// (contenu partenaire) poussait la page à 551, 803 et 407 px de large sur trois fiches, pour 390 px
// d'écran — le premier défaut connu du plan (T12). D'où :
//   - le retour à la ligne de la liste, 4 px entre deux lignes ;
//   - des éléments qui rétrécissent (`shrink min-w-0`), et dont le texte passe à la ligne ;
//   - SOUS `sm`, les niveaux intermédiaires tronqués à environ 14 caractères (ellipse) ;
//   - le dernier niveau sur deux lignes au plus. Le texte reste entier dans le DOM, donc dans le
//     nom accessible : seul l'affichage raccourcit — et le JSON-LD, construit par la page depuis la
//     même liste, ne change pas (règle SEO 6).
//
// COULEURS, toutes lues sur la SURFACE (F3), jamais écrites : le fil sera posé sur le bandeau or des
// pages intérieures (S2), et il est encore sur le clair d'ici là.
//   - liens : `--link` (marine sur l'or, bleu moyen sur le clair), soulignés au survol et au focus ;
//   - page courante : `--foreground` en 600 (marine sur les deux), sans lien (`aria-current`) ;
//   - séparateurs : `--foreground` à 60 %, décoratifs.
// Typographie : le rôle `meta` (Poppins 500, 14 px), celle que pose déjà HeroUI.
//
// MÉCANISME : des variantes arbitraires posées sur NOTRE `<nav>`, qui visent le balisage de HeroUI
// (`li`, `a`, `[aria-current]`, `svg`) sans le réécrire — même principe que l'axe couleur de
// `Button.tsx`. Elles vivent dans la couche `utilities` de Tailwind, et battent les classes
// `.breadcrumbs__…` de HeroUI (couche `components`) quelle que soit leur spécificité.
//
// ⚠️ Chaînes écrites en toutes lettres : Tailwind lit ce fichier comme du texte.
const STYLE_FIL =
  "[&_ol]:flex-wrap [&_ol]:gap-y-1 [&_li]:min-w-0 [&_li]:shrink [&_a]:text-[var(--link)] [&_a]:underline-offset-4 [&_a:hover]:underline [&_a:focus-visible]:underline [&_[aria-current=page]]:font-semibold [&_[aria-current=page]]:text-foreground [&_svg]:text-[color-mix(in_oklab,var(--foreground)_60%,transparent)]";

// Un niveau INTERMÉDIAIRE (ni le premier, ni le dernier) : tronqué sous `sm`. Le lien est l'enfant
// direct de l'élément de liste que rend HeroUI. ⚠️ `block` : le lien de HeroUI est un `inline-flex`,
// et `text-overflow` ne s'applique pas au texte d'un conteneur flex — vu au rendu, le nom était
// coupé net au milieu d'une lettre, sans ellipse.
const NIVEAU_INTERMEDIAIRE = "max-sm:[&>a]:block max-sm:[&>a]:max-w-[14ch] max-sm:[&>a]:truncate";

// Le DERNIER niveau, la page courante : deux lignes au plus. `break-words` : un mot plus long que
// la ligne (une URL, un nom composé) passe quand même à la ligne au lieu de déborder.
const NIVEAU_COURANT = "[&>[aria-current=page]]:line-clamp-2 [&>[aria-current=page]]:break-words";

export type MigasProps = {
  items: MigaItem[];
  /** Le nom accessible du `<nav>` — déjà traduit. Un repère de navigation sans nom n'en est pas un. */
  etiqueta: string;
  /** ⚠️ Sert à préfixer les `href` à la main — voir ci-dessous. */
  locale: Locale;
  testId?: string;
};

export function Migas({ items, etiqueta, locale, testId }: MigasProps) {
  return (
    // ⚠️ LE `<nav>` EST À NOUS, ET IL EST OBLIGATOIRE. Vérifié au rendu réel le 2026-09-08 :
    // `Breadcrumbs` de HeroUI rend un `<ol>` NU, pas un repère de navigation — et un `<ol>` porteur
    // d'un `aria-label` n'est pas un landmark ARIA. Sans cette enveloppe, le fil d'Ariane
    // disparaîtrait de la liste des repères de la page pour un lecteur d'écran, alors que c'est
    // exactement le public pour qui « où suis-je » compte le plus. Règle SEO 7 du dépôt : les
    // landmarks sont du HTML, pas une option de composant.
    //
    // Ce n'est pas un second design system : c'est l'élément sémantique que le motif WAI-ARIA
    // exige autour d'un fil d'Ariane. Le style est celui de HeroUI, recoloré par la surface
    // (`STYLE_FIL`, plus haut).
    <nav aria-label={etiqueta} className={STYLE_FIL} data-testid={testId}>
      <Breadcrumbs>
        {items.map((item, rang) => (
          <Breadcrumbs.Item
            // Le chemin est unique dans un fil d'Ariane ; le dernier élément n'en a pas, mais il
            // est seul dans ce cas — son nom suffit à le distinguer.
            key={item.href ?? item.nombre}
            className={
              rang === items.length - 1 ? NIVEAU_COURANT : rang > 0 ? NIVEAU_INTERMEDIAIRE : undefined
            }
            // ⚠️ LE PRÉFIXE DE LANGUE EST POSÉ À LA MAIN, et ce n'est pas un oubli du `Link`
            // localisé. `Breadcrumbs.Item` rend un `<a href>` NATIF (il étend `LinkProps` de
            // react-aria), pas le `Link` de `@/i18n/navigation` : sans ce préfixe, chaque lien
            // partirait sur une URL sans langue que le proxy devrait rattraper par une redirection
            // qui redevine la locale depuis un cookie — au lieu de garder celle de la page lue.
            // Rien ne casse visiblement, et c'est exactement le problème. Même contrainte et même
            // solution que les options de `SearchBar` (spec 28 §10ter).
            href={item.href ? `/${locale}${item.href}` : undefined}
          >
            {item.nombre}
          </Breadcrumbs.Item>
        ))}
      </Breadcrumbs>
    </nav>
  );
}
