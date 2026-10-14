---
id: specs-design-system-admin
titre: "Design system admin — charte Hifago 2026 (remplace la piste Argile)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-10-13
resume: >
  Tokens du thème admin HeroUI v3 (data-theme="admin", admin + socio). Depuis le 2026-10-13 : la
  charte Hifago 2026 (or, marine, bleus ; Poppins, Anton sur le titre de page), réglée pour la
  lisibilité — barre latérale marine, or réservé à l'action principale et au lien actif, rayon de
  8 px, filets bleu poudre. Remplace la piste "Argile" (fond beige, coins carrés, accent terracotta)
  tranchée le 2026-08-15, conservée plus bas comme historique.
mots_cles: [design system, admin, socio, theme, heroui, tokens, charte, or, marine, poppins, anton, radius, argile, couleurs]
repond_a:
  - "Quelles valeurs de tokens CSS pour le thème admin (fond, accent, bordures, radius) ?"
  - "Pourquoi la barre latérale de l'admin est marine et pas or ?"
  - "Pourquoi un fond beige sans bordure et des coins carrés pour le back-office (historique) ?"
---

# Design system admin — charte Hifago 2026 (remplace la piste Argile)

> **Cible stack** : hifago. Pas de numéro de feature build — changement transverse de tokens CSS,
> pas une feature fonctionnelle.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** — la charte Hifago, révision du 2026-10-13 (pour coder) | validé |
| 0 bis | Historique — jetons, invariants et cas limites de la piste « Argile » (remplacée) | historique |
| 1 | Contexte et problème | validé |
| 2 | Portée | validé |
| 3 | Décisions retenues | validé |
| 4-9 | *(non applicables — pas de parcours/écran nouveau, pas de RPC ni de modèle de données ; le contrat de tokens complet vit en §0)* | — |
| 10 | Décisions tranchées / points ouverts | validé |
| 11 | Annexe — traçabilité code→règle | validé |
| 12 | Documents liés | validé |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Révision du 2026-10-13 — la charte Hifago remplace la piste « Argile » (fait foi)

Demande de Jérôme : « applique la charte graphique de hifago à /partner et admin, en favorisant la
lisibilité et la facilité d'utilisation au style ». **Ce bloc prime sur tout le reste de la spec** :
le tableau de jetons, les invariants et les cas limites qui suivent décrivent la piste « Argile »
(2026-08-15) et ne valent plus que comme historique. Les valeurs vivent dans
`packages/ui/src/styles/globals.css`, bloc `[data-theme="admin"]`.

| Rôle | Valeur | Contraste mesuré |
|---|---|---|
| Page `--background` | `oklch(97% 0.01 247)` (blanc bleuté, celui de la vitrine) | — |
| Texte `--foreground` | marine `#132f61` | 11.99:1 sur la page, 13.07:1 sur carte |
| Texte discret `--muted` | marine adouci `oklch(47% 0.06 260.9)` | 6.28:1 / 6.84:1 |
| Cartes, champs, overlays | blanc | — |
| Accent `--accent` (bouton principal, lien de nav actif) | or `#ddae09`, texte marine | 6.31:1 |
| Neutre `--default` | bleu poudre `#b6cde8`, texte marine | 8.02:1 |
| Lien, focus, bordure de champ | bleu moyen `#2a618e` | 6.03:1 sur la page |
| Filets `--border` | bleu poudre ; `--border-width: 1px` | décoratif |
| Statuts | succès `oklch(45% 0.12 150)`, alerte `oklch(54% 0.16 50)`, danger `oklch(46% 0.19 15)` | 7.04 / 4.93 / 7.12:1 en texte |
| Navigation (`data-superficie="marine"`) | fond marine, texte blanc, discret bleu poudre, focus or | 13.07 / 8.02 / 6.31:1 |
| Rayons | `--radius: 0.5rem` ; boutons et champs 8 px (`--rayon-bouton`) ; ce qui flotte 16 px (`--radius-3xl`) | — |
| Polices | Poppins (`--font-sans`) ; Anton sur `.titre-page` seulement, 28 px, graisse 400 | — |

**Invariants (remplacent ceux de la piste Argile)**
- L'or ne porte jamais de texte sur fond clair (2.07:1) et ne reçoit jamais de blanc : `text-accent`
  est interdit dans `apps/admin` ; un lien prend `text-link`, un état « fait » `text-success`.
