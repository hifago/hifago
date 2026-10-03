"use client";

import { Toast } from "@hifago/ui";

// Le seul point de montage des notifications toast de la vitrine (2026-09-02, vague 6).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. POURQUOI CE COMPOSANT EXISTE — un bug vivant, pas une amélioration
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ `Toast.Provider` n'était monté NULLE PART dans `apps/web`. Or
// `app/[locale]/verificar-email/ResendConfirmationForm.tsx:36,38` appelle déjà `toast.danger()` et
// `toast.success()` : ces deux notifications ne s'affichaient donc jamais, et l'écran « renvoyer
// l'email de confirmation » était muet — le bouton passe en compte à rebours, rien d'autre ne dit
// si l'envoi a réussi ou échoué.
//
// ⚠️ Ce fichier ne suffit pas à corriger ça : il faut encore le MONTER dans
// `app/[locale]/layout.tsx`, ce que ce lot ne fait pas (les pages sont hors périmètre). La ligne
// exacte est dans le rapport de livraison.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. CE QU'IL APPORTE PAR RAPPORT À UN `<Toast.Provider />` POSÉ NU
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ Il rend le piège de CLAUDE.md §11 point 9 impossible à rejouer, PAR LE TYPE. `Toast.Provider`
// n'est pas un provider React classique : son prop `children` est un render-prop consommé par
// Toast à l'intérieur de `UNSTABLE_ToastRegion` (react-aria-components), pas un slot pour le
// contenu de la page. Écrire `<Toast.Provider>{children}</Toast.Provider>` fait retourner `null`
// à toute la région — donc à toute l'app — tant qu'aucun toast n'existe. Page blanche totale,
// AUCUNE erreur console, AUCUNE exception, `npm run build` et `next start` sans un avertissement :
// le bug ne se voit que dans un vrai navigateur.
//
// `SiteToasterProps` ne déclare pas `children`, donc `<SiteToaster>{children}</SiteToaster>` ne
// compile pas. Le piège n'est plus une consigne à retenir, c'est une erreur de typage — même
// mécanisme que le `alt` obligatoire d'`Image` ou le `label` d'`IconButton`. `SiteToaster.test.tsx`
// tient cette garantie avec un `@ts-expect-error` : si le composant acceptait un jour des enfants,
// l'erreur attendue disparaîtrait et `tsc` échouerait sur la directive devenue inutile.
//
// Il fixe aussi le placement pour toute la vitrine, plutôt que de le laisser à l'appelant.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. LE PLACEMENT — `top`, et ce n'est PAS le `bottom` de l'admin
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Mesuré au navigateur à 390×844 sur la story `SurUnEcranReel` (header réel, formulaire à quatre
// champs, bouton principal en dernier), page défilée jusqu'en bas — c'est-à-dire dans l'état où
// l'utilisateur presse réellement le bouton. Pas déduit :
//
//   • `bottom` (le réglage de l'admin) — le toast occupe 358×64 px en y=764…828. Le bouton
//     principal est en y=749…793. Il en RECOUVRE 29 px sur 44, et surtout :
//     `document.elementFromPoint` au CENTRE du bouton renvoie le toast, pas le bouton. Pendant
//     ses 4 secondes, le seul retour visuel de l'action rend l'action elle-même incliquable —
//     alors que c'est précisément le bouton qu'il faut represser quand le toast annonce un échec.
//     Seule une bande de 4 px en haut du bouton reste atteignable.
//   • `top` (retenu) — le même toast se pose en y=16…80 et recouvre 45 px des 61 px du
//     `SiteHeader` (collant : logo, panier, menu). Les trois points du bouton principal (haut,
//     centre, bas) renvoient tous le bouton : aucune action n'est masquée ni interceptée. Personne
//     n'interagit avec l'en-tête à l'instant où une opération se termine, et le toast s'efface en
//     4 s.
//
// ⚠️ À 1280 px les deux placements se valent (aucun recouvrement dans les deux cas) : le conflit
// n'existe QUE sur mobile. C'est la définition même de la règle « mobile d'abord » de
// components/README.md — le gabarit qui tranche est celui où ça casse.
//
// L'admin a choisi `bottom` sans ce conflit : ses écrans sont des formulaires longs dans un
// gabarit avec navigation latérale, pas des tunnels de réservation courts. Recopier sa valeur
// aurait été hériter d'un défaut, pas d'une décision.
//
// ⚠️ Conséquence assumée : sur la fiche produit, un toast déclenché juste après « ajouter au
// panier » recouvre brièvement la pastille du panier. Le compromis penche quand même de ce côté —
// un compteur caché 4 s est réparable d'un coup d'œil, un bouton d'envoi masqué ne l'est pas.
//
// ⚠️ Corollaire du choix `top` : AUCUNE règle CSS de zone sûre n'est nécessaire. Celle de la spec
// 16 vise `.toast-region--bottom*`, et elle n'a de sens que parce que `apps/admin/app/layout.tsx`
// déclare `viewportFit: "cover"` — `apps/web` ne le déclare pas, son viewport est donc déjà inscrit
// dans la zone sûre. Détaillé dans le rapport ; `packages/ui/src/styles/globals.css` n'est pas
// touché.
//
// `"use client"` obligatoire : ce fichier importe le barrel `@hifago/ui` (CLAUDE.md §11.16).

export type SiteToasterProps = {
  /**
   * ⚠️ La seule prop, et c'est délibéré : tout ce qui n'est pas déclaré ici — `children` en
   * premier — devient une erreur de compilation. Voir §2 de l'en-tête.
   */
  testId?: string;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. L'HABILLAGE (plan 41, item C4, 2026-10-02)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Surface blanche, bordure marine de 1 px, rayon de 12 px, une icône par ton. Mesuré avant :
// fond blanc, 12 px et icônes étaient déjà ceux de HeroUI (`.toast`, `ToastIndicator`) — il
// manquait la BORDURE, sans laquelle le toast ne tenait que par son ombre sur la page claire.
// `--border` est marine sur le clair, et la région est portée au bout du <body> : elle lit donc
// toujours les jetons du clair, même au-dessus du header or. Le rayon est écrit en valeur fixe
// (§3.4 du plan : l'échelle `rounded-*` dérive de `--radius`), pour ne plus en dépendre.
//
// Posé par la `className` de la RÉGION, qui vise ses toasts (`[&_.toast]`) : `Toast.Provider` la
// transmet, et ces utilitaires battent `.toast` (couche `components`). Aucune règle globale.
//
// Les barres d'action collantes du bas (D10, D11 : fiche, Mi viaje, Pago) ne sont jamais
// recouvertes : la région est en HAUT (§3) — rien à décaler quand elles arriveront (P3, P5, P6).
const HABILLAGE_TOASTS = "[&_.toast]:rounded-[12px] [&_.toast]:border [&_.toast]:border-[var(--border)] [&_.toast]:bg-surface";

export function SiteToaster({ testId }: SiteToasterProps) {
  // `placement` explicite plutôt qu'implicite : le défaut de HeroUI est `bottom`, donc l'omettre
  // rendrait la décision du §3 invisible ET fausse.
  return <Toast.Provider placement="top" className={HABILLAGE_TOASTS} data-testid={testId} />;
}
