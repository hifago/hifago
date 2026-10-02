import Image from "next/image";

// Le logo de la charte graphique Hifago 2026 (fournie par Jérôme le 2026-10-01).
//
// Remonté ici depuis `SiteHeader` le 2026-10-01 parce qu'il sert désormais DEUX endroits — la
// coquille publique et la zone auth, qui écrivait jusque-là « Hifago » en texte. C'est la règle de
// `.claude/rules/ui.md` : on ne remonte dans `components/` que ce qui sert au moins deux endroits.
// Un atome ne traduit rien, et celui-ci n'a effectivement aucun libellé : son nom accessible est
// porté par le lien qui l'enveloppe.
//
// ⚠️ DEUX <img>, basculées par CSS, et pas un `<picture media="(prefers-color-scheme: dark)">` :
// la première version faisait ça, et le rendu l'a démentie. `<picture>` ne connaît que la
// préférence SYSTÈME, alors que le thème suit `color-scheme` + le forçage `data-mode` — en mode
// sombre forcé sur une machine en clair, la page passait au marine en gardant le logo marine
// dessus, illisible. Les classes `logo-clair`/`logo-sombre` sont stylées dans
// `packages/ui/src/styles/globals.css`, qui rejoue exactement la cascade du thème.
//
// ⚠️ Le logo de la charte est POLYCHROME : il ne peut pas être teint par `currentColor` comme
// l'était le tracé provisoire qu'il remplace. Sa lisibilité sur fond sombre passe donc par un
// changement de DÉCLINAISON — ce que la charte prévoit elle-même, en présentant le mot-marque sur
// quatre fonds. Les autres déclinaisons sont dans `public/brand/`.
//
// `next/image` malgré deux fichiers : `className` voyage jusqu'à la balise rendue, donc la bascule
// CSS fonctionne telle quelle — une première version utilisait `<img>` nu en affirmant l'inverse,
// c'était faux. `priority` plutôt que `loading="eager"` : c'est le logo, il est au-dessus de la
// ligne de flottaison, et `priority` pose en plus le préchargement. `width`/`height` sont les
// dimensions INTRINSÈQUES des WebP (déjà calibrés à 96 px de haut, ~7 Ko) ; la taille affichée
// vient de `hauteur`, et les deux ensemble réservent la place sans décaler l'en-tête (CLS).

type LogoHifagoProps = {
  /**
   * Hauteur de rendu, en classe Tailwind. ⚠️ Mesuré au rendu : le lockup de la charte empile
   * « hifa » sur « GO · Guatapé » (ratio 1.74:1, presque carré), donc sous 48 px le mot « Guatapé »
   * tombe sous 3 px de haut et devient une tache. `h-12` est le minimum lisible — ne pas descendre
   * en dessous sans vérifier au rendu.
   */
  hauteur?: string;
};

export function LogoHifago({ hauteur = "h-12" }: LogoHifagoProps) {
  return (
    <>
      <Image
        src="/brand/logo-header-clair.webp"
        alt=""
        aria-hidden
        priority
        width={167}
        height={96}
        className={`logo-clair w-auto ${hauteur}`}
      />
      <Image
        src="/brand/logo-header-sombre.webp"
        alt=""
        aria-hidden
        priority
        width={158}
        height={96}
        className={`logo-sombre w-auto ${hauteur}`}
      />
      {/* ⚠️ Il n'y a plus de troisième déclinaison « sur or » : la seule page posée sur l'or
          (l'accueil) a un header transparent SANS logo depuis la maquette du 2026-10-01 — le grand
          logo du héros (`PortadaInicio`) y tient ce rôle. */}
    </>
  );
}