- L'or est rare : l'action principale d'un écran et le lien de navigation actif. La barre latérale
  et la barre mobile sont marine, pas or (une colonne or à côté d'un tableau dense fatigue, et le
  bouton or n'y ressortirait plus).
- Anton uniquement sur le titre de page (`<h1 className="titre-page">`), jamais sous 20 px, jamais
  avec une classe de graisse. Tous les autres titres restent en Poppins.
- Un seul `<h1>` visible par page : le libellé de la barre mobile est un `<p>`.
- Sous `md`, boutons et champs font 44 px de haut au minimum.
- Pas d'ombre sur cartes et champs ; seuls les éléments flottants en gardent une.
- Le thème `vitrine` n'est pas touché (partie vitrine du CSS identique à l'octet, vérifié).

**Ce qui est retiré** : `--radius: 0` et `--border-width: 0` (les « invariants non négociables »
de la piste Argile), l'accent terracotta, l'interdit des teintes froides, et le recalage des
utilitaires `.border`, `.border-t/b/l/r/x/y`, `.border-dashed` — écrit
`border-width: var(--border-width)`, il posait la largeur sur les QUATRE côtés : indolore à 0, il
transformait à 1 px chaque `border-t` en cadre entier. Le recalage de `.rounded`, le zébrage des
lignes de `SimpleTable`, la règle `gmp-place-autocomplete` et le décalage du toast restent.

**Fichiers** : `packages/ui/src/styles/globals.css` (bloc admin) ·
`packages/ui/src/components/app-nav-shell.tsx` (surface marine, prop `brand`) ·
`packages/ui/src/components/data-list.tsx` (actions qui passent à la ligne sous `md`) ·
`apps/admin/app/layout.tsx` (Poppins, Anton) · `apps/admin/components/logo-hifago.tsx` et
`apps/admin/public/brand/` · les 57 `<h1>` de l'app (`titre-page`) · graphiques, calendrier de
disponibilité et assistant par étapes (couleurs).

