# Composants de la vitrine (`apps/web`)

Conventions du design system de la vitrine publique. **Elles n'existaient nulle part avant le
2026-09-01** — elles sont relevées du code déjà écrit, pas inventées. Quand une règle contredit un
fichier existant, c'est le fichier qui a tort ; quand ce document contredit `hifago/CLAUDE.md`,
c'est CLAUDE.md qui fait foi.

## Où va quoi

| Dossier | Contenu | Exemple |
|---|---|---|
| `atoms/` | Brique indivisible, sans logique métier, **ne traduit rien** | `Price`, `PuceEstado`, `EnlaceGo` |
| `molecules/` | Composition de plusieurs atomes, liée à un écran | `TituloRubrica`, `Aviso`, `TeselaOferta` |
| `organisms/` | Bloc autonome, souvent avec état ou navigation | `SiteHeader`, `BandeauPagina`, `SeccionRiel` |
| `seo/` | Pas de l'interface : données structurées | `JsonLd` |
| `playground/` | Stories de référence (jetons, palettes, sémantique) | `Palette.stories.tsx` |
| `parcours/` | Stories de PARCOURS : une suite d'écrans réutilisés, une story par étape | `ReservarActividad.stories.tsx` |

Un composant lié à **une seule route** reste colocalisé dans `app/[locale]/…` — c'est déjà le cas
des treize composants d'écran actuels. On ne remonte dans `components/` que ce qui sert **au moins
deux endroits**, jamais par anticipation (même esprit que `CLAUDE.md` §2.1 pour `packages/`).

⚠️ **Pas de `index.ts` de réexport (barrel).** Chaque composant s'importe par son chemin :
`import { Price } from "@/components/atoms/Price"`. Un barrel serait le fichier que tous les agents
éditeraient en même temps à chaque ajout — voir « Travailler à plusieurs » plus bas.

## Nommage

**PascalCase** pour le fichier et le composant : `ProductCard.tsx` → `ProductCard`.

*Le dépôt contient deux conventions historiques (`packages/ui` et `apps/admin/components` sont
majoritairement en kebab-case). `apps/web` est à 100 % PascalCase : y introduire du kebab créerait
une troisième convention dans la même app.*

Test colocalisé : `ProductCard.test.tsx`. Story colocalisée : `ProductCard.stories.tsx`.

## Anatomie d'un composant

```tsx
// Pourquoi ce composant existe, et quelle décision il applique (avec sa date).
export type PriceProps = {
  amountCop: number;
  /** Libellé déjà traduit — un atome ne traduit jamais lui-même. */
  suffix?: string;
  testId?: string;
};

export function Price({ amountCop, suffix, testId }: PriceProps) { … }
```

- `export function` nommé — **jamais** `export default`.
- Type de props **nommé et exporté**, `XxxProps`.
- **Pas de prop `className`.** Zéro composant du dépôt n'en expose : la composition passe par des
  props sémantiques (`variant`, `footer: ReactNode`, `renderSlide`), pas par override de classe.
  Un composant qui « aurait besoin » de `className` est presque toujours un composant trop rigide.
- Pas de `forwardRef`, pas de `React.FC`, pas de `displayName` — aucun n'existe dans ce dépôt.
- `testId?: string` → `data-testid={testId}`. Sur un composite, préfixer les enfants :
  `` data-testid={`${testId}-action`} ``.
- Commentaire d'en-tête qui dit **pourquoi**, daté, avec renvoi à la spec ou à la décision.
- `cn` s'importe de `@hifago/ui`. ⚠️ **Ne jamais écrire de `tv()` à la main** : dans ce projet les
  variantes ne sont pas des compositions Tailwind mais des classes BEM (`button--outline`) stylées
  par les tokens `[data-theme]`. `buttonVariants` de HeroUI en est le seul exemple.
