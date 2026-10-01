---
paths:
  - "**/apps/**/*.tsx"
---

# Règles des apps Next.js (RSC, i18n, formulaires) — chargées quand on touche un `.tsx`

Le SEO de la vitrine a sa propre règle (`seo.md`, `apps/web/**`) ; le design system la sienne
(`ui.md`). Règle d'échappement : au-delà de 100 lignes, le piège le plus ancien part au journal.

## i18n — deux couches, une frontière

1. Libellés d'interface (next-intl, ES/EN routés, jeu fermé — `apps/web` seulement ; `apps/admin`
   n'a pas next-intl : texte en dur en espagnol, `/partner/join` en français est une exception
   isolée à ne pas propager) ≠ contenu partenaire (colonnes JSONB par champ, langues illimitées,
   repli obligatoire). Jamais confondus.
2. **Un traducteur next-intl ne traverse pas la frontière RSC** : un composant client appelle
   `useTranslations()` lui-même ; un composant qui reçoit ses données d'un Server Component reçoit
   des **chaînes déjà résolues** en props. Un atome ne traduit rien — il reçoit son libellé.
3. Messages d'`apps/web` : **un fichier par namespace et par locale**
   (`messages/<locale>/<Namespace>.json`), agrégés par `messages/index.ts`. Toute clé existe en
   **es ET en** ; `messages/parity.test.ts` échoue sinon (et attrape un namespace non branché).
   Il ne vérifie PAS les chaînes en dur, qui restent tenues par la relecture.
4. Tout lien interne passe par le `Link` de `@/i18n/navigation` — jamais `next/link` nu ni
   `<a href>` : lui seul conserve le préfixe de locale.

## Frontière Server / Client Component — les pièges qui ne se voient qu'au build ou en navigateur

- **Ne jamais `import … from "@hifago/ui"` dans un `page.tsx`/`layout.tsx` (Server Component)**,
  quel que soit l'import : le barrel tire tout son graphe (`createContext is not a function` à
  `next build`, « Collecting page data », invisible au typecheck, au lint et en dev). Toujours
  passer par un fichier `"use client"` dédié — même pour `SimpleTable`. **Par transitivité**, un
  composant sans `"use client"` importé par un Server Component fait entrer le barrel dans le même
  graphe : soit il n'importe rien de `@hifago/ui` (ni `cn`), soit il porte `"use client"`.
- Un fichier qui **construit** un graphique Recharts (`<LineChart …>`) porte `"use client"`
  lui-même — pas seulement son wrapper. L'erreur ne se déclenche qu'à l'exécution de la route.
- `Table.Body`/`Table.Content` HeroUI n'acceptent jamais `items=`/`renderEmptyState=`/children en
  fonction depuis un Server Component (non sérialisable). Deux idiomes seulement : données déjà
  sérialisées passées à un sous-composant `"use client"`, ou enfants JSX statiques (`.map()`) —
  jamais les deux dans le même fichier.
- Un module importé par un Server Component ne porte pas `"use client"` s'il n'en a pas besoin
  (`productTypeGating` importé depuis un fichier client cassait en 500 l'édition de tout produit).
- **`Toast.Provider` HeroUI se monte en SIBLING de `{children}`, jamais en wrapper** : son
  `children` est un render-prop consommé par toast ; en wrapper, toute l'app rend `null` tant
  qu'aucun toast n'existe — page blanche, aucune erreur, build vert.
- **Pas de `loading.tsx` au-dessus d'un segment qui lit Supabase** : sa `<Suspense>` streamerait une
  erreur levée en 200 au lieu de 500 + noindex (vérifié par `scripts/check-supabase-errors.sh`).
- Les appels LobbyPMS ne partent jamais d'un `page.tsx`/Server Component (rendu SSR bloqué) : un
  Route Handler public appelé depuis le composant client (`LodgingReservationForm.tsx`).

## Formulaires et états

- Poser `noValidate` sur tout `<form>` qui contient un champ requis : sinon la validation native du
  navigateur bloque la soumission AVANT `onSubmit` — ni message inline ni toast, invisible au
  typecheck/build, seul un clic réel le révèle. La validation JS prend alors le relais.
- Un état qui bascule l'écran (`pendingOrderId`, « commande confirmée ») se pose APRÈS l'appel qui
  le justifie, jamais avant — le laisser au-dessus rend le reste décoratif. Un paiement qui échoue
  APRÈS une réservation réussie garde la réservation et propose « Reintentar pago », jamais un
  retour silencieux au panier.

## Ce qui est normal

- `apps/admin` en texte espagnol en dur (pas de next-intl) — voulu.
- Un contenu JSONB dans une langue non routée (ex. `pt`) — c'est le repli, pas une fiche mal
  traduite.