**À valider par Jérôme au rendu** : rayon de 8 px (au lieu des coins carrés), barre latérale marine
(au lieu d'or), Anton limité au titre de page.

---

## 0 bis. Historique — piste « Argile » (2026-08-15, remplacée le 2026-10-13)

### Endpoints / RPC

Non applicable — changement de tokens CSS uniquement, aucun code serveur touché.

### Modèle de données (delta)

Non applicable.

### Jetons CSS — `[data-theme="admin"]` (`hifago/packages/ui/src/styles/globals.css`)

Remplace intégralement le bloc actuel (qui ne personnalisait que `--radius` et `--accent`).

> **Révisé le 2026-08-15 (deux passes après l'implémentation initiale)** — retour direct de Jérôme
> sur l'app réelle, pas une relecture à froid. Deux corrections substantielles par rapport à la
> version comparée dans la maquette initiale :
> 1. **Chroma des tons neutres remontée** (`--background`/`--surface`/`--overlay`/`--default`/
>    `--border`/`--separator`) — les valeurs d'origine (chroma ~0.002-0.007, quasi achromatiques,
>    directement dérivées de Tailwind `taupe`) sont trop faibles pour lire comme chaudes une fois
>    posées à côté de l'accent terracotta (chroma 0.13-0.15) : contraste simultané, elles apparaissent
>    grises/mauves en rendu réel plutôt que beige, alors qu'isolées en swatch elles semblaient bien
>    chaudes. Toutes remontées à chroma ~0.02-0.035 pour une teinte non ambiguë même à côté d'un
>    accent saturé.
> 2. **`--field-border-width` repassé à `1px`** (et `--field-border`/`--border` remontés en visibilité) —
>    voir §10, le pari "0 bordure partout" ne tenait pas en usage réel sur les champs de formulaire ni
>    sur la bordure structurelle de la sidebar.

| Jeton | Valeur | Rôle |
|---|---|---|
| `--radius` | `0rem` | coins carrés partout (composants, cartes) — seule contrainte non négociable de la demande initiale, jamais remise en cause |
| `--field-radius` | `0rem` | coins carrés sur les champs de formulaire |
| `--border-width` | `0px` | pas de filet par défaut sur cartes/tableaux — philosophie "aplats" ; des utilitaires Tailwind bruts (`.border`, `.rounded`, sans suffixe) ne dérivaient pas de ces tokens par défaut, recalés explicitement (voir note sous le tableau) |
| `--field-border-width` | `1px` | **exception** — un champ de formulaire interactif doit rester repérable quel que soit son conteneur (constaté cassé en usage réel avec `0px`, voir §10) |
| `--background` | `oklch(90% 0.018 55)` | fond de page/sidebar — beige chaud |
| `--foreground` | `oklch(22% 0.02 45)` | texte principal — brun quasi-noir |
| `--surface` | `oklch(96.5% 0.014 60)` | cartes, tables, topbar — plus clair que le fond |
| `--surface-foreground` | `oklch(22% 0.02 45)` | texte sur surface |
| `--overlay` | `oklch(98.2% 0.01 60)` | modales, dropdowns, et fond des champs (voir `--field-background`) |
| `--overlay-foreground` | `oklch(22% 0.02 45)` | texte sur overlay |
| `--muted` | `oklch(52% 0.03 45)` | texte secondaire, labels |
| `--default` | `oklch(83% 0.035 50)` | fond neutre (boutons secondaires, badges par défaut, bordure structurelle de la sidebar) |
| `--default-foreground` | `oklch(22% 0.02 45)` | texte sur `--default` |
| `--accent` | `oklch(50% 0.15 35)` | terracotta — remplace le bleu-violet froid actuel |
| `--accent-foreground` | `oklch(98% 0.006 55)` | texte sur accent |
| `--field-background` | `var(--overlay)` | le palier le plus clair, pas `--background` — un champ doit rester visible posé directement sur la page, pas seulement "creusé" dans une carte `--surface` (voir §10) |
| `--field-foreground` | `oklch(22% 0.02 45)` | texte saisi |
| `--field-placeholder` | `oklch(58% 0.025 45)` | placeholder |
| `--field-border` | `oklch(78% 0.03 45)` | visible (1px, voir `--field-border-width`) |
| `--success` / `--success-foreground` | `oklch(0.52 0.1 145)` / `oklch(98% 0.01 145)` | statut positif |
| `--warning` / `--warning-foreground` | `oklch(0.72 0.14 75)` / `oklch(20% 0.02 75)` | statut en attente |
| `--danger` / `--danger-foreground` | `oklch(0.5 0.17 25)` / `oklch(98% 0.01 25)` | statut négatif |
| `--border` | `oklch(85% 0.025 48)` | filet discret — utilisé par les rares composants HeroUI qui en dessinent un malgré `--border-width: 0`, et par le widget d'adresse Google |
| `--separator` | `oklch(88% 0.02 50)` | idem |
| `--focus` | `var(--accent)` | anneau de focus clavier — reste net même sans bordure statique |
| `--link` | `var(--accent)` | liens |
| `--surface-shadow` | `none` | pas d'ombre sur cartes/tables (philosophie aplats) |
| `--field-shadow` | `none` | idem champs |
| `--overlay-shadow` | valeur HeroUI par défaut (conservée) | seule dérogation « pas d'ombre » — un élément flottant (dropdown/modale) a besoin de se détacher du fond sans bordure ni radius |

**Recalages hors palette, dans le même fichier** (nécessaires pour que les tokens ci-dessus
s'appliquent réellement — sinon des dizaines de cartes admin gardaient une bordure/un radius figés
en dur par Tailwind, invisibles au changement de token) :
- `.border`, `.border-t/b/l/r/x/y`, `.rounded` (classes Tailwind "brutes", sans suffixe gradué) sont
  recalées sur `var(--border-width)`/`var(--radius)`, scopées à `[data-theme="admin"]` — un seul
  endroit, aucun fichier composant à retoucher un par un.
- `.border-dashed` en est explicitement exclu (remis à `1px`) : dans ce projet, une bordure en
  pointillés n'est jamais décorative, toujours l'affordance d'une zone de dépôt/action (ex. "Añadir
  foto") — la mettre à 0 la rend invisible.
- `gmp-place-autocomplete` (widget d'adresse Google, Shadow DOM fermé) : `color-scheme: light` posé
  directement sur l'élément (pas seulement l'ancêtre — le composant redéclare le sien en interne),
  seul levier documenté par Google pour éviter qu'il suive le mode sombre du système.
- Zébrage des lignes de `SimpleTable` (`:nth-child(even)`), scopé au thème admin, pour compenser
  l'absence de filet entre lignes sur une liste dense.

### Invariants

- `--radius` et `--field-radius` = `0` partout dans le thème `admin` — invariant non négociable.
- Aucune teinte froide (bleu/violet) dans le thème `admin` — l'accent unique est terracotta.
- Contraste texte/fond visé ≥ AA (WCAG) sur `--foreground`/`--background`, `--surface-foreground`/
  `--surface`, `--accent-foreground`/`--accent` — valeurs choisies pour un contraste large, ratio non
  recalculé formellement ici, à vérifier si un composant final semble limite.
- Aucun composant dupliqué : seuls les tokens changent, `packages/ui` reste l'unique socle
  (`hifago/CLAUDE.md` §2.2, non rouvert par cette spec).
- Le thème `vitrine` (apps/web) n'est pas touché par ce changement.

### Cas limites

- Ligne de tableau dense (réservations, calendrier) : pas de filet entre lignes — zébrage
  (alternance `--surface` / une variante légèrement plus soutenue de moins de 5% de luminance) requis
  pour rester scannable, à la charge du composant `SimpleTable`/table HeroUI qui consomme ces tokens.
- Élément flottant (dropdown, popover, modale) : conserve une ombre (`--overlay-shadow`) même si le
  reste du thème est plat — seule dérogation à "pas d'ombre".

### Fichiers touchés

- `hifago/packages/ui/src/styles/globals.css` — bloc `[data-theme="admin"]`, remplacé intégralement.

---

## 1. Contexte et problème

Le thème `[data-theme="admin"]` de `packages/ui` (design system HeroUI v3 partagé avec `apps/web`,
qui utilise `[data-theme="vitrine"]`) ne personnalisait jusqu'ici que deux jetons — `--radius:
0.375rem` (arrondi léger) et `--accent: oklch(0.5 0.04 260)` (bleu-violet froid) — le reste héritant
des valeurs par défaut de HeroUI (fond blanc). Un commentaire dans le fichier indiquait explicitement
qu'aucune palette de marque n'était encore tranchée pour l'admin, cette décision étant renvoyée à un
choix de design séparé.

Jérôme a demandé un fond « assez beige mais pas blanc » et des coins carrés partout, dans l'esprit
d'un « beau design système pour backoffice classique », en s'appuyant sur les libs déjà en place
(HeroUI v3, Tailwind CSS v4) plutôt que sur des couleurs inventées.

## 2. Portée

**In** : valeurs de tokens du thème `admin` — couleur (fond, surface, accent, champs, statuts),
radius, largeur de bordure, ombre.

**Out** : les composants eux-mêmes (déjà conformes au contrat « un seul design system, seuls les
tokens varient », `hifago/CLAUDE.md` §2.2, non retouché) ; le thème `vitrine` (non touché) ; un mode
sombre pour l'admin (non demandé, non traité — voir §10).

## 3. Décisions retenues

- HeroUI v3 (React Aria + Tailwind v4) comme seul socle de composants — décision déjà actée
  (`hifago/docs/04-architecture-cible.md` §2), non rouverte par cette spec.
- Design system unique à deux thèmes nommés sur les mêmes composants (`hifago/CLAUDE.md` §2.2) —
  cette spec ne crée qu'un delta de tokens sur le thème `admin` existant, jamais un 3ᵉ thème ni un
  second design system.

## 10. Décisions tranchées / points ouverts

- **Piste retenue** — *Argile* (aplats de teinte beige, sans bordure visible, réf. Muji), parmi 3
  pistes comparées visuellement (*Grand-Livre*/Mercury — grille classique à filets fins ; *Argile*/
  Muji ; *Encre restreinte*/Basecamp-HEY — filets fins + accent unique). Tranché par Jérôme le
  2026-08-15 après revue d'une maquette comparative (graphe, liste, formulaire) pour chaque piste.
- **Famille d'accent** — terracotta (chaud), remplace le bleu-violet froid actuel : implicite dans le
  choix de la piste Argile, dont l'accent terracotta faisait partie intégrante de la proposition.
- **Risque « champ sans bordure » — confirmé cassé en usage réel, pas seulement un risque théorique.**
  La mitigation initialement prévue (`--field-background` = `--background`, effet « creusé ») ne
  tenait que si un champ est TOUJOURS posé dans un conteneur `--surface` — faux en pratique (formulaires
  posés directement sur la page). Résultat observé le 2026-08-15 : champs invisibles sur plusieurs
  écrans réels. Corrigé en deux temps : `--field-background` passé sur `--overlay` (palier le plus
  clair, visible sur n'importe quel fond) ET `--field-border-width` repassé à `1px` avec un
  `--field-border` réellement visible — seule exception admise à « pas de bordure », un champ
  interactif doit rester repérable indépendamment de son conteneur.
- **Bordure structurelle de la sidebar admin — également réintroduite.** Même constat que les champs :
  la sidebar et la zone de contenu partagent `--background`, donc sans filet elles devenaient
  indissociables visuellement. `apps/admin/app/admin/AdminSidebar.tsx` fixe désormais sa bordure
  droite à `1px` (`border-r-[1px] border-default`), volontairement PAS pilotée par `--border-width`
  (qui reste à `0` pour tout le reste) — c'est un élément structurel unique dans l'app, pas un motif
  répété justifiant un token dédié.
- **Boutons flottants sur une photo (déplacer/supprimer, `MediaGallery` et écrans dérivés)** — le
  `Button` HeroUI `variant="outline"` ne se distingue que par sa bordure, invisible avec
  `--border-width: 0`, et de toute façon peu fiable posé sur une photo au contenu de couleur
  imprévisible. Remplacés par des `<button>` natifs avec un scrim sombre fixe
  (`bg-black/55 text-white`, classe `overlayButtonClass`) — pas un jeton de thème (spécifique aux
  contrôles flottant sur une image, pas à la palette de fond de l'app), donc non listé dans le
  tableau de jetons ci-dessus ; dupliqué tel quel dans chaque fichier qui en a besoin (pas encore
  assez d'occurrences pour justifier une extraction dans `packages/ui`).
- **`--surface-secondary`/`--surface-tertiary` — jetons HeroUI non couverts par le delta initial,
  cassés en usage réel.** Contrairement à `--background-secondary`/`--border-secondary` (dérivés par
  HeroUI via `color-mix()` depuis `--background`/`--surface`, donc déjà corrects), ces deux-là sont
  des valeurs oklch figées du thème "default" de HeroUI (`node_modules/@heroui/styles/dist/themes/
  default/variables.css`) — un thème personnalisé comme `admin` ne les hérite d'aucune formule, il
  fallback silencieusement sur le gris froid HeroUI. Tout ce qui s'en sert (survol/état actif de la
  sidebar, lignes de `SimpleTable`, calendrier, alertes, `PartnerNav`, et le CADRE du `Table` compound
  HeroUI — `node_modules/@heroui/styles/dist/components/table.css` ligne 7, "gray background with
  the table body as a white card inside") restait donc gris froid malgré le reste de la palette
  corrigée. Une première correction via `color-mix(in oklab, var(--surface) 92%, var(--surface-
  foreground) 8%)` donnait ~90.5% de clarté — quasi identique à `--background` (90%) par coïncidence
  de calcul, donc le cadre du tableau se refondait quand même dans la page (constaté sur `/admin/
  invitations` le 2026-08-15, tout le contenu à droite de la sidebar lisait comme un seul aplat).
  Valeurs explicites retenues à la place d'une formule dérivée : `--surface-secondary: oklch(78%
  0.03 50)`, `--surface-tertiary: oklch(70% 0.035 50)` — marge de clarté volontairement large vs
  `--background` (90%) et `--surface` (96.5%) des deux côtés, pour ne plus dépendre d'un calcul qui
  pourrait recoller par accident. L'item de navigation actif de la sidebar utilise en plus `--accent`
  (fond terracotta plein), pas seulement `--surface-secondary`, pour correspondre à la maquette
  comparée et retenue.
- **Cartes/sections de contenu sans fond — 18 fichiers, admin et socio.** Motif systémique : partout
  dans l'app, un bloc de section (`"rounded-lg border p-4"` et variantes) posait `border` mais jamais
  de `bg-*` — invisible sous l'ancien thème HeroUI par défaut (fond de page blanc = fond de carte
  implicite blanc, aucune différence à voir), mais plus du tout sous un fond de page beige délibéré :
  chaque section se fondait dans la page, aucune structure visuelle de contenu nulle part. `bg-surface`
  ajouté explicitement sur les 18 occurrences (grep exhaustif sur `apps/admin/app`, pas une liste
  partielle) plutôt qu'un recalage CSS global comme pour `--border-width`/`--radius` : contrairement à
  `.border`/`.rounded`, la classe `border` n'implique pas systématiquement "ceci est une carte" (ex.
  vignettes photo, boutons) — un recalage aveugle aurait posé un fond sur des éléments qui n'en
  veulent pas.
- **Largeur de contenu admin (`max-w-5xl` → `max-w-7xl`, `apps/admin/app/admin/layout.tsx`)** —
  élargissement ponctuel, pas la solution finale : `docs/specs/10-listes-standardisees-admin-socio.md`
  (session concurrente) traite explicitement cette même question avec une réponse par type d'écran
  (liste vs formulaire), à privilégier quand cette spec sera implémentée plutôt que de re-retoucher
  ce fichier séparément.
- **Mode sombre admin** — non demandé, non traité par cette spec ; laissé ouvert pour une spec
  séparée si un jour nécessaire.

## 11. Annexe — traçabilité code→règle

| Section | Fichiers |
|---|---|
| §0 Jetons CSS | `hifago/packages/ui/src/styles/globals.css` |

## 12. Documents liés

- `hifago/docs/04-architecture-cible.md` — décision HeroUI v3 (non rouverte par cette spec).
- `hifago/CLAUDE.md` §2 — contrat design system unique à deux thèmes nommés.
