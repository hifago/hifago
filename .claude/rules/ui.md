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

**La vitrine porte la charte graphique Hifago 2026 depuis le 2026-10-01** (PDF fourni par Jérôme) —
elle ne tourne plus sur les défauts HeroUI. Les cinq couleurs, leur emploi et les trois interdits
mesurés sont dans `globals.css`, section « LA CHARTE ». Les trois qui se retiennent :

1. **L'or `#ddae09` ne porte jamais de texte sur fond clair** (1.96:1) — c'est un aplat, avec du
   marine dessus. Jamais de blanc sur l'or non plus (2.07:1).
2. **Le bleu ciel `#619ccc` est décoratif** (2.79:1, sous le seuil de 3:1) : motif et aplats, jamais
   une bordure de champ ni rien qui identifie un composant.
3. **Les liens et le focus sont découplés de l'accent** (bleu moyen `#2a618e`), contrairement aux
   autres thèmes — conséquence directe du point 1.

Polices : Poppins (corps) et Anton (titres, `--font-titre`), chargées par `app/[locale]/layout.tsx`
et par `.storybook/preview-head.html` pour le playground. ⚠️ La charte demande **Sugo Pro Display**
pour les titres : seule sa version d'ESSAI existe (licence CC BY-NC, non commerciale, distribution
interdite) — Storybook la lit hors dépôt sur la machine de Jérôme, jamais copiée dans le dépôt ni
dans `public/` ; partout ailleurs Anton sert de repli jusqu'à la licence commerciale. ⚠️ Les noms de
variables doivent rester identiques des deux côtés, sinon playground et production divergent en
silence — c'est le piège qui a laissé la vitrine en pile système pendant un mois.

**Espacement de la police de titre** (Jérôme, 2026-10-01) : tout texte en `--font-titre` prend
l'interlettrage du jeton `--tracking-titre` (0.0667em, proportionnel : 3 pt sur un titre de 60 px,
`globals.css`) et aucun autre — porté par la règle des `<h1>`–`<h3>`, ou par
`tracking-[var(--tracking-titre)]` hors titre HTML. Jamais de `tracking-…` à côté de `font-titre` ni
sur un `<h1>`–`<h3>` : la valeur se règle au jeton (`check-tokens.sh`).

Cinq pistes de comparaison (`embalse`, `zocalo`, `cal`, `hifago`, `chiva`) restent derrière un
`data-piste` que seule la barre d'outils Storybook pose. ⚠️ Elle MÉMORISE son dernier choix : une
piste encore sélectionnée masque la charte sans prévenir — remettre « Aucune piste » avant de juger
un rendu.

## Composants de la vitrine (`apps/web/components/`)

`atoms/` (ne traduit rien) · `molecules/` · `organisms/` · `seo/` · `playground/` · `parcours/`. Un composant lié
à une seule route reste colocalisé dans `app/[locale]/…` ; on ne remonte dans `components/` que ce
qui sert au moins deux endroits. **Aucun barrel `index.ts`, aucun registre de stories** (plusieurs
agents y travaillent en parallèle). Storybook (`npm run storybook`, port 6006) est le playground
tranché le 2026-09-01 ; ses stories sont découvertes par glob. Depuis le 2026-10-01 il rend aussi
chaque PAGE entière dans chacun de ses états (`Écrans/`, `Parcours/`) : un écran qui gagne un état
gagne sa story (mode d'emploi : `apps/web/components/README.md`, « Stories d'écran »).