- ⚠️ **La règle RSC/barrel de `.claude/rules/apps.md` (`CLAUDE.md` §11.16) s'applique par
  TRANSITIVITÉ, et c'est ce qui décide de la forme d'un composant** : un composant sans
  `"use client"` importé PAR un Server Component fait entrer le barrel `@hifago/ui` dans le même
  graphe de modules (`next build` cassé, invisible au typecheck et au lint). Deux formes valides,
  jamais autre chose : (1) **n'importer rien de `@hifago/ui`**, ni `cn` — suffisant dès que les
  variantes sont des chaînes de classes fixes, le cas de cinq des six atomes ; (2) **porter
  `"use client"` en tête**, quand le composant a réellement besoin d'une primitive HeroUI
  (`TypeBadge`, qui s'appuie sur `Chip`). Corollaire : n'importe `cn` que si tu as vraiment des
  classes à fusionner (constaté le 2026-09-01, les deux agents de la vague 1 y étant arrivés
  séparément).
- Au-delà de ~150 lignes, on découpe.

## SEO — la sémantique est une décision de composant

Les règles sont dans `.claude/rules/seo.md` (point 7 : un seul `<h1>`, un titre reçoit son niveau
en prop, landmarks dans la coquille, `next/image` avec `alt` requis et `sizes`, JSON-LD dans
`page.tsx`, rien d'indexable masqué) et `.claude/rules/apps.md` (tout lien interne passe par le
`Link` de `@/i18n/navigation`, jamais `next/link` nu ni `<a href>`) — chargées dès qu'un fichier
d'`apps/web` est ouvert. Ce README ne les recopie pas.

## Traductions

Les règles i18n (frontière RSC, un fichier par namespace et par locale, parité es/en vérifiée par
`messages/parity.test.ts`) sont dans `.claude/rules/apps.md`. Ce qui est propre aux composants :
**aucune chaîne ES/EN en dur** ; **un atome ne traduit rien** — il reçoit son libellé, seuls
molecules et organisms appellent `useTranslations` (c'est pourquoi `ProductDetailView` reçoit
`backToCatalogLabel`, pas un `t`) ; un nouveau namespace doit être branché dans
`messages/index.ts` (le test le vérifie aussi).

## Lisibilité et accessibilité

- Le panneau **a11y** de Storybook ne doit remonter aucune violation critique.
- Texte courant jamais sous 16 px sur mobile ; longueur de ligne bornée (~75 caractères).
- L'information n'est **jamais portée par la seule couleur** : un statut a un mot, pas qu'une
  pastille.
- Cible tactile ≥ 44 px. Le focus clavier reste visible — ne jamais retirer l'anneau de focus sans
  le remplacer.

## Responsive — mobile d'abord

Les règles (classes de base = mobile, rien de masqué selon la largeur, reflow en cartes sous `md`,
aucune largeur en dur, pas de défilement horizontal de page, `overflow-x-auto` seul = violation
WCAG 2.1.1 sauf `tabIndex={0}` + `role="region"` + `aria-label` quand rien n'est focalisable,
viewports 390×844 et 1280×900) sont dans `.claude/rules/ui.md`, chargée dès qu'un fichier de
`components/` est ouvert. Constaté le 2026-09-01 en montant les atomes : la moitié accessibilité de
la règle manquait ici, et tout reflow de liste dense l'aurait reproduit — d'où une seule source.

## Stories

Chaque composant a au minimum `Defaut`, plus les **états limites** qui le concernent : `Vide`,
`Chargement`, `Erreur`, `TexteLong`, `SansImage`. Ce sont eux qui cassent en production.

```tsx
const meta = { title: "Affichage/Price", component: Price } satisfies Meta<typeof Price>;
export default meta;
export const Defaut: StoryObj<typeof meta> = { args: { amountCop: 80000 } };
```

### ⚠️ Le `title` ne suit PAS le dossier

Le dossier dit ce qui est composable (`atoms` / `molecules` / `organisms`) ; le `title` sert à
**trouver** un composant dans la barre latérale. Ce ne sont pas le même besoin, et les faire
coïncider donnait quatorze entrées à plat où l'on cherchait un bouton entre un gabarit de page et
un prix. Cinq groupes, décidés le 2026-09-02 :

| Groupe | Contenu |
|---|---|
| `Actions/` | `Button`, `IconButton`, `LinkButton`, `IconLink`, `BackLink`, `EnlaceGo` |
| `Saisie/` | `Field`, `Textarea`, `Select`, `Checkbox` |
| `Affichage/` | `Price`, `TypeBadge`, `Image`, `Title`, `PhotoStrip`, `CartSummary`, `TituloRubrica`, `PuceEstado`, `Aviso`, `TeselaOferta` |
| `Structure/` | `PageShell`, `Card`, `BandeauPagina`, `SeccionRiel` |
| `Coquille/` | `SiteHeader`, `SiteFooter`, `LanguageSwitcher` |
| `Playground/` | les stories de référence — jetons, palettes, sémantique |
| `Écrans/` | les PAGES ENTIÈRES de la vitrine, une story par état (voir « Stories d'écran » plus bas) |
| `Parcours/` | les enchaînements d'écrans, une story par étape `n · Étape` |

Un nouveau composant rejoint le groupe qui décrit **ce qu'il fait**, quel que soit son dossier. Si
aucun ne convient, c'est une conversation, pas un groupe créé au passage.

*`Écrans/` et `Parcours/` sont nés de la même conversation le 2026-10-01 (Gabriel : « que Jérôme
voie tous les écrans dans tous leurs états pour décider du design ») : une page n'est le composant
d'aucun des cinq groupes, et la ranger dans `Structure/` l'aurait noyée parmi les gabarits.*

*Cette conversation a eu lieu le 2026-09-02 : les composants de la coquille du site étaient arrivés
sous un `Organisms/` qui reproduisait le nom du dossier — exactement ce que ce tableau existe pour
éviter — et `SiteFooter` s'était retrouvé dans `Structure/` pendant que `SiteHeader` était ailleurs,
séparant deux jumeaux. `Coquille/` est donc un sixième groupe assumé, et le mot est celui que le
projet emploie déjà (voir l'en-tête de `PageShell`).*

⚠️ Si le `title` contient un accent, ajouter un `id` explicite **sans accent** dans le `meta` :
Storybook dérive sinon l'identifiant du titre en conservant les accents, ce qui produit une URL
fragile.

Le playground se lance avec `npm run storybook` (port 6006) et **découvre les stories par glob** :
aucun fichier central à modifier. Le gabarit **Mobile 390 est actif par défaut**, et la barre
d'outils permet de basculer la langue (es/en) et le thème (vitrine/admin).

## Stories d'écran et parcours

Posé le 2026-10-01 : **chaque écran de la vitrine existe en entier dans Storybook, dans chacun de
ses états**, à côté des briques. C'est le support sur lequel Jérôme tranche le design du front.

### Pour Jérôme — le regarder chez soi

`npm run storybook -w @hifago/web`, puis <http://localhost:6006>. **Rien d'autre à lancer** : ni
Docker, ni Supabase, ni `.env.local` — tout est simulé. Dans la barre latérale, `Écrans/` (une
entrée par page, une story par état) et `Parcours/` (les étapes dans l'ordre). La barre d'outils
s'applique à la page entière : **thème** (vitrine/admin), **rayon**, **langue** (es/en) et
**gabarit** (Mobile 390 par défaut, Tablette 768, Desktop 1280). La vitrine présente toujours la
charte Hifago adoptée, en clair. Un état obtenu par un clic (erreur, envoi en cours, calendrier
ouvert…) se rejoue seul à l'ouverture ; l'onglet **Interactions** le montre pas à pas.

### Comment c'est fait

Une story d'écran rend le **vrai `page.tsx`**, dans la vraie chaîne de layouts — jamais une copie :
un écran redessiné est à jour ici sans toucher sa story. Elle est colocalisée (`page.stories.tsx` à
côté de `page.tsx`) et s'écrit avec `historiaDePagina` (`.storybook/support/pagina.tsx`) :

```tsx
export const PanierVide: StoryObj = {
  ...historiaDePagina({ Page: CartPage, grupo: "tunnel", ruta: "/mi-viaje", preparar: () => … }),
  name: "Panier vide", // ⚠️ en littéral, À CÔTÉ : l'indexeur ne lit pas dans un appel de fonction
};
```

Les données sont simulées à trois frontières, et **nulle part ailleurs** :

| Frontière | Mécanisme | Où |
|---|---|---|
| Lectures de `lib/` (`getProductoPorSlug`, `getCartLines`…) | `sb.mock(…, { spy: true })` : le vrai module est chargé, ses fonctions pures restent vraies, seules ses lectures sont redirigées vers les fixtures | `preview.tsx` + `support/datos.ts` |
| Paquets serveur (`next-intl/server`, `@hifago/supabase/{client,server}`) | alias Vite vers des mocks TS (`sb.mock` ne sait pas les remplacer) | `main.ts` + `support/mocks/` |
| Route Handlers `/api/*` appelés par le navigateur | `parameters.simularFetch` par story ; un appel non déclaré part en 404 **visible** | `support/fetch.ts` |

Le faux client Supabase (`support/supabaseFalso.ts`) tient une session (aucune, anonyme, compte),
un panier en mémoire et des réponses de RPC : `simularSesion`, `simularCarrito`, `simularRpc`,
`simularPendiente` (une requête qui ne répond jamais = l'état « en cours »), `simularErrorAuth`.
Une story surcharge une lecture dans son `preparar` : `mocked(getMyOrders).mockResolvedValue(null)`.
Fixtures **réalistes** (textes, vraies photos de `mockData/` servies sous `/mock`, dates relatives
à aujourd'hui à Guatapé) dans `.storybook/support/fixtures/`.

⚠️ **Un nouveau module de données branché sur une page doit arriver dans `preview.tsx` ET dans
`support/datos.ts` dans le même geste**, sinon la story part vers une base qui n'existe pas.

Un **parcours** (`components/parcours/`) réutilise les stories d'écran par `etapa(n, nom,
Ecran.Story, play)` ; le dernier geste de chaque étape vérifie qu'elle mène à la suivante (lien ou
navigation). Les vrais enchaînements de bout en bout restent prouvés par Playwright.

### Inventaire écran → états (tiré du code le 2026-10-01)

Une branche de rendu sans story est un trou visible ici ; les cas volontairement absents disent
pourquoi.

| Écran | États couverts | Absents, et pourquoi |
|---|---|---|
| Accueil | défaut, connecté + panier, dates/personnes, un seul type, sans résultat, retour après ajout (réordonné + toast), menu ouvert, raccourcis, suggestions, aucune suggestion, calendrier, personnes | « Buscando… » : `router.push` simulé est synchrone |
| Index par type | les 5 types, sans résultat, section vide, bandeau camp, bandeau événement | — |
| Catégorie | avec / sans description, « otras », > 24 offres, chargement, échec, sans résultat | 404 de catégorie : `notFound()` (voir Erreurs) |
| Fiche établissement | complète, presque vide (maison entière), rien à vendre | — |
| Fiche produit | créneaux, date (minimum), camp, hébergement hors PMS, PMS, transport, événement récurrent / réservable / gratuit, « Consultar » sans photo, événement sans lien, créneau / date / édition / nuits choisis, ajouté, ajout impossible, PMS en lecture / injoignable / quota / connecteur coupé | introuvable : `notFound()` (voir Erreurs) |
| Mi viaje | vide, vide + réservation à payer, plusieurs établissements, un jour, offre indisponible, camp bloqué, camp débloqué, retrait en cours | panne de lecture : voir Erreurs |
| Pago | vide, vide + réservation à payer, invité, compte (profil), compte (dernière réservation), WhatsApp invalide, en cours, plus de places, refus PMS | WhatsApp vide : infobulle NATIVE (pas de `noValidate`) |
| Résultat de réservation | à payer (invité / compte), départ vers Mercado Pago, paiement impossible, refusé, en confirmation, payée, gratuite, non honorée, remboursée, expirée, annulée, lignes mixtes | succès du départ : quitterait l'iframe |
| Connexion · Inscription · Mot de passe oublié / nouveau · Vérification e-mail | formulaires, erreurs, envois en cours, succès affichables (e-mail envoyé, renvoi + compte à rebours), Google en cours / échec | succès qui naviguent ailleurs (connexion, inscription, nouveau mot de passe) : c'est l'écran suivant |
| Mon profil | rempli, vide, modifié, en cours, enregistré, erreur, compte pro, suppression (confirmation, e-mail différent, en cours, échec) | déconnexion / suppression réussies : naviguent vers l'accueil |
| Mes réservations | toutes les variantes (8 états de commande, chaque forme de ligne), à venir seules, aucune, erreur, confirmation, dernière ligne, annulation en cours, échec | annulation réussie : `router.refresh` sans effet en story |
| Erreurs | 404, panne vitrine / tunnel / compte | — |

## Quand une spec d'écran a besoin d'un composant qui n'existe pas

Posé le 2026-09-07, à l'ouverture du chantier front — l'accueil (spec 28) a fait apparaître le cas
trois fois d'un coup.

**Une spec d'écran doit NOMMER les composants manquants**, dans sa liste de fichiers touchés, avec
leur dossier. Un composant découvert manquant *pendant* le codage est le mode d'échec à éviter : il
finit improvisé dans le fichier de la route, sans test, sans story, invisible au prochain écran qui
en aurait eu besoin — et c'est comme ça qu'on se retrouve avec deux composants qui font la même
chose. `PhotoStrip` a failli être réécrit exactement de cette façon.

**Où le construire, deux cas seulement :**

- **Dans le même lot que l'écran**, quand il ne sert que cet écran et qu'il ne demande aucune
  décision visuelle — la carte d'une section, le bloc d'un état vide. Il naît avec son test et sa
  story comme n'importe quel autre.
- **Dans un lot à part**, quand il servira plusieurs écrans, quand il **modifie un composant
  existant** (une variante, une taille, un état de plus), ou quand il demande un arbitrage visuel.
  Modifier un atome au milieu d'un lot d'écran, c'est toucher un fichier que d'autres agents
  utilisent, et c'est la collision garantie.

**Jamais un troisième cas.** Un composant n'est jamais écrit à l'intérieur d'un `page.tsx`, même
« provisoirement » : la règle du barrel RSC l'interdit de fait dès qu'il touche `@hifago/ui`, et
rien ne le rattraperait ensuite.

**Avant d'en créer un, chercher.** Le dossier `components/` tient sur un écran, et Storybook les
range par ce qu'ils font (`Actions/`, `Saisie/`, `Affichage/`, `Structure/`, `Coquille/`) plutôt que
par leur dossier — c'est fait pour ça.

## Travailler à plusieurs agents

Voir `hifago/AGENTS-PARALLELES.md`, section « Agent qui crée des composants ». En résumé : un agent
= un dossier + un namespace i18n ; on ne crée jamais un atome qui n'est pas dans son périmètre ; on
n'ajoute aucune dépendance ; on ne lance pas son propre serveur sur les ports 3100 / 6006.
