import Image from "next/image";

// Le logo de la charte graphique Hifago 2026 (fournie par Jérôme le 2026-10-01).
//
// Remonté ici depuis `SiteHeader` le 2026-10-01 parce qu'il sert désormais DEUX endroits — la
// coquille publique et la zone auth, qui écrivait jusque-là « Hifago » en texte. C'est la règle de
// `.claude/rules/ui.md` : on ne remonte dans `components/` que ce qui sert au moins deux endroits.
// Un atome ne traduit rien, et celui-ci n'a effectivement aucun libellé : son nom accessible est
// porté par le lien qui l'enveloppe.
//
// La vitrine est claire uniquement depuis l'arbitrage D9. La variante automatique rend donc une
// seule image pour fond clair ; les surfaces or et marine choisissent explicitement leur
// déclinaison avec `sobre` et `sombre`.
//
// ⚠️ Le logo de la charte est POLYCHROME : il ne peut pas être teint par `currentColor` comme
// l'était le tracé provisoire qu'il remplace. Sa lisibilité sur fond sombre passe donc par un
// changement de DÉCLINAISON — ce que la charte prévoit elle-même, en présentant le mot-marque sur
// quatre fonds. Les autres déclinaisons sont dans `public/brand/`.
//
// `priority` plutôt que `loading="eager"` sur la variante automatique : c'est le logo, il est au-
// dessus de la ligne de flottaison, et `priority` pose en plus le préchargement. `width`/`height` sont les
// dimensions INTRINSÈQUES des WebP (déjà calibrés à 96 px de haut, ~7 Ko) ; la taille affichée
// vient de `hauteur`, et les deux ensemble réservent la place sans décaler l'en-tête (CLS).

type LogoHifagoProps = {
  /**
   * Hauteur de rendu, en classe Tailwind. ⚠️ Mesuré au rendu : le lockup de la charte empile
   * « hifa » sur « GO · Guatapé » (ratio 1.86:1 au dessin, presque carré), donc sous 48 px le mot « Guatapé »
   * tombe sous 3 px de haut et devient une tache. `h-12` est le minimum lisible — ne pas descendre
   * en dessous sans vérifier au rendu.
   */
  hauteur?: string;
  /**
   * `auto` (défaut) : marine + or sur fond clair. `sobre` : posé sur l'OR — le header de toutes
   * les pages depuis le plan 41 (item C1). `sombre` : posé sur le MARINE — le pied (item C2).
   */
  variante?: "auto" | "sobre" | "sombre";
};

export function LogoHifago({ hauteur = "h-12", variante = "auto" }: LogoHifagoProps) {
  if (variante === "sobre") {
    return (
      // ⚠️ LA DÉCLINAISON SANS OR (asset A1, `logo-horizontal-marine-bleu.png` de la charte) : le
      // « GO » or des deux autres disparaîtrait sur l'or. UNE seule image, sans classe de bascule :
      // la surface or n'a pas de mode sombre (arbitrage D9 = A), elle reste or et ce logo avec.
      //
      // ⚠️ Pas de `priority` ici, contrairement à la variante `auto` : sur une page intérieure, le
      // LCP est la première photo du contenu, et le plan n'autorise qu'UNE image `priority` par
      // page (§3.8). `loading="eager"` : le logo est au-dessus de la ligne de flottaison, il se
      // charge tout de suite, sans préchargement qui ferait concurrence au LCP.
      //
      // Rogné au contenu (179 × 96, ≈ 1.86:1), à la différence des deux autres qui gardent une
      // marge de 10 à 12 px : à `h-12`, le dessin occupe toute la hauteur.
      <Image
        src="/brand/logo-header-sur-or.webp"
        alt=""
        aria-hidden
        loading="eager"
        width={179}
        height={96}
        className={`w-auto ${hauteur}`}
      />
    );
  }

  if (variante === "sombre") {
    return (
      // Déclinaison explicite pour la surface marine, sans classe de bascule de thème.
      // Pas de `priority` : le pied est sous la ligne de flottaison, le chargement différé de
      // `next/image` est le bon.
      <Image
        src="/brand/logo-header-sombre.webp"
        alt=""
        aria-hidden
        width={158}
        height={96}
        className={`w-auto ${hauteur}`}
      />
    );
  }

  return (
    <Image
      src="/brand/logo-header-clair.webp"
      alt=""
      aria-hidden
      priority
      width={167}
      height={96}
      className={`w-auto ${hauteur}`}
    />
  );
}
