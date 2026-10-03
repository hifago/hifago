---
paths:
  - "**/packages/ui/**"
  - "**/apps/**/components/**"
---

# Design system — chargée quand on touche `packages/ui` ou un dossier `components/`

Le socle est décidé et toujours chargé (`CLAUDE.md` §2.2 : HeroUI v3 seul socle, via
`packages/ui`, deux thèmes `vitrine`/`admin` sur les mêmes composants). Ce fichier porte la carte
besoin → bibliothèque et les règles responsive. Conventions d'écriture des composants de la vitrine
(nommage, anatomie, stories) : `apps/web/components/README.md`. Règle d'échappement : au-delà de
100 lignes, la carte part dans `docs/04-architecture-cible.md` avec un lien.

## Carte besoin → bibliothèque (non négociable)

| Besoin | Bibliothèque | Point d'attention |
|---|---|---|
| Composants génériques | HeroUI v3 | Importer uniquement depuis `@hifago/ui` (barrel de `packages/ui`), **jamais** `@heroui/react` dans une app. Un composant s'ajoute au registre depuis `packages/ui/`. Jamais de `tv()` à la main : les variantes sont des classes BEM stylées par les tokens `[data-theme]` |
| Graphiques | Recharts | Pas Tremor/Nivo/Chart.js. Le fichier qui construit le graphique porte `"use client"` |
| Sélecteur de dates client | react-day-picker (`DayPickerCalendar` de `@hifago/ui`) | Prix/statut par cellule via `modifiers`/`components`. **Ne pas migrer vers HeroUI `RangeCalendar`** : évalué deux fois (17 et 29/08), aucune des deux bibliothèques n'exprime les nuits à sortie exclusive — le prédicat conscient de l'ancre s'écrit dans l'app de toute façon (`docs/04-architecture-cible.md`) |
| Calendrier de disponibilité admin/socio | FullCalendar ; agenda des réservations socio : SVAR | Coût réel (DOM/CSS propres) — surcharge de palette et toolbar HeroUI à prévoir |
| Tables denses (catalogue, ledger, registre, modération) | TanStack Table + `SimpleTable` de `@hifago/ui` | **Jamais** le `Table` compound HeroUI ici (état interne incompatible avec le moteur headless). Listes standardisées admin/socio : `DataList` (spec 10) |
| Table d'affichage simple | `Table` compound HeroUI | Pas de TanStack ici. Depuis un Server Component : cf. `apps.md` (jamais `items=`/`renderEmptyState=` sans `"use client"`) |
| Écrans CRUD purs | Refine.dev en scaffolding | Jamais pour la logique métier, jamais `@refinedev/mui` |
| Téléphone international (indicatif pays, validation E.164) | react-phone-number-input (`PhoneField` de `apps/web/components/atoms`) | Arbitrage Jérôme 2026-09-10. Import racine du package = déjà la variante `min` (jamais `/max`, jamais `libphonenumber-js` en double). `containerComponent`/`inputComponent`/`countrySelectComponent` remplacent CHACUN tout le DOM par défaut de la lib — pas de `style.css` importé, pas de second design system : le numéro reste rendu par la classe `.input` de `packages/ui` |
| Texte d'interface | next-intl (`apps/web`) / espagnol en dur (`apps/admin`) | cf. `apps.md` |

Aucune dépendance UI hors de cette carte sans arbitrage explicite de Jérôme — si le besoin ne rentre
dans aucune ligne, signaler le cas précis plutôt qu'improviser. Un composant ajouté dans
`apps/*/components/` qui duplique quelque chose de `packages/ui` est une rupture.

## Responsive — obligatoire sur `apps/admin` (admin ET socio) comme sur `apps/web`

- Classes de base = mobile ; `sm:`/`md:`/`lg:` ajoutent. Breakpoint de référence `md` = 768 px. Un
  écran n'est pas terminé tant qu'il n'a pas été vu à **390×844** et **1280×900**.
- Une liste/tableau dense : **reflow en cartes sous `md`**, jamais un simple `overflow-x-auto`
  (scrollable ≠ lisible) — pattern validé côté legacy (portail socio), à reproduire. Un formulaire
  en colonnes s'empile sous `md`.
- **Ne jamais masquer de contenu selon la largeur** (`hidden md:block`) : Google indexe la version
  mobile. On réorganise ; `hidden` est réservé au décoratif.
- Un composant ne fixe aucune largeur en dur ; la page ne défile jamais horizontalement — un contenu
  large défile dans son conteneur, et **`overflow-x-auto` seul est une violation d'accessibilité**
  (WCAG 2.1.1, axe `scrollable-region-focusable`) : si le conteneur ne contient aucun élément
  focalisable, `tabIndex={0}` + `role="region"` + `aria-label` ; ne pas les poser s'il contient déjà
  des liens ou boutons (arrêt de tabulation inutile).
- Texte courant jamais sous 16 px sur mobile, cible tactile ≥ 44 px, information jamais portée par
  la seule couleur, focus clavier toujours visible.

## Deux thèmes, un seul design system

`data-theme="vitrine"` (`apps/web`) et `data-theme="admin"` (`apps/admin`) posés sur `<html>` ;
tokens communs et les deux jeux de valeurs dans `packages/ui/src/styles/globals.css`. Le
`@source "../**/*.{ts,tsx}"` de `apps/web/app/globals.css` fait entrer les composants de l'app dans
le scan Tailwind de `packages/ui` : sans lui, ils s'affichent SANS STYLE en silence.

### Style Hifago 2026

Le contrat complet est dans `docs/specs/41-charte-hifago-toute-la-vitrine.md` §0 ; les valeurs sont
dans `globals.css`, section « LA CHARTE ». Trois surfaces : **or** (`#ddae09`, texte marine) pour la
navigation et les bandeaux ; **claire** pour lire et agir ; **marine** (texte blanc, poudre ou or)
pour les rails et le pied. Jamais de blanc sur l'or ni d'or sur clair ; le bleu ciel reste décoratif.
Le slogan seul est en Poppins 800 ; titres de page, section et bloc sont en Anton 400 avec
`--tracking-titre` ; le reste en Poppins. Anton n'est jamais rendu sous 20 px ni en faux gras.
Tout `<h1>`–`<h3>` reçoit son interlettrage du jeton, jamais une classe `tracking-*` concurrente.
Boutons et champs ont un rayon de 8 px ; les tuiles/conteneurs 16 px ; les pilules sont réservées à
la recherche, aux puces et aux bulles. Les titres emploient la police de production dans Storybook
comme dans Next : Anton est confirmé, aucune Sugo d'essai n'est servie.

Storybook rend toujours la charte adoptée, en mode clair. La planche `Playground/Charte` sert de
référence visuelle ; `Playground/Palette → Contrastes` mesure les couples de production.

## Composants de la vitrine (`apps/web/components/`)

`atoms/` (ne traduit rien) · `molecules/` · `organisms/` · `seo/` · `playground/` · `parcours/`. Un composant lié
à une seule route reste colocalisé dans `app/[locale]/…` ; on ne remonte dans `components/` que ce
qui sert au moins deux endroits. **Aucun barrel `index.ts`, aucun registre de stories** (plusieurs
agents y travaillent en parallèle). Storybook (`npm run storybook`, port 6006) est le playground
tranché le 2026-09-01 ; ses stories sont découvertes par glob. Depuis le 2026-10-01 il rend aussi
chaque PAGE entière dans chacun de ses états (`Écrans/`, `Parcours/`) : un écran qui gagne un état
gagne sa story (mode d'emploi : `apps/web/components/README.md`, « Stories d'écran »).
