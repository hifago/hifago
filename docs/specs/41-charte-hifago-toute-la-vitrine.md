---
id: specs-charte-hifago-toute-la-vitrine
titre: "Charte Hifago sur toute la vitrine : analyse de l'accueil, règles du style, plan par items"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: brouillon
maj: 2026-10-02
resume: >
  Étendre le style de l'accueil (charte Hifago 2026) à toutes les pages de la vitrine : analyse
  mesurée de l'accueil, règles du style, constats écran par écran, puis un plan d'items identifiés
  (fondations, coquille, composants, pages, assets, garde-fous) applicables un par un ou par lot,
  sans dégrader lisibilité, SEO ni conversion. Aucun code : des descriptions précises à appliquer.
mots_cles: [charte, charte graphique, style, design, vitrine, accueil, typographie, couleurs, or, marine, bleu poudre, Sugo, Anton, Poppins, header, footer, bandeau, rail, tuile, cartouche, bulles, GO, refonte visuelle, plan, items, lots]
repond_a:
  - "Comment appliquer le style de l'accueil au reste de la vitrine ?"
  - "Quelles sont les règles visuelles Hifago (couleurs, typographie, formes, composants) ?"
  - "Que faut-il changer sur chaque page de la vitrine, et dans quel ordre ?"
  - "Quels arbitrages visuels attendent Jérôme ?"
  - "Qu'est-ce qui a été modifié sur l'accueil, et avec quelles valeurs ?"
---

# Charte Hifago sur toute la vitrine — analyse de l'accueil, règles du style, plan par items

> **Ce que c'est** : le plan qui permet d'habiller **toute la vitrine** (`apps/web`) au style que
> l'accueil porte depuis les commits `1009eda` (charte graphique Hifago 2026) et `c3042e6` (seconde
> maquette de l'accueil, cartes « cartouche + bulles », mobile à une carte), branche
> `feat/charte-graphique-vitrine`. **Il ne contient aucun code** : chaque changement est un
> **item identifié** (`F1`, `C2`, `P3`…) décrit avec l'état mesuré, la cible, les fichiers, les pièges et
> la vérification, pour être appliqué seul ou par lot.
>
> **Écrit pour** Jérôme et pour une IA qui n'a jamais vu les conversations précédentes. Tout ce qu'il
> faut savoir est ici ou cité avec son chemin.
>
> **Comment il a été établi (le 2026-10-02)** : lecture du PDF de la charte (9 pages, hors dépôt :
> `../Charte Graphique/DOC Graphique HIFAGO.pdf`), de la maquette (`../Assets/mockup page accueil.jpeg`),
> du journal `docs/journal/2026-10.md` (entrées du 01/10 au 02/10), du code de chaque écran, et
> **captures réelles** de 47 états d'écran dans Storybook (Playwright + Edge, 390 × 844 et 1280 × 900),
> en deux polices : la Sugo Pro Display d'essai (ce que Jérôme voit dans Storybook) et Anton seule (ce
> que la production affiche). Mesures dans le navigateur (styles calculés), contrastes calculés
> (formule WCAG, couleurs de la charte).
>
> **Statut : proposition (`brouillon`).** Les items qui dépendent d'un arbitrage `D…` encore ouvert au
> §5 ne s'appliquent pas tant que Jérôme n'a pas tranché.
>
> **Révision du 2026-10-02 — tuiles carrées** (Jérôme : « je les veux carrées, coins arrondis à 16 px ;
> le reste ne change pas »). Les tuiles de l'accueil, base de tout le plan, étaient plus hautes que
> larges (`aspect-[20/21]`) et arrondies à ≈ 24 px. Elles sont désormais **carrées, arrondies à 16 px
> fixes**, appliqué sur l'accueil (`SeccionPortada.tsx`, voiles de `FilaPortada.tsx`). Largeurs,
> cartouche, bulles, conteneur marine et son arrondi : inchangés. Le plan entier se réfère à cette
> tuile (§0 règles 6-7, §2.3, §3.4, T10, S3, S4, P2, §9.2).

## Sommaire et statut

| # | Section | Pour qui |
|---|---|---|
| 0 | **Contrat compact** — règles, invariants, carte des items (à lire seul avant d'appliquer un item) | IA, dev |
| 1 | Mode d'emploi — un item, un lot, un écran ; modèles de demandes | Jérôme, IA |
| 2 | Analyse détaillée de l'accueil — chaque élément visuel modifié, ses valeurs, son rendu | tous |
| 3 | Le style Hifago — les règles transposables (couleurs, typo, formes, composants, mise en page) | tous |
| 4 | Constats sur les autres écrans — ce qui détonne, mesuré | tous |
| 5 | Arbitrages pour Jérôme (`D1`…`D16`) | Jérôme |
| 6 | Les items, un par un (`F`, `C`, `S`, `P`, `A`, `G`) | IA, dev |
| 7 | Ordre conseillé, lots, et chemin minimal par page | Jérôme, IA |
| 8 | Inventaire écrans → fichiers → stories → e2e | IA, dev |
| 9 | Annexes — contrastes, mesures, titres en dur | IA, dev |
| 10 | Suivi des items (à cocher) | tous |

## 0. Contrat compact (pour appliquer un item — lire seul, sans le reste)

**Objet** : appliquer à toute la vitrine le style de l'accueil, sans rien retirer de la lisibilité, du
SEO ni de la conversion. Chaque changement est un item du §6 ; ce §0 donne les règles communes.

### Appliquer un item
- Demande type : `/hifago-charte P3`, ou « applique les items F1 à F4 du plan
  `docs/specs/41-charte-hifago-toute-la-vitrine.md` ».
- Lire ce §0, puis l'item : `grep -n '^#### P3 ' docs/specs/41-charte-hifago-toute-la-vitrine.md`
  donne la ligne, Read avec `offset`. Lire aussi les items dont il dépend (colonne « Dépend de »).
- Un item dont l'arbitrage `D…` est encore **ouvert** au §5 ne s'applique pas : le dire, s'arrêter.
- Rendu **avant** l'item, puis **après**, à 390 et 1280 px (`/hifago-rendu`). Juger sur la capture,
  jamais sur la lecture du code.
- Rien n'est commité sans demande. En fin d'item : cocher le §10, ajouter une entrée au journal.

### Les douze règles du style (détail et justification au §3)
1. **Deux couleurs maîtresses** : l'**or** `#ddae09` (aplats de marque, fonds de navigation, CTA) et le
   **marine** `#132f61` (texte, rails de photos, bordures). Le **bleu poudre** `#b6cde8` accompagne
   (recherche, actions secondaires, puces). Le **bleu moyen** `#2a618e` : liens, focus et champs sur
   fond clair **seulement**. Le **bleu ciel** `#619ccc` : décor uniquement.
2. **Trois surfaces**, chacune avec ses jetons (item F3) : **or** (accueil, index, catégories,
   bandeaux), **clair** `--background` (lecture et transaction), **marine** (rails, pied de page).
   Sur l'or : texte marine, jamais de bleu moyen (3,17:1), jamais de blanc (2,07:1). Sur le marine :
   blanc, bleu poudre ou or (6,31:1).
3. **Typographie par rôle** (F1) : slogan en Poppins 800 serré (accueil seul) ; titres de page et de
   section en **police de titre** (Sugo Display, Anton en production), graisse 400, interlettrage
   `--tracking-titre` ; titres de bloc en **Anton** ; tout le reste en **Poppins**. Jamais la police
   de titre sous 20 px, jamais de faux gras.
4. **Le titre à point** : titre + point (bleu poudre sur or, or sur clair et sur marine) + trait marine
   sous les titres de section. C'est la signature des titres de rubrique.
5. **Le rail marine** : conteneur marine arrondi qui épouse ses tuiles, motif bleu derrière, voiles
   flous aux bords, lien « GO → ». Une rangée d'offres est un rail.
6. **La tuile photo** : une photo **carrée**, arrondie à **16 px** (fixes, quelle que soit sa largeur) ;
   un cartouche blanc bleuté en bas (nom en Poppins 700 majuscules sur 2 lignes, établissement
   dessous) ; des bulles blanches cerclées pour le prix. Jamais de texte nu sur une photo.
7. **Formes** : un seul rayon pour les boutons rectangulaires (D4) ; la pilule pour la recherche, les
   puces et les bulles ; conteneurs ≈ 16 px ; tuiles 16 px. Pas d'ombre, sauf le header défilé et
   ce qui flotte (popover, toast). ⚠️ Un rayon en px s'écrit en valeur fixe (`rounded-[16px]`) :
   l'échelle `rounded-*` dérive de `--radius` (4 px), et `rounded-2xl` rend **8 px** (§3.4).
8. **Une seule colonne**, celle de l'accueil (`COLUMNA_PORTADA` : 1 024 px gouttières comprises) pour
   le header, les bandeaux, le contenu et le pied de page.
9. **Chaque page intérieure s'ouvre sur un bandeau or** (fil d'Ariane, H1, chapô, recherche ou CTA)
   sous le header or.
10. **Actions** : CTA principal **or + texte marine** sur fond clair, **marine + texte blanc** sur fond or ;
    secondaire **bleu poudre** ; 44 px de haut au minimum, 48 px pour les CTA de conversion.
11. **Illustrations et motifs décoratifs** (`alt=""`, `aria-hidden`), jamais en `background-repeat`
    (bords non raccordables, mesuré), jamais l'image LCP hors de l'accueil.
12. **Mouvement sobre** : zoom 1,05 des photos au survol, flèche qui glisse, voiles de bord ; tout est
    coupé sous `prefers-reduced-motion`.

### Invariants (ne jamais casser — détail §3.8)
- Un seul `<h1>`, **visible**, par page ; hiérarchie sans saut ; le niveau ne dicte pas l'apparence
  (`Title as=… size=…`).
- Rien de masqué selon la largeur (sauf le décor) ; aucune page ne défile horizontalement, à 360 px
  comme à 390 px.
- Contrastes : texte ≥ 4,5:1, composants ≥ 3:1, **mesurés** dans `Playground/Palette → Contrastes`
  dès qu'un jeton change.
- Jetons seulement (`scripts/check-tokens.sh`) ; aucune nouvelle dépendance ; HeroUI via `@hifago/ui`.
- Frontière RSC : aucun `page.tsx` ni composant serveur n'importe `@hifago/ui`, même `cn`
  (`scripts/check-design-system.sh`, `.claude/rules/apps.md`).
- i18n : tout texte via next-intl, en `es` **et** en `en` ; liens internes via `@/i18n/navigation`.
- SEO : JSON-LD, canonical et `hreflang` intacts ; fil d'Ariane visible = JSON-LD ; `next/image` avec
  `alt` et `sizes` ; une seule image `priority` par page (le LCP).
- Les `data-testid` existants sont conservés : e2e et stories en dépendent.
- Les réglages de l'accueil déjà validés par Jérôme (journal du 01 au 02/10) ne se rouvrent pas ici :
  un item qui touche l'accueil doit le rendre **au pixel près** identique, sauf mention contraire.

### Carte des items (détail au §6, ordre au §7)
| ID | Item | Dépend de | Arbitrage | Effort |
|---|---|---|---|---|
| F1 | Rôles typographiques et échelle de tailles (jetons) | — | D5 | M |
| F2 | `Title` réécrit par rôles ; les 17 titres en dur remplacés | F1 | — | M |
| F3 | Surfaces or / clair / marine : jetons redéfinis par contexte | — | D1, D9 | M |
| F4 | Boutons : rayon unique, 44/48 px, couleur pour fond or | F3 | D4 | M |
| F5 | Storybook : Sugo d'essai retirée, police de production (révisé après D5 = B) | — | — | S |
| F6 | Cartes de contenu : fin des bordures imbriquées | — | — | S |
| F7 | Gabarit : une colonne (celle de l'accueil) pour toutes les pages | — | — | M |
| C1 | Header unique, or, aligné sur celui de l'accueil | F3 F4 F7 A1 | D2 | L |
| C2 | Pied de page marine | F3 F7 | D3 | M |
| C3 | Fil d'Ariane : style, et plus de débordement à 390 px | F3 | — | S |
| C4 | Lien retour et toasts : finitions | F3 | — | S |
| S1 | `TituloRubrica` : le titre à point de l'accueil, extrait | F1 | D15 | S |
| S2 | `BandeauPagina` : le bandeau or des pages intérieures | S1 F3 F7 C3 | D1 | M |
| S3 | `SeccionRiel` : le rail de l'accueil, réutilisable | S1 S4 S5 | D7 | L |
| S4 | Tuile photo unique (les cartes de listing deviennent celles de l'accueil) | — | D6 | M |
| S5 | `EnlaceGo` : le « GO → » extrait | F3 | — | S |
| S6 | `Aviso` : encadré info, succès, alerte, erreur | F3 | — | S |
| S7 | Puce de statut (commande, ligne, édition, gratuit) | F3 | — | S |
| S8 | État vide illustré, avec action | S1 | — | S |
| S9 | Carrousel photo : flèches et points visibles | — | D6 | S |
| S10 | Calendrier à la charte, et en espagnol | F3 | — | M |
| S11 | Champs de formulaire à la charte (48 px) | F3 F4 | D4 | S |
| P1 | Index par type (`/actividades`, `/alojamientos`…) | S2 S3 | D1 D7 D14 | M |
| P2 | Page de catégorie (`/[type]/[categoria]`) | S2 S4 S8 | D1 | M |
| P3 | Fiche produit | S2 S4 S6 S9 S10 S11 | D10 | L |
| P4 | Fiche établissement | S2 S3 S9 | — | M |
| P5 | Mi viaje | S2 S6 S8 F6 | D11 | M |
| P6 | Pago | S2 S6 S11 F6 | D11 | M |
| P7 | Résultat de réservation | S2 S6 S7 F6 | — | M |
| P8 | Mis reservas | S2 S6 S7 S8 F6 | — | M |
| P9 | Mi perfil | S2 S6 S11 | — | S |
| P10 | Authentification (5 écrans) | S11 F4 A1 | D12 | M |
| P11 | 404 et écrans d'erreur | S1 F4 | D13 | S |
| P12 | Accueil : résidus (contraste, vocabulaire, pied) | F3 C2 | D3 D8 | S |
| A1–A7 | Assets : logo sur or, favicon, image de partage, Sugo, logo large, découpes, ménage | — | D5 | S–M |
| G1–G5 | Garde-fous : `check-charte.sh`, `ui.md`, README, planche de référence, ménage | — | — | S–M |

### Terminé veut dire
Vitest des fichiers touchés vert · `tsc --noEmit` et `eslint` propres ·
`scripts/check-{tokens,design-system,seo,i18n-links,data-layer}.sh` verts · rendu **regardé** à 390
et 1280 px, en police de production (Anton) **et** dans Storybook · aucune page qui défile
horizontalement · `data-testid` intacts · item coché au §10 · entrée au journal du mois.

## 1. Mode d'emploi

### 1.1 Trois façons de s'en servir

| Je veux… | Je demande | Ce que fait l'IA |
|---|---|---|
| changer **un seul élément** | `/hifago-charte S5` | applique l'item S5 seul, montre avant/après |
| refaire **une page** | `/hifago-charte page fiche-produit` | applique le chemin minimal de la page (§7.3), item par item, en s'arrêtant entre chaque |
| avancer **par lot** | `/hifago-charte lot 2` | applique les items du lot (§7.2) dans l'ordre, une vérification par item |
| savoir **où on en est** | `/hifago-charte etat` | lit le §10 et le journal, liste fait / à faire / bloqué par un arbitrage |
| **auditer** un écran | `/hifago-charte audit mi-viaje` | confronte l'écran aux douze règles du §0, rend un constat item par item |
| trancher un **arbitrage** | « D4 : 8 px » | inscrit la décision au §5 (date, choix), débloque les items qui en dépendent |

Sans le skill, la même demande marche en toutes lettres (modèles au §1.3) : le plan est fait pour
qu'une IA sans contexte n'ait besoin que de lui.

### 1.2 Ce qu'il faut savoir avant de regarder un rendu
- **Storybook** (`npm run storybook -w @hifago/web`, http://localhost:6006) rend chaque écran dans
  chacun de ses états, sans Docker. C'est là qu'on juge (`Écrans/…`, `Parcours/…`).
- ⚠️ La barre d'outils **mémorise la piste** : vérifier « La charte Hifago 2026 — la production »
  (sinon on juge une autre palette).
- **Une seule police de titre : Anton** (D5 = B, 2026-10-02). Jusqu'à F5, Storybook chargeait sur la
  machine de Jérôme la **Sugo Pro Display d'essai** (hors dépôt, licence non commerciale), qui n'a ni
  la chasse ni la hauteur d'Anton et remplaçait les chiffres par des glyphes de filigrane (« Reserva
  HFG-▓▓▓ »). F5 l'a retirée : Storybook affiche la police de production. Les captures de ce plan
  prises « en Sugo » (§2, §4) datent d'avant ; un Storybook lancé avant F5 doit être **redémarré**
  pour ne plus la charger.

### 1.3 Modèles de demande (à copier)

**Un item :**
> Applique l'item `P5` du plan `docs/specs/41-charte-hifago-toute-la-vitrine.md`. Lis d'abord sa §0,
> puis l'item et ses dépendances. Montre-moi le rendu avant/après à 390 et 1280 px (police de
> production aussi) avant de dire que c'est fini. Ne commite pas.

**Une page entière :**
> Refais la page « fiche produit » selon le plan `docs/specs/41-…`, chemin minimal du §7.3. Un item à
> la fois, rendu après chacun, et attends mon accord avant de passer au suivant.

**Un arbitrage :**
> Pour le plan `docs/specs/41-…` : D2 = header or sur toutes les pages ; D4 = 8 px. Inscris-le au §5
> et dis-moi quels items sont débloqués.

**Un audit :**
> Audite l'écran « Pago » contre les douze règles du §0 du plan `docs/specs/41-…` ; pour chaque
> écart, cite l'item qui le corrige, ou propose-en un s'il manque.

### 1.4 Ce que le plan ne fait pas
- Il ne rouvre aucune décision de l'accueil validée par Jérôme (logo, héros, tailles en `cqw`,
  décalages mobiles, menu à 34 px, bouton « Mi viaje »…). Les arbitrages déjà ouverts sur l'accueil
  restent au backlog (« Héros de l'accueil, seconde maquette »).
- Il ne change aucun comportement métier (réservation, paiement, panier, données). Quand une
  proposition visuelle frôle le fonctionnel (barre CTA collante, récapitulatif repliable), elle est
  marquée comme arbitrage.
- Il ne touche pas l'admin (`apps/admin`, thème `admin`, spec 09) : uniquement le thème `vitrine`.
  Toute modification de `packages/ui` doit rester **additive** (le carrousel sert aussi
  `apps/admin/components/catalog-card.tsx`).

## 2. Analyse détaillée de l'accueil — la référence

### 2.1 Les sources du style
| Source | Contenu | Où |
|---|---|---|
| **Charte graphique Hifago 2026** (PDF, 9 pages, fournie le 2026-10-01) | Logo « hifa GO · Guatapé » en trois déclinaisons (sur bleu poudre, sur or, sur marine) ; typo par emploi : **Garet** (logo), **Sugo Display** (titre), **Anton** (sous-titre), **Poppins** (corps de texte) ; cinq couleurs : or `#ddae09`, bleu poudre `#b6cde8`, bleu ciel `#619ccc`, bleu moyen `#2a618e`, marine `#132f61` ; le motif « micelio » en or, bleu et bleu clair ; mises en situation (abribus, casquette, t-shirt). | `../Charte Graphique/` (hors dépôt) |
| **Maquette de l'accueil** (2026-10-01) | Fond or plein ; drapeaux ESP / ING ; grand logo ; rue aux zócalos en filigrane ; menu « Actividades • Alojamiento • Transporte • Retiros • Eventos » ; recherche bleu poudre ; par type : titre à point + trait + motif + conteneur marine de 3 photos + « GO → ». | `../Assets/mockup page accueil.jpeg` |
| **Seconde maquette du héros** (2026-10-02) | « Guatapé merece más de un día. / Arma tu viaje y vívelo a tu ritmo. » | journal 2026-10-02 (suite 2) |
| **Référence « PROJETS À LA UNE »** (ateliercestparla.com, 2026-10-01) | Bande titre défilante, cartes carrées texte sur photo. ⚠️ Première passe de l'accueil, **remplacée sur l'accueil** par la maquette, mais **toujours en ligne sur les index par type** (§4, T9). | journal 2026-10-01 (suite 2) |
| **Référence « La Comète Argentique »** (2026-10-02) | Cartouche blanc légèrement bleuté sous le nom, bulles blanches au-dessus. | journal 2026-10-02 |
| Commits | `1009eda` (charte appliquée, 59 fichiers) puis `c3042e6` (seconde maquette, cartes, mobile, 28 fichiers). | branche `feat/charte-graphique-vitrine` |

### 2.2 Ce que montre le rendu (capturé le 2026-10-02)
**À 1 280 px**, de haut en bas, tout sur l'or :
1. header sans fond : drapeaux « ESP · ING » à gauche, bouton bleu poudre « Mi viaje en Guatapé » et
   icône du compte à droite ;
2. le héros : grand logo à gauche, la rue aux zócalos dessinée en bleu qui sort de l'écran à droite,
   le titre « Guatapé merece / más de un día. » très gras et serré, puis le sous-titre ;
3. le menu des cinq types séparés par des points, la barre de recherche en pilule bleu poudre, et
   les puces « Fechas » et « Personas » ;
4. cinq sections, une par type. Chacune a :
   - un grand titre condensé suivi d'un point bleu poudre, souligné d'un trait marine ;
   - le motif bleu qui dépasse en haut à gauche ;
   - un conteneur marine aux angles arrondis, avec trois photos carrées à cartouche et bulle de prix,
     et un voile flou au bord droit ;
   - « GO → » aligné à droite ;
5. le pied de page, **clair** (bleu-gris très pâle), sous l'or.

**À 390 px** : une seule photo par section, centrée. Le haut du héros est descendu. Le menu tient sur
deux lignes resserrées. Le bouton « Mi viaje » est en contour bleu moyen.

### 2.3 Élément par élément
Les tailles « cqw » sont des pourcentages de la **colonne** (conteneur de requête) : 960 px de
contenu à partir de 1 024 px d'écran. C'est ce qui rend la maquette à l'identique à toute largeur.

| # | Élément | Ce qu'on voit | Valeurs exactes (desktop / mobile) | Fichier | Transposable ? |
|---|---|---|---|---|---|
| 1 | **Thème = la charte** | Couleurs de la charte partout, cartes à bordure marine sans ombre | `--accent` or `oklch(77.2% 0.156 88.9)` ; `--accent-foreground` marine ; `--default` bleu poudre ; `--link`/`--focus`/`--field-border`/`--muted` bleu moyen ; `--foreground` et `--border` marine ; `--background` `oklch(97% 0.01 247)` (blanc bleuté) ; `--surface` blanc ; `--radius` 4 px ; `--surface-shadow: none` ; `--charte-*` (les 5 couleurs brutes) | `packages/ui/src/styles/globals.css`, section « LA CHARTE » (l. ~980-1187) | **Oui**, c'est déjà global |
| 2 | **Polices** | Poppins partout, police de titre condensée sur les titres | `--font-sans` Poppins (300→800) ; `--font-titre` Anton (Sugo d'essai dans Storybook) ; `--font-sous-titre` Anton ; `--tracking-titre` 0,0667 em ; règle de base : `h1, h2, h3` en police de titre, graisse 400 | `globals.css` l. ~501 et ~1142-1168 ; `app/[locale]/layout.tsx` ; `.storybook/preview-head.html` | **Oui**, mais la règle « tout h1-h3 en police de titre » pose problème ailleurs (§4, T2-T3) |
| 3 | **Fond or plein** | Toute la page or, header compris, sans bande claire | `<PageShell variant="portada" fondo="acento">` pose `data-fondo="acento"` ; `globals.css` : `body:has(main[data-fondo="acento"]) { background: var(--accent); color: var(--accent-foreground) }` | `components/atoms/PageShell.tsx`, `globals.css` « FOND OR » | **Oui** pour les pages de navigation (D1) ; les jetons « discrets » ne sont pas redéfinis sur l'or (défaut, §2.5) |
| 4 | **Header transparent** | Sans fond en haut de page ; or + ombre marine douce après 8 px de défilement | `fixed inset-x-0 top-0 z-50`, `h-16`, colonne `COLUMNA_PORTADA` ; défilé : `bg-accent shadow-[0_8px_16px_-12px_…marine 60 %]` ; pas de logo | `components/organisms/SiteHeader.tsx` (`transparente`), choisi par `CoquillaVitrine` (`usePathname() === "/"`) | La **version défilée** (or) devient le header de toutes les pages (C1) |
| 5 | **Langues en drapeaux** | « 🇪🇸 ESP  🇬🇧 ING » en Anton | Anton 16 px, drapeaux SVG 24 × 16, cible 44 px ; sous `md`, seule l'autre langue | `components/organisms/LanguageSwitcher.tsx` (`apariencia="banderas"`) | **Oui** (C1) |
| 6 | **Bouton « Mi viaje »** | Desktop : aplat bleu poudre, angles 8 px, « Mi viaje en Guatapé » ; mobile : contour bleu moyen, angles 4 px, « Mi viaje » | `LinkButton` `outline neutral` + `BOUTON_VIAJE_DESKTOP` (variables du `solid`, `rounded-[calc(var(--radius)*2)]` à partir de `md`) ; pastille de compte or | `SiteHeader.tsx` | **Oui** : même bouton partout (C1) ; les pages intérieures ont encore un `soft` or pâle à 4 px |
| 7 | **Compte** | Icône seule | `IconLink`, 44 px | `SiteHeader.tsx` | Oui |
| 8 | **Illustration de la rue** | Rue aux zócalos en traits bleus, à droite, qui sort de l'écran | `public/brand/calle-zocalos.webp` (1536 × 1024, 401 Ko) ; `w-[61.3%] max-w-[49rem] translate-x-[13%] translate-y-[16.6%]`, fondu haut 14 % (7 % mobile) ; mobile : `top-[50px] right-[10px] scale-[1.042]` ; `priority` (c'est le LCP) ; décorative | `app/[locale]/(vitrine)/PortadaInicio.tsx` | **En partie** : auth et 404 (P10, P11), en version allégée (A6). Jamais LCP ailleurs |
| 9 | **Grand logo** | Logo marine + bleu ciel (déclinaison **sans or**, l'or disparaîtrait sur l'or) | `public/brand/logo-portada.webp` (900 × 483) ; `w-[26cqw] min-w-[8.5rem]` (250 px à 1 280, ≥ 136 px) ; décoratif, hors du `<h1>` | `PortadaInicio.tsx` | Auth (P10) seulement |
| 10 | **Titre `<h1>`** | « Guatapé merece / más de un día. » très gras, serré | **Poppins 800**, interlettrage −0,04 em, interligne 1,11 ; `clamp(2.125rem, 5.79cqw, 3.5rem)` (55,6 px à 1 280) ; mobile : 5 px de moins (29 px à 390) ; coupure par `\n` + `whitespace-pre-line` ; clé `HomePage.h1` | `PortadaInicio.tsx`, `messages/{es,en}/HomePage.json` | **Non** : le slogan est propre à l'accueil. Les H1 intérieurs prennent la police de titre (F1) |
| 11 | **Sous-titre** | « Arma tu viaje y vívelo / a tu ritmo. » | Poppins 400, `clamp(1.375rem, 3.94cqw, 2.5rem)` (37,8 px à 1 280) ; mobile 18 px ; interligne 1,22 ; clé `HomePage.lema` | `PortadaInicio.tsx` | Le **chapô** des bandeaux en reprend l'esprit (Poppins 18 → 22 px) |
| 12 | **Menu des types** | « Actividades • Alojamiento • Transporte • Retiros • Eventos » | Poppins 400, `clamp(1rem, 3.35cqw, 1.75rem)` (16 à 28 px) ; points `size-[0.2em]` ; liens 44 px (desktop) / **34 px sous `md`**, exception documentée ; soulignés au survol | `app/[locale]/(vitrine)/MenuTiposPortada.tsx`, `tiposDeBarra.ts` | Réutilisable sur la 404 (P11) |
| 13 | **Barre de recherche** | Pilule bleu poudre, loupe, « ¿Qué buscas en Guatapé? » en Anton | `rounded-full bg-[var(--default)]` 44 px ; texte et placeholder Anton (`--font-sous-titre`) 16 / 18 px marine | `components/organisms/SearchBar.tsx` via `BuscadorInicio` | **Déjà partagée** (index, catégories) |
| 14 | **Puces Fechas / Personas** | Texte Poppins + pastille ronde bleu poudre portant l'icône | Boutons pilule 44 px, pastille 24 px `bg-[var(--default)]`, glyphe blanc (décoratif) | `components/molecules/{DateRangeField,PeopleField}.tsx` | Déjà partagées |
| 15 | **Titre de section à point** | « Actividades● » très grand, condensé | Police de titre ; `clamp(1.75rem, 6.3cqw, 3.75rem)` (28 → 60 px) ; `leading-none` ; interlettrage `--tracking-titre` ; point `size-[0.3em]` bleu poudre, `ml-[0.14em]`, posé sur la ligne de base, décoratif | `app/[locale]/(vitrine)/SeccionPortada.tsx` | **Oui** : c'est la signature (S1) |
| 16 | **Trait** | Ligne marine sous le titre | `h-[clamp(2px,0.5cqw,4px)] w-[68cqw] bg-current`, `mt-[0.8cqw]` | `SeccionPortada.tsx` | **Oui** (S1) |
| 17 | **Motif bleu** | Tracés « micelio » bleus qui débordent en haut et à gauche du conteneur | `public/brand/motif-bleu-section.webp` (bleu `#3c90d4`, tiré de `fond micelio.png`) ; `w-[68cqw]`, hauteur du ratio − 18 px, `background-position: 0 -7px` ; en fond CSS, décoratif ; **jamais répété** | `SeccionPortada.tsx` | **Oui** (S3) |
| 18 | **Conteneur marine** | Bloc marine arrondi qui épouse ses photos | `bg-[var(--accent-foreground)]` ; décalé `ml-[7.5cqw]` ; `w-fit max-w-[92.5cqw]` (85 cqw sous `md`) ; marge intérieure 1,3 cqw (12,5 px) ; rayon 1,4 cqw (13 px) desktop, 4,02 cqw mobile (14 px à 390) — **inchangé** par les tuiles carrées, il n'est donc plus proportionnel à leur arrondi (13-14 px autour de 16) | `SeccionPortada.tsx` | **Oui** (S3) |
| 19 | **Rangée + voiles** | Défilement horizontal sans barre, aimanté ; voile flou marine au bord où il reste des photos | `snap-x snap-mandatory gap-[1.9cqw]` ; voiles `w-[6cqw]` (8 cqw mobile), `backdrop-blur-sm`, dégradé marine/50 masqué ; allumés seulement du côté à découvrir ; arrondis côté bord à **16 px**, comme la tuile qu'ils recouvrent (test `SeccionPortada.test.tsx`) | `app/[locale]/(vitrine)/FilaPortada.tsx` (client), hook `useBordesDesplazables` | **Oui** (S3) |
| 20 | **Tuile photo** | Photo **carrée**, arrondie à 16 px, zoom doux au survol | Largeur 28,69 cqw (275 px) / 82,39 cqw mobile (288 px à 390) ; **`aspect-square`** (275 × 275 à 1 280, 288 × 288 à 390) ; rayon **16 px fixes** (`rounded-[16px]`, jamais `rounded-2xl` qui rend 8 px), le seul réglage de la tuile qui n'est pas en `cqw` ; fond bleu poudre sans photo ; **première photo seule** ; survol `scale-105` 300 ms (coupé en mouvement réduit). Avant le 2026-10-02 : `aspect-[20/21]` (275 × 289) et 8,37 cqw de tuile (≈ 23 px) | `SeccionPortada.tsx` (`Tesela`) | **Oui** : modèle unique de carte photo (S4) |
| 21 | **Cartouche** | Étiquette blanc bleuté en bas de photo : NOM en majuscules, établissement dessous | `bg-[var(--background)]` ; rayon 4,88 cqw (13 px) ; centré ; nom **Poppins 700 majuscules**, 2 lignes, `clamp(0.6875rem, 5.23cqw, 1rem)` (≈ 14,4 px) ; établissement Poppins 500, 1 ligne, ≈ 11,5 px | `SeccionPortada.tsx` | **Oui** (S4) — surveiller la taille de l'établissement (≥ 12 px) |
| 22 | **Bulles** | Pastille de prix blanche cerclée, fond sombre translucide | `rounded-full border-[1.5px] border-white bg-black/55 backdrop-blur-sm`, Poppins 700 majuscules blanc ≈ 11 px ; voile à 55 % = 4,74:1 au pire (photo blanche) ; 4 formes de prix (montant, « Desde », texte libre tel quel, rien) | `SeccionPortada.tsx`, `components/atoms/Card.tsx` (`OVERLAY_BULLES_CLASS`) | **Oui** (S4) |
| 23 | **Lien pleine tuile** | Toute la tuile est cliquable, nom accessible = nom de l'offre | Lien sur le nom, `::after` étiré sur la tuile ; anneau de focus **or**, intérieur, 4 px | `SeccionPortada.tsx` | **Oui** (S4) |
| 24 | **« GO → »** | « GO » du logo + flèche bleu poudre, sous le conteneur, à droite | `public/brand/go.webp` (214 × 116) ; hauteur `clamp(1.75rem,5.1cqw,3.25rem)` ; flèche SVG 40 × 24, trait 4,5, bleu poudre ; survol : GO ×1,05, flèche +4 px ; nom accessible « GO Más actividades » (`sr-only`) ; 44 px | `SeccionPortada.tsx` | **Oui** (S5) |
| 25 | **Rythme** | Grands blancs (d'or) entre sections | Entre sections `clamp(2rem, 6cqw, 4.5rem)` (32 → 72 px) ; bas de page `clamp(3rem, 12cqw, 7rem)` | `app/[locale]/(vitrine)/page.tsx` | **Oui** (§3.5) |
| 26 | **Colonne** | Tout aligné : drapeaux, logo, titres, conteneurs | `COLUMNA_PORTADA = "mx-auto w-full max-w-5xl px-5 sm:px-8"` (960 px de contenu) | `PageShell.tsx` (exportée) | **Oui** : la colonne de tout le site (F7) |
| 27 | **Pied de page** | **Inchangé** : bloc clair bleu-gris sous l'or | `bg-[var(--surface-tertiary)]`, bordure haute marine, colonne `max-w-3xl` ; « Escríbenos por WhatsApp » en contour ; langue en menu déroulant ; « Hifago · Guatapé, Colombia » 12 px | `components/organisms/SiteFooter.tsx` | À refaire (C2, D3) |

### 2.4 Les retouches propres au mobile (à ne pas reproduire ailleurs)
Elles répondent à des demandes précises de Jérôme sur l'accueil et sont toutes commentées dans le code :
- le haut du héros (logo, titre, sous-titre) est descendu de 60 px, et la rue de 50 px. Le menu
  reprend la différence pour que la recherche ne bouge pas (`DESCENSO_MOVIL`) ;
- le titre fait 5 px de moins et le sous-titre 18 px fixes ;
- les liens du menu font 34 px de haut au lieu de 44 px : c'est une exception assumée à la règle des
  44 px, réservée à ce menu ;
- il y a une seule tuile par section, centrée (82,39 cqw) ;
- la pointe du « GO → » est alignée sur le bord de la photo ;
- le bouton « Mi viaje » est en contour, à 4 px.

**Ces réglages au pixel ne se transposent pas** : sur les autres pages, on applique les règles du
§3, pas ces décalages.

### 2.5 Ce qui reste perfectible sur l'accueil (mesuré)
- ❌ **Texte « discret » illisible sur l'or.** `--muted` vaut le bleu moyen partout, or on l'utilise
  sur l'or. Exemple : la description de l'état vide « Prueba con otras fechas… » (14 px) est en
  `oklch(0.477 0.093 246.2)` sur l'or, soit **3,17:1** pour 4,5:1 requis. Même chose pour le message
  d'état de la recherche (`role="status"`). Corrigé par **F3** (puis vérifié par **P12**).
- ⚠️ **Le pied de page clair** ferme mal une page entièrement or (point déjà ouvert au backlog,
  « Charte (f) »). Traité par **C2** et **D3**.
- ⚠️ **Petits textes de la tuile** : établissement ≈ 11,5 px, bulle ≈ 11 px. C'est acceptable pour
  des libellés secondaires, mais plancher à 12 px sur toute nouvelle tuile (**S4**).
- ⚠️ **Vocabulaire** : le menu dit « Alojamiento », « Retiros ». Les pages qu'il ouvre disent
  « Alojamientos », « Camps » (titre, fil d'Ariane, « Más camps »). Traité par **D8** et **P12**.
- ℹ️ La pilule de recherche bleu poudre sur l'or ne contraste qu'à 1,27:1 par ses bords. C'est
  acceptable parce que la loupe et le texte marine (8,02:1) l'identifient (WCAG 1.4.11). Ne pas
  retirer la loupe.
- ℹ️ La story `Écrans/Accueil → « fond marine, cartes or »` est une **maquette de couleur** (CSS injecté
  dans la story), sans effet en production. Elle reste un playground. Elle sort du plan, sauf décision
  contraire de Jérôme.
- ℹ️ Les composants de l'accueil (`SeccionPortada`, `FilaPortada`, `MenuTiposPortada`) sont
  **colocalisés** dans `app/[locale]/(vitrine)/` : ils ne sont pas encore réutilisables par les autres
  pages. La règle veut qu'un composant ne remonte dans `components/` qu'une fois prouvé utile à deux
  endroits. C'est exactement ce que font **S1, S3 et S5**.

### 2.6 Le même écran, police de production contre Storybook
Les captures prises en bloquant la Sugo d'essai, c'est-à-dire **ce que la production affiche**,
montrent des titres de section en Anton : plus hauts, plus étroits, plus espacés (le `--tracking-titre`
de 0,0667 em a été réglé à l'œil sur Sugo). Le reste ne bouge pas : héros, menu, recherche et tuiles
sont en Poppins.

Conséquences :
1. tant que D5 n'est pas tranché, tout réglage d'un titre se juge **dans les deux polices** ;
2. si Anton est confirmé, réévaluer `--tracking-titre` (il a été choisi pour Sugo) ;
3. les chiffres de la Sugo d'essai sont illisibles (glyphes de filigrane), voir F5.

## 3. Le style Hifago — les règles transposables

Ce paragraphe est la « grammaire » tirée de la charte et de l'accueil. Les items du §6 l'appliquent ;
une page nouvelle (ou un écran futur) s'écrit directement avec elle.

### 3.1 Les cinq couleurs et leur rôle
| Couleur | Hex | Jeton(s) | Rôle | Ne jamais |
|---|---|---|---|---|
| **Or** | `#ddae09` | `--accent`, `--charte-or` | Fond des pages de navigation et des bandeaux ; bouton principal sur fond clair ; point des titres sur fond clair ou marine ; texte **sur marine uniquement** | porter du texte sur fond clair (1,91:1), porter du blanc (2,07:1) |
| **Marine** | `#132f61` | `--foreground`, `--border`, `--accent-foreground`, `--charte-marine` | Tout le texte sur clair et sur or ; rails de photos ; pied de page ; bordure des cartes ; bouton principal sur fond or | — |
| **Bleu poudre** | `#b6cde8` | `--default`, `--charte-bleu-poudre` | Recherche, bouton secondaire (« Mi viaje »), puces, point des titres sur or, flèche du « GO » sur or, texte discret sur marine | servir de texte sur fond clair (≈ 1,4:1) |
| **Bleu moyen** | `#2a618e` | `--link`, `--focus`, `--field-border`, `--muted`, `--field-placeholder` | Liens, focus, bordures de champ, texte discret — **sur fond clair seulement** (6,05:1) | servir sur l'or (3,17:1) ou sur le marine (1,99:1) |
| **Bleu ciel** | `#619ccc` | `--charte-bleu-ciel` | Décor : logo, motif, illustrations | identifier un composant (2,71:1 sur clair) |

Les trois couleurs d'état (succès `#09672e`, alerte `#b44a00`, erreur `#a80034`, valeurs du thème)
passent sur blanc (7,02 / 5,36 / 7,74:1) **mais échouent sur l'or** (3,39 / 2,58 / 3,73:1). Elles ne
s'affichent donc jamais nues sur l'or : toujours dans un encadré blanc (`Aviso`, S6).

### 3.2 Les trois surfaces
Une **surface** est un fond, et les jetons qui vont avec. Un composant posé dessus n'a rien à savoir :
c'est la surface qui redéfinit les jetons pour tout ce qu'elle contient (item F3).

| Jeton, rôle | **Or** (navigation, bandeaux) | **Clair** (lecture, transaction) — défaut actuel | **Marine** (rails, pied de page) |
|---|---|---|---|
| Fond | or `--accent` | `--background` (`#f0f6fc`), cartes `--surface` blanc | marine |
| Texte | marine (6,31:1) | marine (12,04:1) | blanc (13,07:1) |
| Texte discret (`--muted`) | **marine** — la hiérarchie se fait par taille et graisse, pas par couleur | bleu moyen (6,05:1) | bleu poudre (8,02:1) |
| Lien (`--link`) | marine, **toujours souligné** (même couleur que le texte : WCAG 1.4.1) | bleu moyen | or (6,31:1), souligné |
| Focus (`--focus`) | marine | bleu moyen | or |
| Bordure (`--border`) | marine | marine (cartes) / `--separator` (lignes) | bleu poudre à 45 % |
| Champ de saisie | fond blanc, bordure marine | fond blanc, bordure bleu moyen | fond blanc, bordure blanche |
| Bouton principal | **marine + texte blanc** (13,07:1) | **or + texte marine** (6,31:1) | or + texte marine |
| Bouton secondaire | bleu poudre + marine (8,02:1) | bleu poudre + marine, ou contour bleu moyen | contour bleu poudre + texte blanc |
| Point du titre | bleu poudre | or | or |
| Trait sous titre | marine | marine | or |
| Flèche du « GO » | bleu poudre | bleu moyen | — (pas de « GO » sur marine) |
| Message d'état | dans un `Aviso` blanc | couleur d'état sur blanc | dans un `Aviso` blanc |

**Quelle surface pour quelle page** (arbitrage D1, recommandé) :
- **Or plein**, header compris : **pages de navigation**, qui sont faites de titres, de photos et
  d'une recherche. Ce sont l'accueil, les index par type, les pages de catégorie, la 404.
- **Bandeau or + contenu clair** : **pages de lecture et de transaction**, avec du texte long, des
  formulaires, un calendrier et des montants. Ce sont les fiches produit et établissement, Mi viaje,
  Pago, le résultat de réservation, le compte et l'authentification. Le bandeau porte l'identité (fil
  d'Ariane, H1, chapô) ; le contenu garde le confort de lecture et les couleurs d'état lisibles.
- **Marine** : les rails de photos et le pied de page, partout.

Pourquoi pas « tout en or » : le texte discret, les liens, les champs et les messages d'état ont été
conçus pour un fond clair ; sur l'or ils échouent tous (§3.1). Une fiche de 2 000 px de texte et de
formulaires sur l'or fatigue et oblige à redéfinir chaque état. Pourquoi pas « tout clair » : c'est
l'état actuel, et c'est précisément ce qui rend les pages intérieures étrangères à l'accueil.

### 3.3 Typographie par rôle
La charte attribue les polices **par emploi** : Garet pour le logo, Sugo Display pour les titres,
Anton pour les sous-titres, Poppins pour le corps. La règle actuelle attribue la police de titre **par
balise** : tout `h1`, `h2` et `h3` la reçoit, quelle que soit sa taille. C'est ce qui produit des
titres de 14 px illisibles (§4, T3). Échelle cible (item F1) :

| Rôle | Police | Graisse | Taille 390 → 1 280 px | Interligne | Interlettrage | Emploi |
|---|---|---|---|---|---|---|
| `slogan` | Poppins | 800 | 29 → 56 px | 1,11 | −0,04 em | **Accueil seulement** (le H1 du héros) — existant |
| `titre-page` | police de titre | 400 | 32 → 52 px | 1,05 | `--tracking-titre` | H1 des pages intérieures |
| `titre-section` | police de titre | 400 | 26 → 40 px (accueil : 28 → 60, inchangé) | 1,0 | `--tracking-titre` | H2 de rubrique : « Habitaciones● », « Agua● » |
| `titre-bloc` | Anton (`--font-sous-titre`) | 400 | 20 → 22 px | 1,15 | normal | Titre d'un bloc dans une page : « Disponibilidad », « Equipamiento », « El plan, día a día », « Datos de contacto » |
| `etiquette` | Poppins | 600 | 14 → 15 px | 1,3 | normal | En-tête de liste (catégorie d'équipement), libellé de groupe |
| `chapo` | Poppins | 400 | 18 → 22 px | 1,4 | normal | Phrase sous un H1 (bandeau), description de catégorie |
| `corps` | Poppins | 400 | 16 px (17 px sur fiche ≥ `lg`) | 1,55 | normal | Texte courant, limité à 65 caractères par ligne (`max-w-prose`) |
| `meta` | Poppins | 500 | 14 px | 1,4 | normal | Établissement · date · quantité, fil d'Ariane |
| `prix` | Poppins | 700 | 24 → 28 px (fiche), 16 px (lignes) | 1,2 | chiffres tabulaires | Prix et totaux |
| `tuile` | Poppins | 700, majuscules | 13 → 16 px | 1,2 | normal | Nom dans le cartouche d'une tuile ; bulles (11 → 13 px) |

Règles qui vont avec :
- **Jamais de graisse au-dessus de 400 sur la police de titre ni sur Anton.** Anton n'existe qu'en
  400. `font-semibold` fait synthétiser un faux gras par le navigateur : les fûts s'empâtent et les
  contrepoinçons se ferment. Le jour où Sugo est licenciée (D5), déclarer son fichier **Bold à la
  graisse 400**, comme le fait déjà `preview-head.html`.
- **Jamais la police de titre sous 20 px** : en dessous, c'est `titre-bloc` (Anton) ou `etiquette`
  (Poppins).
- **Pas de majuscules forcées** sur les titres (décision du 2026-10-01 : « normal-case ») ; les
  majuscules sont réservées au cartouche des tuiles et aux bulles.
- Les tailles sont des **jetons** (variables CSS du thème, F1), comme `--tracking-titre`, pour se régler
  en un seul endroit.

### 3.4 Formes
| Objet | Rayon | Bordure | Ombre |
|---|---|---|---|
| Bouton rectangulaire (tous) | **un seul rayon**, D4 (recommandé : 8 px = `calc(var(--radius) * 2)`, celui que Jérôme a choisi pour « Mi viaje ») | selon la variante | aucune |
| Recherche, puces (Fechas/Personas), bulles, puces de statut | pilule (`rounded-full`) | — | aucune |
| Champ de saisie | même rayon que les boutons | 1 px, `--field-border` | aucune |
| Carte de contenu (panneau, récapitulatif) | 12 → 16 px | 1 px marine (décision du 2026-09-14) | aucune |
| Ligne dans une carte | 12 px, **sans bordure** (fond `--surface-secondary` ou séparateur) | — | aucune |
| Tuile photo (carrée) | **16 px fixes**, à toute largeur de tuile (rail, grille, mobile) | aucune | aucune |
| Conteneur marine (rail) | ≈ 13 px desktop, ≈ 14 px mobile (inchangé, plus proportionnel à la tuile) | aucune | aucune |
| Header défilé | — | — | ombre marine douce (existante) |
| Popover, toast, menu | 12 px | 1 px marine | `--overlay-shadow` (existante) |

⚠️ **Écrire un rayon** (mesuré le 2026-10-02) : dans le thème vitrine, l'échelle Tailwind `rounded-*`
dérive de `--radius` (4 px) par HeroUI — `rounded-xl` = 6 px, **`rounded-2xl` = 8 px**,
`rounded-3xl` = 12 px — et changera si F4 touche `--radius`. Les rayons en px de ce tableau (16 px
des tuiles, des encadrés, du calendrier) s'écrivent donc en valeur fixe, `rounded-[16px]` ; seuls les
boutons et les champs suivent le jeton (D4).

### 3.5 Mise en page et rythme
- **Une colonne** pour tout le site : `COLUMNA_PORTADA` (`max-w-5xl` gouttières comprises :
  960 px de contenu ; gouttières de 20 px, puis 32 px à partir de `sm`). Header, bandeaux, contenu et
  pied de page s'y alignent. Les textes se limitent à `max-w-prose`, les formulaires à `max-w-xl`
  environ.
- **Trois gabarits de page** :
  1. **Navigation** (or plein) : bandeau intégré à la page, puis sections ou grille.
  2. **Contenu** (bandeau or + clair) : bandeau, puis une colonne (mobile) ou deux colonnes 2/3 + 1/3
     à partir de `lg`, avec le panneau d'action à droite.
  3. **Formulaire seul** (authentification) : panneau de marque + carte de formulaire.
- **Rythme vertical** : entre sections 32 → 72 px (celui de l'accueil) ; dans un bloc 12 → 16 px ;
  bandeau : 24 px au-dessus et 32 → 48 px au-dessous.
- **Points de rupture** : mobile d'abord, `md` (768 px) pour le passage à plusieurs tuiles, `lg`
  (1 024 px) pour les deux colonnes. On vérifie toujours à 390 × 844 et 1 280 × 900, plus 360 px
  pour le débordement.

### 3.6 Les composants signature
| Composant | Quand | Quand pas |
|---|---|---|
| **Titre à point** (`TituloRubrica`, S1) | H1 des rubriques (« Actividades● », « Mi viaje● ») et H2 de section | Nom d'un produit ou d'un établissement (nom propre, souvent long) : police de titre **sans** point |
| **Trait** sous le titre | H2 de section (comme l'accueil) | H1 de bandeau (le bandeau suffit) |
| **Bandeau or** (`BandeauPagina`, S2) | Tête de toute page intérieure | Accueil (son héros en tient lieu) |
| **Rail marine** (`SeccionRiel`, S3) | Une rangée d'offres : accueil, index par type, établissement | Liste paginée (« Cargar más ») : c'est la grille de tuiles |
| **Tuile photo** (S4) | Toute offre avec photo, en rail ou en grille | Ligne de panier, ligne de commande (texte d'abord) |
| **« GO → »** (`EnlaceGo`, S5) | Lien « voir tout » d'une section, « voir l'établissement », « voir le détail » | Action de formulaire (c'est un bouton) |
| **Pilule de recherche + puces** | Accueil, index, catégorie | Tunnel |
| **`Aviso`** (S6) | Message contextuel : information, succès, alerte, erreur | Texte courant |
| **Puce de statut** (S7) | État d'une commande ou d'une ligne, places restantes, « Gratis » | Décoration |

### 3.7 Illustrations, motifs, logos — qui va où
| Asset (`apps/web/public/brand/`) | Usage aujourd'hui | Usage proposé |
|---|---|---|
| `calle-zocalos.webp` (rue en traits bleus) | Héros de l'accueil (LCP) | Panneau de marque de l'auth (P10) et 404 (P11), en **version allégée** (A6) |
| `logo-portada.webp` (marine + bleu ciel, recadré) | Héros de l'accueil | Panneau de l'auth (P10) |
| `logo-header-clair.webp` / `logo-header-sombre.webp` | Header intérieur, zone auth / mode sombre | `-sombre` (or + bleu poudre) devient le logo du **pied marine** (C2) |
| *à créer* `logo-header-sur-or.webp` | — | Header or des pages intérieures (A1, C1) — la déclinaison sans or |
| `motif-bleu-section.webp` | Derrière les rails de l'accueil | Derrière tous les rails (S3) |
| `motif-or.webp`, `motif-bleu-ciel.webp`, `motif-bleu-poudre.webp` | **Inutilisés** | `motif-or` en bandeau décoratif du pied marine (C2) ; les autres pour les états vides (S8) ; sinon ménage (A7) |
| `go.webp` | « GO → » de l'accueil | Tous les « GO → » (S5) |
| `logo-carre-*.png`, `logo-horizontal-*.png` | Sources, **non servies par le code** (≈ 1,2 Mo publiés) | Favicon et icônes (A2) depuis le logo carré ; le reste hors de `public/` (A7) |

Règles : un asset décoratif a `alt=""` et `aria-hidden`. Un motif n'est **jamais** répété en mosaïque :
mesuré non raccordable, avec un écart d'alpha de 117/255 entre les bords. Une illustration n'est
jamais l'image LCP hors de l'accueil (pas de `priority`), et elle n'est pas chargée sous `md` si elle
n'y est pas visible.

### 3.8 Invariants détaillés
- **Accessibilité** :
  - contrastes texte ≥ 4,5:1 et composants ≥ 3:1, **composés dans le navigateur** (story
    `Playground/Palette → Contrastes`), pas seulement calculés ;
  - cible tactile ≥ 44 px (seule exception : le menu des types de l'accueil sous `md`, 34 px) ;
  - focus visible ;
  - une information n'est jamais portée par la couleur seule : un statut a un mot et une icône ;
  - mouvement coupé sous `prefers-reduced-motion`.
- **SEO** (`.claude/rules/seo.md`) :
  - un seul `<h1>` visible ;
  - JSON-LD rendu dans `page.tsx` et inchangé ;
  - fil d'Ariane visible identique au JSON-LD (on ne raccourcit que l'**affichage**) ;
  - rien d'indexable masqué selon la largeur ;
  - texte d'ancre explicite : pas dix « GO » identiques vers dix URL, le nom accessible nomme la
    cible ;
  - `next/image` avec `alt` et `sizes` justes ;
  - une seule image `priority`, qui est le LCP.
- **Performance** :
  - pas de nouvelle police sans licence ni sous-ensemble ;
  - pas de grande illustration sur les pages de contenu ;
  - `sizes` recalculés quand une colonne s'élargit (F7).
- **i18n** :
  - toute nouvelle chaîne en `es` **et** en `en` (`messages/parity.test.ts`) ;
  - un atome ne traduit rien.
- **Architecture** :
  - nouveaux composants serveur sans `@hifago/ui` ni `cn` ;
  - un composant ne remonte dans `components/` qu'au deuxième usage ;
  - pas de `className` en prop (`apps/web/components/README.md`) ;
  - classes Tailwind écrites en toutes lettres (jamais construites) ;
  - `packages/ui` modifié seulement de façon additive (l'admin en dépend).
- **Tests** :
  - `data-testid` conservés ;
  - tout test qui fige une valeur visuelle modifiée est mis à jour **dans le même item**, en disant
    pourquoi ;
  - une story par nouvel état.

### 3.9 Ce qu'on ne fait pas
- Recopier les décalages au pixel de l'accueil (`cqw` mesurés sur la maquette, `DESCENSO_MOVIL`,
  menu à 34 px) sur d'autres pages.
- Mettre du texte directement sur une photo, ou sur l'or en bleu, en blanc ou en couleur d'état.
- Faire défiler un titre en boucle (la bande `BandaTitulo`) : c'est un mouvement non demandé par le
  lecteur, qui répète huit fois un mot-clé à l'écran.
- Empiler des cartes bordées dans des cartes bordées.
- Mélanger deux rayons de bouton sur un même écran.
- Ajouter une couleur, une police ou une bibliothèque UI.

## 4. Constats sur les autres écrans (2026-10-02)

Relevés dans Storybook à 390 et 1 280 px, styles calculés dans le navigateur. « Défaut connu n° »
renvoie à `docs/dette-technique.md` (section du 2026-10-01).

| # | Constat | Où | Preuve | Corrigé par |
|---|---|---|---|---|
| T1 | **Hiérarchie inversée** : le H1 des pages intérieures fait 24 px. Sur `/actividades`, les bandes de catégorie (H2) montent à 60 px et l'écrasent | toutes les pages intérieures | `Title as="h1"` = `text-2xl` ; `BandaTitulo` = `text-4xl → text-6xl` | F1, F2, S2 |
| T2 | **Faux gras** : la police de titre (Anton n'a que la graisse 400) reçoit `font-semibold` (600) ou `font-medium` (500) | H1 et H2 de toutes les pages | H1 fiche 24 px / 600, H2 18 px / 500, H3 14 px / 600 (mesuré) ; 17 titres en dur (§9.3) | F2 |
| T3 | **Police de titre à 14 px**, illisible : « Disponibilidad », « Dormitorio », « Casa Kayam », « Próximas », « Eliminar mi cuenta » ; noms des cartes de l'établissement en police de titre majuscule, tronqués (« GLAMPING CON VISTA … ») | fiche produit, établissement, compte | mesuré 14 px | F1, F2, S4 |
| T4 | **Chiffres illisibles dans Storybook** : la Sugo d'essai remplace les chiffres par des glyphes de filigrane (« Reserva HFG-▓▓▓ », « Tu viaje del ▓▓ oct ») | Storybook, machine de Jérôme | captures | F5 (A4 à terme) |
| T5 | **Deux rayons de bouton** : `Button` rend **12 px**, `LinkButton` **4 px** ; « Mi viaje » de l'accueil 8 px. Sur Mi viaje : « Reservar » à 4 px à côté de « Quitar » à 12 px | partout | mesuré (`border-radius` calculé) | F4 (D4) |
| T6 | **Cibles sous 44 px** : « Confirmar reserva » 36 px, « Quitar » 32 px, « Reservar » 40 px, « Mi viaje » du header intérieur 40 px, champs 42 px | tunnel, fiches, header | mesuré | F4, S11 |
| T7 | **Deux headers étrangers l'un à l'autre** : accueil (or au défilé, drapeaux, « Mi viaje » bleu poudre à 8 px, colonne 1 024) / intérieur (clair, bordure marine, petit logo, « Mi viaje » or pâle à 4 px, langue en menu déroulant, menu burger sous `md`, colonne 768) | toutes les pages intérieures | captures | C1 (D2) |
| T8 | **Pied de page** clair partout, colonne 768 ; absent de la zone compte (le tunnel n'en a pas, volontairement) | toutes | captures | C2 (D3) |
| T9 | **Index par type = la première version de l'accueil**. Il garde : des bandes or où le titre défile en boucle, répété huit fois avec « ↓ » ; des conteneurs bleu poudre ; un bouton or dans une languette. Des **bandes claires de 24 px** séparent les sections or (`gap-y-6` de `PageShell`). Le même « Más actividades » sert de texte de lien pour **chaque** catégorie, vers des URL différentes. La catégorie « otras » a un `<h2>` vide (défaut connu n° 5) | `/actividades`, `/alojamientos`… | captures 390 / 1 280 | P1 (D7), S3 |
| T10 | **Cartes de listing ≠ tuiles de l'accueil** : rayon **8 px** (`rounded-2xl`, mesuré le 2026-10-02 — la première version du plan disait 16, à tort) contre **16 px** ; toutes deux **carrées** depuis le 2026-10-02 (la tuile était en 20/21) ; nom en police de titre sur 1 ligne tronquée contre Poppins 700 sur 2 lignes, carrousel à flèches contre photo seule, bulles de 2 contre 1,5 px | catégories, établissement | captures, code (`Card layout="overlay"`), `border-radius` calculé | S4 (D6) |
| T11 | **Bordures imbriquées** : chaque ligne est bordée de marine dans une carte bordée de marine, d'où un rendu « fil de fer » | Mi viaje, Pago, résultat, Mis reservas, éditions de camp | captures | F6 |
| T12 | **Le fil d'Ariane fait défiler la page** à 390 px : largeur de page 551 px (hébergement PMS), 803 px (« Consultar », nom long), 407 px (événement en vitrine) — défaut connu n° 1 | fiches | `scrollWidth` mesuré | C3 |
| T13 | **Dates ISO brutes** (« 2026-10-14 · 10:00:00 ») — défaut connu n° 7 | Mi viaje, Pago, résultat, Mis reservas | captures | P5, P6, P7, P8 |
| T14 | **Calendrier en anglais** (« October 2026 », « Su Mo Tu ») sur une page espagnole — défaut connu n° 2 | fiches produit | captures | S10 |
| T15 | **Flèches du carrousel photo presque invisibles** : boutons `outline` de 32 px, glyphe « ‹ › » bleu moyen posé sur la photo | fiches, cartes de listing | captures | S9 |
| T16 | **Pages intérieures sans identité** : l'or n'apparaît que sur les boutons ; la page tient dans 704 px sur un écran de 1 280 (288 px de vide de chaque côté) | fiches, tunnel, compte | captures | S2, F7 |
| T17 | **Colonnes incohérentes** : header 768, contenu 704 (`large`) ou 672 (`narrow`, Mi viaje, Pago), accueil 1 024, pied 768, formulaires d'auth 384 | partout | code | F7 |
| T18 | **Pages hors gabarit** : Mi viaje, Pago, les 5 pages d'auth et la 404 posent leur `<main>` à la main (`p-8` : 32 px de marge à 390 px, au lieu des 24 px de `PageShell`) | tunnel, auth, 404 | code | F7, P5, P6, P10, P11 |
| T19 | **Vocabulaire** : « Retiros » et « Alojamiento » (menu de l'accueil) contre « Camps » et « Alojamientos » (titre, fil d'Ariane, « Más camps ») | accueil ↔ listings | `HomePage.tiposPortada` contre `HomePage.secciones` | P12 (D8) |
| T20 | **Favicon par défaut de Next.js** (`app/favicon.ico`, 25 931 octets, le triangle) ; **aucune image de partage** (les métadonnées Open Graph n'ont pas d'`images`) | tout le site, partages | fichier, `lib/seo/pageMetadata.ts` | A2, A3 |
| T21 | **404 et erreurs minimalistes** ; sur l'erreur, « Reintentar » et « Volver al inicio » ne sont pas alignés (décalage vertical à 390 px) | 404, 500 | captures | P11 |
| T22 | **Six encadrés d'information différents**, chacun avec ses classes : bandeau camp, « hébergement requis », réservations en attente, statut de commande, zone de suppression, ligne indisponible | index, tunnel, compte | code | S6 |
| T23 | **Statuts sans forme** : « Reservada », « Anulada » en texte de 12 px ; l'état d'une commande n'est porté que par la couleur d'un encadré | résultat, Mis reservas | captures | S7 |
| T24 | **« Mi viaje » vide** = une phrase grise, sans action pour repartir | Mi viaje | capture | P5, S8 |
| T25 | **Documentation périmée** : `apps/web/components/README.md`, § « Deux constats à connaître, non corrigés » (thème sans jeton, polices Geist) — corrigés depuis le 2026-10-01 | doc | lecture | G3 |
| T26 | **Pistes de comparaison livrées en production** : environ 400 lignes de CSS (`embalse`, `zocalo`, `cal`, `hifago`, `chiva`) dans `globals.css`, alors que seule la charte sert | CSS | lecture | G5 (après D5/D9) |
| T27 | **Mode sombre dérivé**, absent de la charte : tant qu'il existe, chaque item se vérifie en deux modes | tout | `globals.css` | D9 |
| T28 | **Assets publiés inutilisés** : ≈ 1,2 Mo de PNG sources et trois motifs dans `public/brand/` ; `public/logo-hifago.svg` (ancien logo provisoire) ; les SVG de démarrage de Next (utilisés par trois stories seulement) | `public/` | grep | A7 |
| T29 | **Calendrier minuscule sur la fiche** : 212 px de large, **cases de 28 × 28 px**, à 390 comme à 1 280 px. C'est la taille par défaut du calendrier partagé (`--cell-size: --spacing(7)`). Les cases de 44 px voulues par `Calendar.tsx` (`[--cell-size:2.75rem]`, `w-full max-w-sm`) n'arrivent pas jusqu'à la racine rendue | fiche produit (dates, créneaux, nuits) | mesuré : boutons de jour 28 × 28 px | S10 |

## 5. Arbitrages pour Jérôme

Chaque arbitrage dit ce qui est en jeu, les options, la recommandation (et pourquoi), et ce qu'il
débloque. **Statut au 2026-10-02 : tous tranchés par Jérôme.** Pour trancher, répondre « D4 : 8 px » : l'IA
l'inscrit ici avec la date.

| ID | Question | Options | Recommandation | Débloque | Statut |
|---|---|---|---|---|---|
| **D1** | Quelle surface pour quelle page ? | **A** navigation en or plein, contenu sous bandeau or + clair · **B** tout en or · **C** tout clair, l'or en accent (l'état actuel) | **A** — garde l'identité de l'accueil là où l'on parcourt, et la lisibilité là où l'on lit, remplit et paie (§3.2) | F3, S2, P1–P11 | tranché le 2026-10-02 : **A** — navigation en or plein, contenu sous bandeau or puis clair (Jérôme) |
| **D2** | Un seul header pour tout le site ? | **A** le header or de l'accueil (sa version défilée) sur toutes les pages : petit logo sur or, drapeaux, « Mi viaje » bleu poudre, compte, sans menu burger · **B** garder le header clair et n'aligner que ses éléments | **A** — même navigation partout ; le burger n'abritait plus que le compte et la langue, déjà visibles sur l'accueil | C1, A1 | tranché le 2026-10-02 : **A** — header or partout, sans menu burger (Jérôme) |
| **D3** | Le pied de page ? | **A** marine partout, accueil compris : logo or et bleu poudre, CTA WhatsApp or, langue en clair · **B** l'actuel, clair · et : l'ajouter à la zone compte ? | **A**, et oui pour la zone compte — ferme franchement la page or ; reprend la déclinaison marine de la charte (page 4) | C2, P12 | tranché le 2026-10-02 : **A** — marine partout, accueil et zone compte compris (Jérôme) |
| **D4** | Le rayon des boutons ? | **8 px** (celui de « Mi viaje » sur l'accueil) · 4 px (jeton actuel, `LinkButton`) · 12 px (`Button` actuel) — la pilule reste réservée à la recherche, aux puces et aux bulles | **8 px** partout, champs compris — c'est le choix déjà fait sur l'accueil | F4, S11 | tranché le 2026-10-02 : **8 px** (Jérôme) |
| **D5** | La police des titres ? | **A** acheter la licence **web** de Sugo Pro Display (Zetafonts) : les fichiers de `../Charte Graphique/Sugo pro display font/` sont des **versions d'essai, licence CC BY-NC**, inutilisables en production · **B** confirmer Anton | **A** si le budget le permet (c'est la charte) ; sinon **B** et réviser `--tracking-titre`, réglé pour Sugo | F1, A4 | tranché le 2026-10-02 : **B** — Anton confirmé ; pas de licence Sugo, `--tracking-titre` à revoir en Anton (Jérôme) |
| **D6** | Les cartes de listing : une photo ou un carrousel ? | **A** une seule photo, comme l'accueil · **B** garder le carrousel (S9 rend alors ses flèches visibles) | **A** — plus lisible, plus léger (une image par carte au lieu de N), cohérent ; le carrousel reste sur la fiche | S4, S9, P2, P4 | tranché le 2026-10-02 : **A** — une seule photo, comme l'accueil (Jérôme) |
| **D7** | L'index par type ? | **A** les rails de l'accueil (titre à point, motif, conteneur marine, GO) · **B** garder les bandes défilantes et le conteneur bleu poudre | **A** — un seul langage, plus de titre répété huit fois, plus de bandes claires parasites | P1, S3 | tranché le 2026-10-02 : **A** — les rails de l'accueil (Jérôme) |
| **D8** | Un mot par type ? | **A** aligner les listings sur l'accueil (« Retiros », « Alojamiento ») · **B** aligner l'accueil sur les listings (« Camps », « Alojamientos ») · **C** laisser | **A** pour « Retiros » (plus clair qu'un anglicisme en espagnol) ; singulier ou pluriel, à trancher. L'URL `/camps` ne change pas | P12, P1 | tranché le 2026-10-02 : **A** — **« Retiros »** pour le type camp, partout (listings et accueil, « Camps » et « Más camps » compris) ; l'URL `/camps` ne change pas (Jérôme) |
| **D9** | Le mode sombre ? | **A** le désactiver sur la vitrine (`color-scheme: light`) tant que la charte n'en a pas · **B** le garder dérivé et vérifier chaque item dans les deux modes | **A** — la charte ne le prévoit pas, et il double chaque vérification | F3, G5 | tranché le 2026-10-02 : **A** — mode sombre désactivé sur la vitrine (Jérôme) |
| **D10** | Mise en page de la fiche produit ? | **A** deux colonnes à partir de `lg`, avec le panneau de réservation collant à droite, et sous `lg` une barre « prix · Reservar » collante en bas · **B** une colonne, restylée | **A** — le prix et l'action restent visibles pendant la lecture ; c'est le standard des sites de réservation | P3 | tranché le 2026-10-02 : **A** — deux colonnes, panneau collant, barre mobile (Jérôme) |
| **D11** | Mise en page du tunnel (Mi viaje, Pago) ? | **A** récapitulatif dans une colonne droite collante à partir de `lg` ; CTA collant sous `lg` · **B** une colonne | **A** | P5, P6 | tranché le 2026-10-02 : **A** — récapitulatif collant à droite, CTA collant sous `lg` (Jérôme) |
| **D12** | Écrans d'authentification ? | **A** écran scindé : panneau or (logo, slogan, rue) + carte de formulaire ; sous `lg`, bandeau or au-dessus de la carte · **B** simple bandeau or | **A** — seul écran sans header de site, c'est là que la marque doit le plus se voir | P10 | tranché le 2026-10-02 : **A** — écran scindé avec panneau or (Jérôme) |
| **D13** | La 404 ? | **A** page or : rue, titre, bouton « Volver al inicio », liens vers les cinq types · **B** bandeau or et texte | **A** — une 404 qui relance la navigation au lieu de la clore | P11 | tranché le 2026-10-02 : **A** — page or avec liens vers les types (Jérôme) |
| **D14** | Un chapô éditorial sur les index par type ? | Un texte de 40 à 60 mots par type, en `es` et en `en`, rédigé par Jérôme · ou rien | **Oui** — c'est le seul contenu rédactionnel indexable de ces pages (aujourd'hui des titres et des cartes seulement) | P1 | tranché le 2026-10-02 : **Oui** — Jérôme rédige 40 à 60 mots par type, `es` et `en` (Jérôme) |
| **D15** | Couleur du point des titres ? | Bleu poudre sur or (comme l'accueil), **or** sur clair et sur marine · ou bleu poudre partout (invisible sur clair, ≈ 1,4:1) | **La première** | S1 | tranché le 2026-10-02 : **la première** — bleu poudre sur or, or ailleurs (Jérôme) |
| **D16** | L'image de catégorie (`catalog_tags.image_path`, saisie dans l'admin, affichée nulle part — backlog « Catégories partout ») ? | L'afficher dans le bandeau de la page de catégorie (à droite, à partir de `lg`) · ou non | **Oui** si les images existent ; sinon rien, sans emplacement vide | P2 | tranché le 2026-10-02 : **Oui** — l'afficher dans le bandeau ; sans image, rien (Jérôme) |

Arbitrages déjà ouverts au backlog et **hors de ce plan** (ne pas trancher ici) : « Héros de
l'accueil, seconde maquette » (cinq écarts) ; « Tuiles de l'accueil sur mobile ». Ce dernier semble
résolu depuis le passage à **une tuile par section** sous `md` (journal 2026-10-02, suite 3) : la
tuile fait 288 px à 390 au lieu de 97. Reste sa seconde moitié (infos de plus dans les bulles, ce
qui demande `search_catalog`). À confirmer par Jérôme avant de retirer la ligne.

## 6. Les items, un par un

Chaque item a le même plan :
- **Pourquoi** (renvoi au constat `T…`) ;
- **Aujourd'hui** (mesuré) ;
- **Cible** (ce qu'on doit voir après) ;
- **Fichiers** ;
- **Pièges** ;
- **Vérifier** ;
- puis une ligne de dépendances, arbitrages et effort.

Les noms de composants proposés suivent la convention d'`apps/web` : PascalCase, en espagnol comme
`SeccionPortada` ou `EstadoVacio`. Les jetons CSS suivent celle de `globals.css` : en français, comme
`--tracking-titre` ou `--charte-or`. L'effort se lit ainsi : S < ½ journée, M ≈ 1 journée,
L > 1 journée.

### 6.1 Fondations (F)

#### F1 — Rôles typographiques et échelle de tailles (jetons)
- **Pourquoi** : T1, T2, T3. La charte attribue les polices par emploi. Le code les attribue par
  balise et disperse les tailles (`Title`, classes en dur).
- **Aujourd'hui** : `packages/ui/src/styles/globals.css`, bloc « LA CHARTE », définit
  `--font-titre` (Anton ; Sugo d'essai dans Storybook), `--font-sous-titre` (Anton) et
  `--tracking-titre: 0.0667em`. Une règle de base, `[data-theme="vitrine"] :is(h1, h2, h3)`, pose la
  police de titre, la graisse 400 et le `--tracking-titre`. Aucune taille n'est un jeton.
- **Cible** :
  1. Des jetons de taille dans le bloc vitrine, à côté de `--tracking-titre` (valeurs du §3.3) :
     - `--taille-titre-page` : `clamp(2rem, 1.45rem + 2.25vw, 3.25rem)` ;
     - `--taille-titre-section` : `clamp(1.625rem, 1.24rem + 1.57vw, 2.5rem)` ;
     - `--taille-titre-bloc` : `clamp(1.25rem, 1.2rem + 0.22vw, 1.375rem)` ;
     - `--taille-chapo` : `clamp(1.125rem, 1.02rem + 0.45vw, 1.375rem)` ;
     - `--taille-prix` : `clamp(1.5rem, 1.39rem + 0.45vw, 1.75rem)`.
  2. Une **classe par rôle**, définie une fois au même endroit (`@utility` de Tailwind v4, ou classes
     en `@layer components` — au choix de l'implémenteur, pourvu que la classe soit générée) :
     - `titre-page`, `titre-section` : police de titre + taille + interligne + `--tracking-titre` +
       graisse 400 ;
     - `titre-bloc` : `--font-sous-titre` + 20 → 22 px + interligne 1,15 + interlettrage normal +
       graisse 400 ;
     - `etiquette` : Poppins 600, 14 → 15 px ;
     - `chapo` : Poppins 400 + jeton ;
     - `prix-fort` : Poppins 700 + jeton + chiffres tabulaires.
  3. La règle de base `h1–h3` **reste** comme valeur par défaut sûre. Ce sont les rôles qui
     décident de l'apparence ; F2 les applique partout.
- **Fichiers** : `packages/ui/src/styles/globals.css`.
- **Pièges** :
  - `scripts/check-tokens.sh` exige que la règle `:is(h1, h2, h3)` porte
    `letter-spacing: var(--tracking-titre)`, et interdit tout `tracking-…` à côté de `font-titre` ou
    d'un `<h1-3>` autre que le jeton. Ne pas casser ces deux contrôles : le rôle `titre-bloc` règle
    son interlettrage dans sa propre définition CSS, pas en classe sur la balise.
  - Le slogan de l'accueil (Poppins 800) et ses titres de section en `cqw` **ne changent pas**.
- **Vérifier** : aucun changement visible attendu, puisque les jetons ne sont pas encore consommés.
  Capture de l'accueil identique avant et après. Inspecter qu'une classe de rôle est bien générée
  (style calculé dans Storybook).
- Dépend de — · Arbitrage D5 (le `--tracking-titre` sera à revoir si Anton est confirmé) · Effort S

#### F2 — `Title` réécrit par rôles ; les 17 titres en dur remplacés
- **Pourquoi** : T2 (faux gras), T3 (police de titre à 14 px).
- **Aujourd'hui** :
  - `components/atoms/Title.tsx` : `SIZE_CLASSES = { lg: "text-2xl font-semibold", md: "text-lg
    font-medium", sm: "text-sm font-medium" }` ; par défaut h1 → lg, h2 → md, h3 → sm.
  - Usages : 5 h1, 5 h2 par défaut, 1 h2 `md`, 2 h2 `sm`.
  - **17 titres écrits à la main** avec taille et graisse (liste exacte au §9.3).
  - `Card.Title` de HeroUI rend un `h3` en `text-sm` dans le bloc établissement de `FichaProducto`.
  - Le `titleSize` de l'atome `Card` (`md` = `text-lg`) sert aux titres de `CartSummary`,
    `OrderCard` et `OrderResult`.
- **Cible** :
  - `Title` : `size` devient `"pagina" | "seccion" | "bloque" | "etiqueta"`, avec les classes de
    rôle de F1. Par défaut : h1 → `pagina`, h2 → `seccion`, h3 → `bloque`. **Aucune** classe de
    graisse sur les trois premiers. `etiqueta` = `font-sans` (qui bat la règle de base) + 600.
  - Les 17 titres en dur passent par `Title` :

    | Titres | Devient |
    |---|---|
    | h1 des 5 pages d'auth, de `mi-viaje`, de `pago`, de `not-found.tsx` et d'`ErrorScreen` | `pagina` |
    | « Disponibilidad » (4 formulaires), « Elige una edición », titre de `DeleteAccountSection` | `as="h2" size="bloque"` |
    | catégories d'équipement (`AmenidadesList`) | `as="h3" size="etiqueta"` |

  - Usages existants de `Title` :

    | Titres | Devient |
    |---|---|
    | « Equipamiento » (fiche produit, fiche établissement), « Datos de contacto », « Próximas » / « Pasadas » | `bloque` |
    | « Habitaciones », « Actividades y servicios » | `seccion` (puis `TituloRubrica` en P4) |
    | Tous les h1 | `pagina` |

  - Bloc établissement de la fiche produit : `Card.Title` remplacé par `Title as="h2"
    size="bloque"`, qui contient le lien.
  - Atome `Card` : les titres de carte de contenu (`titleAs="h2"`) prennent le rôle `bloque`.
- **Fichiers** :
  - `components/atoms/Title.tsx` (+ test, story `Affichage/Title`) ;
  - `components/atoms/Card.tsx` ;
  - `components/molecules/AmenidadesList.tsx` ;
  - `app/[locale]/(vitrine)/productos/[slug]/{FichaProducto,ReservationForm,SlotReservationForm,LodgingReservationForm,EventoReservationForm}.tsx` ;
  - `app/[locale]/(vitrine)/establecimientos/[slug]/FichaEstablecimiento.tsx` ;
  - `app/[locale]/(vitrine)/reserva/[token]/OrderResult.tsx` ;
  - `app/[locale]/(cuenta)/cuenta/{perfil/DeleteAccountSection,reservas/page}.tsx` ;
  - `app/[locale]/(tunnel)/{mi-viaje,pago}/page.tsx` ;
  - les 5 `app/[locale]/(auth)/*/page.tsx` ;
  - `app/[locale]/not-found.tsx` ;
  - `components/organisms/ErrorScreen.tsx`.
- **Pièges** :
  - `Title` n'a pas de `className`, par règle du dépôt. Une marge (le `mb-2` de « Disponibilidad »)
    passe par l'écart du parent.
  - Les composants serveur (`not-found`, pages d'auth) peuvent importer `Title`, qui n'importe rien
    de `@hifago/ui`.
  - Mettre à jour les tests qui figent `text-2xl` et compagnie.
- **Vérifier** :
  - mesurer dans `ecrans-fiche-produit--alojamiento-pms`, `ecrans-mes-reservations--todas-las-variantes`
    et `ecrans-mon-profil--perfil-completo` : aucun `h1`–`h3` en police de titre sous 20 px, aucune
    graisse calculée au-dessus de 400 sur la police de titre ni sur Anton ;
  - panneau a11y de Storybook propre.
- Dépend de F1 · Arbitrage — · Effort M

#### F3 — Surfaces or / clair / marine : jetons redéfinis par contexte
- **Pourquoi** :
  - §2.5 : défaut de contraste **déjà en ligne** sur l'accueil ;
  - §3.2 : une surface doit redéfinir ce qui s'y lit ;
  - préalable à tout bandeau or et au pied marine.
- **Aujourd'hui** :
  - `--muted`, `--link`, `--focus` et `--field-border` valent le bleu moyen partout ;
  - `body:has(main[data-fondo="acento"])` ne redéfinit que le fond et la couleur du texte ;
  - mesuré sur l'accueil : description de l'état vide à 3,17:1.
- **Cible** :
  1. Trois contextes déclarés par un attribut **`data-superficie`** dans `globals.css`, bloc vitrine,
     avec les valeurs du tableau §3.2 :
     - **`or`** : fond `--accent`, texte marine. `--muted`, `--link`, `--focus`, `--field-border` et
       `--border` passent au marine ; `--separator` au marine à 30 %.
     - **`marine`** : fond marine, texte blanc. `--foreground` passe au blanc, `--muted` au bleu
       poudre, `--link` et `--focus` à l'or ; `--border` et `--separator` au bleu poudre à 45 %.
     - **`clara`** : remet les valeurs du thème. C'est ce qui permet de poser une carte blanche, ou un
       `Aviso`, sur une surface or ou marine.
  2. Trois jetons **décoratifs** de surface, consommés par S1 et S5 :
     - `--punto-titulo` : bleu poudre sur or, or ailleurs (D15) ;
     - `--trazo-titulo` : marine, or sur marine ;
     - `--flecha-go` : bleu poudre sur or, bleu moyen sur clair.
  3. L'accueil : la page or reçoit les mêmes redéfinitions que `data-superficie="or"`. Les poser
     sur **`main[data-fondo="acento"]` et sur le header**, **pas sur `<body>`** : les popovers
     (suggestions, calendrier, personnes) sont rendus au bout du `<body>`, sur fond blanc, et doivent
     garder les valeurs du clair.
  4. Story `Playground/Palette → Contrastes` : ajouter les couples composés de chaque surface
     (discret, lien et focus sur or ; texte, discret et lien sur marine ; `Aviso` blanc sur or).
- **Fichiers** :
  - `packages/ui/src/styles/globals.css` ;
  - `components/atoms/PageShell.tsx` (documenter `fondo`) ;
  - `components/playground/Palette.stories.tsx` (+ `contraste.ts` si besoin) ;
  - `PageShell.test.tsx`.
- **Pièges** :
  - Si D9 = B (sombre conservé), chaque redéfinition doit avoir sa valeur sombre.
  - Ne jamais redéfinir `--accent` lui-même dans une surface : l'or de fond en dépend.
  - Vérifier que `check-tokens.sh` ne voit aucune couleur en dur : n'utiliser que les jetons
    `--charte-*`.
- **Vérifier** :
  - `ecrans-accueil--sin-resultados` : la description passe au marine (6,31:1) ;
  - `ecrans-accueil--defecto` : capture identique au pixel, hors textes discrets ;
  - la story `Contrastes` est entièrement verte.
- Dépend de — · Arbitrages D1, D9 · Effort M

#### F4 — Boutons : rayon unique, 44 / 48 px, couleur pour fond or
- **Pourquoi** : T5 (deux rayons), T6 (cibles sous 44 px), et l'absence de bouton principal lisible
  sur l'or (un bouton or sur l'or disparaît).
- **Aujourd'hui** (mesuré) :
  - `Button` : 12 px de rayon (la classe de taille de HeroUI bat `rounded-[var(--radius)]`),
    texte 14 px / 500, hauteur 36 px (`md`), 32 px (`sm`) ;
  - `LinkButton` : 4 px, 16 px / 500, 40 px (`lg`) ;
  - « Mi viaje » de l'accueil, desktop : 8 px ;
  - couleurs : `accent`, `neutral`, `danger`.
- **Cible** :
  - **Un seul rayon** (D4, recommandé 8 px = `calc(var(--radius) * 2)`) pour `Button`, `LinkButton`,
    et `IconButton` / `IconLink` quand ils ne sont pas ronds. La pilule ne s'obtient que par
    `shape="pill"` : bouton de recherche, puces. Corriger la spécificité pour que `Button` rende
    **réellement** ce rayon (même mécanisme que `BOUTON_VIAJE_DESKTOP` de `SiteHeader`, ou la
    variable de rayon de HeroUI), et le **mesurer**.
  - **Hauteur ≥ 44 px pour toutes les tailles** (`sm` réduit le padding et la police, pas la
    hauteur) ; **`lg` = 48 px**, réservé aux CTA de conversion : « Añadir a Mi viaje », « Reservar »,
    « Confirmar reserva », « Pagar el anticipo », « Iniciar sesión », « Crear cuenta ».
  - Texte : Poppins 600 16 px (`lg`, `md`), 500 14 – 15 px (`sm`).
  - **Nouvelle couleur `marine`**, pour l'action principale sur une surface or : fond marine, texte
    blanc (13,07:1), survol marine éclairci d'environ 8 %, teinte bleu poudre, contour marine. Table
    d'usage par surface : §3.2. Explicite à l'appel, jamais automatique.
  - Désactivé : inchangé (or à 50 %), mais toujours accompagné du texte qui dit pourquoi (c'est déjà
    le cas sur la fiche : « Elige un día… »).
- **Fichiers** :
  - `components/atoms/{Button,LinkButton,IconButton,IconLink}.tsx` (+ tests, stories `Actions/*`) ;
  - les appelants en `size="sm"` : `CartSummary` (« Quitar »), et `FichaProducto` (lien vers Maps) ;
  - `SiteHeader.tsx` (`BOUTON_VIAJE_DESKTOP` devient superflu une fois C1 fait).
- **Pièges** :
  - Monter les hauteurs déplace les mises en page (fiche, tunnel) : à vérifier.
  - Ne pas toucher le `Button` brut de HeroUI dans `packages/ui` (l'admin en dépend) : tout passe
    par les atomes d'`apps/web`.
- **Vérifier** :
  - stories `Actions/Button` et `Actions/LinkButton` : même rayon calculé pour les deux, hauteur
    ≥ 44 px ;
  - écrans fiche, Mi viaje, Pago, auth à 390 px : aucun bouton sous 44 px.
- Dépend de F3 · Arbitrage D4 · Effort M

#### F5 — Storybook : chiffres de la Sugo d'essai rendus lisibles

> **Révisé le 2026-10-02 (Jérôme), après D5 = B** : Anton étant confirmée, la Sugo d'essai n'est plus
> seulement privée de ses chiffres, elle est **retirée** de Storybook (`preview-head.html`, `main.ts`),
> qui affiche désormais la police de production. L'option `--prod` de `/hifago-rendu` disparaît avec
> elle. La cible ci-dessous (`unicode-range`) est abandonnée ; elle reste pour l'historique.
- **Pourquoi** : T4. Jérôme juge les écrans dans Storybook avec une police d'essai qui remplace les
  chiffres par des glyphes de filigrane. Le numéro de réservation, les dates des titres et les prix
  en police de titre y sont illisibles.
- **Aujourd'hui** : `.storybook/preview-head.html` déclare `@font-face "Sugo Pro Display Essai"`
  (fichier servi hors dépôt sous `/police-sugo-essai/`, pour toutes les graisses), placé devant Anton
  dans `--font-titre`.
- **Cible** :
  - ajouter un `unicode-range` qui **exclut les chiffres** (`U+0030-0039`) : les chiffres retombent
    sur Anton, comme en production ;
  - un commentaire dit pourquoi ;
  - vérifier qu'aucun autre glyphe n'est remplacé (ponctuation, `%`, `$`) ; sinon, l'exclure aussi.
- **Fichiers** : `apps/web/.storybook/preview-head.html` (le playground seulement, aucun effet en
  production).
- **Vérifier** : `ecrans-resultat-reservation--por-pagar` (« Reserva HFG-000123 » lisible) et
  `ecrans-mi-viaje--viaje` (« Tu viaje del 14 oct… »).
- Dépend de — · Arbitrage — · Effort S

#### F6 — Cartes de contenu : fin des bordures imbriquées
- **Pourquoi** : T11. Les lignes bordées de marine dans une carte bordée de marine donnent un rendu
  « fil de fer » et doublent les traits.
- **Aujourd'hui** :
  - les lignes `rounded-lg border p-3` de `CartSummary`, `OrderCard` et `OrderResult` sont dans une
    carte bordée (la bordure marine des cartes est une décision de Jérôme du 2026-09-14) ;
  - les éditions de camp sont des boîtes bordées (`ReservationForm`) ;
  - `DeleteAccountSection` a sa propre boîte.
- **Cible** :
  - la carte extérieure **garde** sa bordure marine de 1 px et passe à un padding de 20 à 24 px ;
  - les lignes **n'ont plus de bordure** : elles sont séparées par un filet `--separator`
    (`divide-y`) et 12 à 16 px de padding vertical ;
  - éléments **sélectionnables** (éditions de camp) : tuiles `--surface-secondary` de 12 px de rayon,
    **contour marine de 2 px** au survol et une fois choisies (l'état choisi doit se voir à 3:1) ;
  - ligne indisponible : un `Aviso` compact de ton erreur (S6) dans la ligne, au lieu de la bordure
    rouge.
- **Fichiers** :
  - `components/organisms/CartSummary.tsx` ;
  - `app/[locale]/(cuenta)/cuenta/reservas/OrderCard.tsx` ;
  - `app/[locale]/(vitrine)/reserva/[token]/OrderResult.tsx` ;
  - `app/[locale]/(vitrine)/productos/[slug]/ReservationForm.tsx` (éditions) ;
  - `app/[locale]/(cuenta)/cuenta/perfil/DeleteAccountSection.tsx` (→ S6).
- **Vérifier** : `ecrans-mi-viaje--viaje`, `--linea-no-disponible`,
  `ecrans-resultat-reservation--lineas-mixtas`, `ecrans-mes-reservations--todas-las-variantes`,
  `ecrans-fiche-produit--camp-edicion-elegida`.
- Dépend de — (S6 pour la ligne indisponible) · Arbitrage — · Effort S

#### F7 — Gabarit : une colonne (celle de l'accueil) pour toutes les pages
- **Pourquoi** : T16, T17, T18.
- **Aujourd'hui** :
  - header `max-w-3xl` (768) ;
  - `PageShell` `large` : 704 px de contenu ; `narrow` : 672 px ;
  - Mi viaje et Pago : `max-w-2xl p-8` ;
  - auth : `p-8`, formulaire de 384 px ;
  - 404 : `max-w-3xl` ;
  - pied : `max-w-3xl` ;
  - accueil : 960 px de contenu (`COLUMNA_PORTADA`).
- **Cible** :
  - **Nouvelle variante `PageShell variant="pagina"`**, qui devient la seule des pages intérieures.
    C'est la grille `1fr | colonne | 1fr` de `large`, avec son mécanisme de fond perdu `data-bleed`
    intact. La colonne fait 960 px au plus : `min(60rem, 100% − 2.5rem)` sous `sm`, `min(60rem,
    100% − 4rem)` à partir de `sm`, soit exactement la boîte de contenu de `COLUMNA_PORTADA`.
    **Pas de padding haut** : la page commence par son bandeau (S2), collé au header. Padding bas de
    48 px.
  - `large`, `narrow` et `centered` disparaissent une fois toutes les pages migrées (G5).
  - Les largeurs internes deviennent des choix de contenu : texte `max-w-prose`, formulaire
    `max-w-xl`, deux colonnes 2/3 + 1/3 à partir de `lg` sur les fiches et le tunnel.
  - Mi viaje, Pago, les pages d'auth et la 404 passent par `PageShell`, dans leurs items P.
- **Fichiers** :
  - `components/atoms/PageShell.tsx` (+ test, stories `Structure/PageShell`) ;
  - puis chaque `page.tsx`, dans son item P.
- **Pièges** :
  - `PageShell.test.tsx` fige les largeurs de `large` (704 px, mesuré au pixel) : écrire les tests de
    `pagina` sans retirer ceux de `large` tant qu'elle sert.
  - Toute image dont la colonne s'élargit doit voir son `sizes` recalculé (`PhotoStrip` des fiches,
    tuiles des grilles), sinon on télécharge la mauvaise taille.
  - Toujours un seul `<main>`.
- **Vérifier** : à 1 280 px, le bord gauche du logo, du H1, du contenu et du texte du pied tombent
  sur la même abscisse (mesurer `getBoundingClientRect().left`) ; à 390 px, gouttières de 20 px.
- Dépend de — · Arbitrage — · Effort M

### 6.2 Coquille (C)

#### C1 — Header unique, or, aligné sur celui de l'accueil
- **Pourquoi** : T7. Deux headers étrangers l'un à l'autre ; celui des pages intérieures porte des
  choix que l'accueil a remplacés (bouton or pâle à 4 px, menu déroulant, burger).
- **Aujourd'hui** : `components/organisms/SiteHeader.tsx` a deux branches.
  - **`transparente`** (accueil, choisie par `CoquillaVitrine` sur `/`) : `fixed`, sans fond, or et
    ombre une fois la page défilée, drapeaux à gauche, « Mi viaje » bleu poudre à 8 px (desktop) ou
    en contour (mobile), compte.
  - **par défaut** : `sticky`, fond `--background`, bordure basse marine, colonne `max-w-3xl`, petit
    logo (`LogoHifago`, `h-12`), « Mi viaje » en `soft accent` (or pâle) à 4 px, `SiteMenu` (compte,
    langue en menu déroulant) replié derrière un bouton burger sous `md`.
- **Cible** (D2 = A) :
  - **Une seule apparence pour toutes les pages : l'or**, c'est-à-dire l'état défilé de l'accueil.
    L'accueil garde en plus son état transparent en haut de page.
  - `sticky top-0 z-50`, `data-superficie="or"` (F3), fond or, **sans bordure basse**, ombre marine
    douce dès que la page défile (la même que l'accueil : le crochet `useADefile` s'applique à toutes
    les pages).
  - Colonne `COLUMNA_PORTADA`, hauteur `h-16` (64 px).
  - **Gauche** :
    - pages intérieures : le logo **sur or** (A1, déclinaison marine + bleu ciel, sans or) à 48 px,
      lien vers l'accueil (`homeLabel`), avec le comportement `empujarConservandoQuery` inchangé ;
    - accueil : pas de logo, inchangé.
  - **Droite**, dans le `<nav aria-label={navLabel}>` :
    1. langues `LanguageSwitcher apariencia="banderas"` (« ESP · ING » en Anton ; sous `md`, seule
       l'autre langue) ;
    2. « Mi viaje » **identique à l'accueil** : contour neutre sous `md`, aplat bleu poudre au-dessus,
       libellé « Mi viaje » puis « Mi viaje en Guatapé », pastille de compte ;
    3. compte `IconLink`.
  - **Pastille du nombre d'articles sur l'or : marine, chiffre blanc.** Aujourd'hui elle est or sur
    le bouton en contour mobile : sa forme disparaît sur l'or.
  - **Plus de burger ni de `SiteMenu`** dans le header : tout est en ligne, comme sur l'accueil.
    Déplacer `IconeCompte`, `ROUTE_COMPTE` et `ROUTE_CONNEXION` (aujourd'hui dans `SiteMenu.tsx`)
    là où le header les importe.
  - Les trois zones (vitrine, tunnel, compte) rendent ce header. L'authentification garde son en-tête
    minimal (P10).
- **Fichiers** :
  - `components/organisms/SiteHeader.tsx` (+ `SiteHeader.test.tsx`, stories `Coquille/SiteHeader`) ;
  - `components/atoms/LogoHifago.tsx` (variante `sobre`) ;
  - `components/organisms/LanguageSwitcher.tsx` (couleurs par jetons de surface seulement) ;
  - `components/organisms/SiteMenu.tsx` (ne sert plus : G5) ;
  - `packages/ui/src/styles/globals.css` (règles d'affichage du logo s'il faut une 3ᵉ déclinaison) ;
  - asset A1.
- **Pièges** :
  - **Largeur à 360 px** : logo (≈ 84 px) + une langue (≈ 63) + « Mi viaje » (≈ 119, peut passer sur
    deux lignes) + compte (44) + écarts ≈ 322 px pour 320 disponibles. Il faut le **mesurer** ; si ça
    déborde, sous 380 px le lien de langue ne montre que le drapeau, avec son nom gardé en `sr-only`.
  - Les liens de langue doivent rester dans le **HTML servi**, c'est ce qui fait découvrir `/en/`.
    `SiteHeader.test.tsx` le prouve en rendu serveur : l'adapter, ne pas le supprimer.
  - Aucun e2e ne clique le burger (vérifié par grep) ; les `data-testid` du panier et du compte
    restent.
- **Vérifier** :
  - toutes les stories `Coquille/SiteHeader` ;
  - un écran par zone (fiche, Mi viaje, Mis reservas) à 360, 390 et 1 280 px : pas de débordement,
    alignement sur la colonne ;
  - focus marine visible sur l'or.
- Dépend de F3, F4, F7, A1 · Arbitrage D2 · Effort L

#### C2 — Pied de page marine
- **Pourquoi** : T8 et le point « Charte (f) » du backlog : le pied clair ferme mal la page or.
- **Aujourd'hui** : `components/organisms/SiteFooter.tsx` :
  - fond `--surface-tertiary`, bordure haute marine, colonne `max-w-3xl` ;
  - « Escríbenos por WhatsApp » en contour neutre ;
  - langue en menu déroulant ;
  - « Hifago · Guatapé, Colombia » en 12 px ;
  - liste de liens institutionnels vide.
- **Cible** (D3 = A) :
  - `<footer data-superficie="marine">` : fond marine, texte blanc. Colonne `COLUMNA_PORTADA`.
    Padding de 40 px en haut et 32 px en bas (32 / 24 sur mobile).
  - Facultatif, si Jérôme le veut : un **bandeau décoratif** de 56 à 72 px de haut au bord supérieur,
    tiré de `motif-or.webp`, découpé (A6), `bg-cover`, `aria-hidden`, **jamais répété**.
  - Une rangée en deux colonnes à partir de `md`, empilée sur mobile :
    - à gauche, le **logo pour fond sombre** (`logo-header-sombre.webp`, or + bleu poudre), forcé
      quel que soit le mode, à 48 – 56 px ; dessous, « Hifago · Guatapé, Colombia » en bleu poudre
      14 px ;
    - à droite, le CTA « Escríbenos por WhatsApp » **plein or, texte marine** (6,31:1) avec un
      glyphe WhatsApp en `currentColor`, puis la langue (variante menu) en texte blanc. Son popover
      reste une surface claire (`data-superficie="clara"`).
  - Les liens institutionnels, quand ils existeront, en bleu poudre soulignés au survol.
  - **Zone compte** : ajouter `SiteFooter` à `app/[locale]/(cuenta)/layout.tsx` (la zone n'a pas de
    pied aujourd'hui). Le tunnel reste sans pied, volontairement.
- **Fichiers** :
  - `components/organisms/SiteFooter.tsx` (+ test, stories `Coquille/SiteFooter`) ;
  - `LanguageSwitcher.tsx` (jetons) ;
  - `LogoHifago.tsx` (variante forcée) ;
  - `app/[locale]/(cuenta)/layout.tsx`.
- **Pièges** :
  - Les règles `.logo-clair` / `.logo-sombre` de `globals.css` suivent le mode : une variante
    forcée doit utiliser une **autre** classe, sinon le mode clair la masquera.
  - Le survol `hover:bg-default` du menu de langue reste lisible sur le marine (bleu poudre + texte
    marine).
- **Vérifier** : `coquille-sitefooter--defaut` et `--sous-une-page` ; le bas de l'accueil et le bas
  d'une fiche à 390 et 1 280 px ; contrastes blanc 13,07, bleu poudre 8,02, bouton or 6,31.
- Dépend de F3, F7 · Arbitrage D3 · Effort M

#### C3 — Fil d'Ariane : style, et plus de débordement à 390 px
- **Pourquoi** : T12 (défaut connu n° 1) ; et sur le bandeau or, ses couleurs doivent suivre la
  surface.
- **Aujourd'hui** : `components/molecules/Migas.tsx` enveloppe le `Breadcrumbs` de HeroUI, texte
  14 px, **sans retour à la ligne**. Largeur de page mesurée à 390 px : 551, 803 et 407 px sur trois
  fiches.
- **Cible** :
  - Typographie du rôle `meta` (Poppins 500, 14 px).
  - Sur l'or : liens marine soulignés au survol et au focus ; page courante en marine 600, sans lien
    (`aria-current`) ; séparateurs « › » marine à 60 %.
  - **Retour à la ligne** autorisé (écart de ligne de 4 px).
  - **Sous `sm`**, les niveaux intermédiaires sont tronqués à environ 14 caractères, avec une ellipse.
    Le dernier niveau va sur 2 lignes au plus.
  - Le JSON-LD ne change pas : il est construit dans `page.tsx` depuis la même liste, et seul
    l'affichage raccourcit (règle SEO 6).
- **Fichiers** : `components/molecules/Migas.tsx` (+ test, story).
- **Vérifier** :
  - à 360 et 390 px, `scrollWidth === clientWidth` sur `ecrans-fiche-produit--alojamiento-pms`,
    `--precio-consultar-sin-foto` et `--evento-vitrina` ;
  - e2e `seo.spec.ts` (JSON-LD des fils) inchangé.
- Dépend de F3 · Arbitrage — · Effort S

#### C4 — Lien retour et toasts : finitions
- **Lien retour** (`components/atoms/BackLink.tsx`, aujourd'hui `text-sm text-muted`) :
  - Poppins 500, 15 px, marine sur l'or, bleu moyen sur clair ;
  - flèche en SVG décoratif de 16 px devant le libellé ;
  - si la flèche « ← » est écrite dans le message (`ProductPage.backToCatalog`), la retirer des deux
    langues.
- **Toasts** (`components/organisms/SiteToaster.tsx`, `Toast` de HeroUI) :
  - surface blanche, bordure marine de 1 px, rayon de 12 px, icône par ton ;
  - sur mobile, position **au-dessus** des barres CTA collantes, si D10 ou D11 les adoptent ;
  - vérifier `coquille-sitetoaster--sur-un-ecran-reel` et `ecrans-fiche-produit--anadido-al-viaje`.
- Dépend de F3 · Arbitrage — · Effort S

### 6.3 Composants signature (S)

Règle commune à tous les composants de ce lot :
- **composant serveur** sans `"use client"`, qui n'importe rien de `@hifago/ui` (pas même `cn`),
  sauf mention contraire ;
- type de props nommé et exporté ;
- `testId` ;
- en-tête de commentaire daté qui dit pourquoi ;
- un test, et une story par état ;
- placé dans `components/` puisqu'il sert au moins deux écrans (`apps/web/components/README.md`).

#### S1 — `TituloRubrica` : le titre à point de l'accueil, extrait
- **Pourquoi** : c'est la signature des titres Hifago, aujourd'hui enfermée dans `SeccionPortada`.
- **Aujourd'hui** : `SeccionPortada.tsx` rend un `<h2>` en police de titre
  (`clamp(1.75rem, 6.3cqw, 3.75rem)`, `leading-none`), un point `size-[0.3em]` bleu poudre et un trait
  marine `w-[68cqw]` de 2 à 4 px.
- **Cible** : `components/molecules/TituloRubrica.tsx`.
  - **Props** :
    - `as: "h1" | "h2"` ;
    - `texto: string` (déjà traduit) ;
    - `tamano: "portada" | "pagina" | "seccion"` ;
    - `punto?: boolean` (vrai par défaut) ;
    - `trazo?: boolean` (vrai par défaut pour `seccion` et `portada`, faux pour `pagina`) ;
    - `testId`.
  - **Rendu** :
    - le titre porte la classe de rôle (F1). `portada` reproduit **exactement** les classes `cqw`
      actuelles de l'accueil ;
    - le point est un `span aria-hidden`, de couleur `var(--punto-titulo)` (F3, D15) ;
    - le trait est un `div aria-hidden` de couleur `var(--trazo-titulo)`, à 68 % de la largeur du
      conteneur (`portada`, `seccion`).
  - Nom d'un produit ou d'un établissement : `punto={false}` (§3.6).
- **Fichiers** : `components/molecules/TituloRubrica.tsx` (+ test, story `Affichage/TituloRubrica` :
  trois tailles × trois surfaces, plus un titre long sur deux lignes) ; `SeccionPortada.tsx` l'utilise.
- **Pièges** : l'accueil doit rester **au pixel près**. Comparer les captures avant/après à 390 et
  1 280 px (position et taille du titre, du point et du trait).
- **Vérifier** : `ecrans-accueil--defecto` identique ; la story sur or, clair et marine.
- Dépend de F1 (F3 pour la couleur du point) · Arbitrage D15 · Effort S

#### S2 — `BandeauPagina` : le bandeau or des pages intérieures
- **Pourquoi** : T1, T16. C'est le pont visuel entre l'accueil et les pages intérieures. Il porte le
  seul `<h1>` de la page.
- **Cible** : `components/organisms/BandeauPagina.tsx`.
  - **Props** :
    - `migas?: ReactNode` (le `Migas`, composant client, passé tout rendu) ;
    - `volver?: ReactNode` (`BackLink`) ;
    - `titulo: string` ;
    - `conPunto?: boolean` ;
    - `chapo?: string` ;
    - `meta?: ReactNode` (puces, adresse, lien vers l'établissement) ;
    - `accion?: ReactNode` (recherche ou CTA) ;
    - `imagen?: ReactNode` (décor ou image de catégorie, D16) ;
    - `variante: "navegacion" | "contenido"` ;
    - `testId`.
  - **Variante `navegacion`** (page déjà or) : pas de fond propre, le bandeau est le haut de la
    page or.
  - **Variante `contenido`** : peint lui-même l'or **à fond perdu** (`data-bleed` dans
    `PageShell pagina`, `data-superficie="or"`), le contenu dessous restant clair.
  - **Disposition** :
    - colonne de la page ; padding 24 px en haut (32 à partir de `sm`), 32 px en bas (48 à partir
      de `sm`) ; 12 à 16 px entre les éléments ;
    - ordre : fil d'Ariane → lien retour → **H1** (`TituloRubrica tamano="pagina"`) → chapô (rôle
      `chapo`, 60 caractères par ligne au plus) → meta → action ;
    - `imagen` à droite à partir de `lg`, décorative et masquable sous `lg` (c'est du décor).
  - Collé au header or (même or, sans filet) : header et bandeau forment un seul bloc.
- **Fichiers** : `components/organisms/BandeauPagina.tsx` (+ test, story `Structure/BandeauPagina`).
  États de la story :
  - les deux variantes ;
  - avec et sans chapô ;
  - un titre de trois lignes ;
  - avec recherche ;
  - avec CTA ;
  - avec image.
- **Pièges** :
  - **Un seul `<h1>`** : la page ne doit plus en rendre un autre ; le test le vérifie.
  - Pas d'image `priority` ici : le LCP d'une page intérieure est sa première photo de contenu.
  - Le bandeau ne rend aucun JSON-LD : il reste dans `page.tsx`.
- **Vérifier** : la story ; puis chaque page P qui l'adopte, à 360, 390 et 1 280 px.
- Dépend de S1, F3, F7, C3 · Arbitrage D1 · Effort M

#### S3 — `SeccionRiel` : le rail de l'accueil, réutilisable
- **Pourquoi** : T9. C'est le motif central de l'accueil ; l'index par type (P1) et la fiche
  établissement (P4) doivent pouvoir le rendre.
- **Aujourd'hui** :
  - `app/[locale]/(vitrine)/SeccionPortada.tsx` (serveur) : titre, trait, motif, conteneur, tuiles,
    « GO → » ;
  - `FilaPortada.tsx` (client) : la rangée et ses voiles, par le crochet `useBordesDesplazables`
    exporté de `components/molecules/CarruselConSombra.tsx` ;
  - tous les écarts sont en `cqw` **de la section**, qui est son propre conteneur de requête : le rail
    marche donc dans **n'importe quelle** colonne.
- **Cible** : déplacer et paramétrer ces deux fichiers.
  - `components/organisms/SeccionRiel.tsx` (serveur) et `components/molecules/FilaRiel.tsx` (client).
    Le crochet de mesure suit, ou reste importé de son module actuel.
  - **Props** (celles de `SeccionPortada`, plus) :
    - `tamanoTitulo: "portada" | "seccion"` ;
    - `prioridad?: boolean` : la première tuile reçoit `priority`. Jamais sur l'accueil, dont le LCP
      est l'illustration ;
    - `motivo?: boolean` (vrai par défaut) ;
    - `mostrarVerMas` et `hrefVerMas` facultatifs : pas de « GO » quand il n'y a pas de page « voir
      tout », comme sur une fiche établissement.
  - Les tuiles sont celles de S4.
  - `page.tsx` (accueil) importe `SeccionRiel tamanoTitulo="portada"` : **rendu identique au pixel**.
- **Fichiers** :
  - les deux nouveaux fichiers ;
  - `SeccionPortada.tsx` et `FilaPortada.tsx`, supprimés une fois l'accueil branché, avec leurs tests
    **déplacés**, pas supprimés ;
  - `app/[locale]/(vitrine)/page.tsx` ;
  - stories `Écrans/Accueil`.
- **Pièges** :
  - Les `data-testid` (`seccion-<tipo>`, `-titulo`, `-fila`, `-velo-izquierda`, `-velo-derecha`,
    `-ver-mas`, ceux des tuiles) restent identiques : `e2e/home.spec.ts` et
    `reorder-secciones-tras-agregar.spec.ts` les cliquent.
  - Garder le test « pas de `"use client"` » sur `SeccionRiel`.
  - Garder aussi le test qui tient l'accord tuile ↔ voiles : les voiles de `FilaRiel` recouvrent
    l'arrondi de la tuile, ils doivent porter le **même** rayon (16 px, `rounded-l-[16px]` /
    `rounded-r-[16px]`, sans variante `md:`).
  - Sur fond clair, le rail marine et le motif bleu restent ; la flèche du « GO » prend
    `--flecha-go` (F3).
- **Vérifier** :
  - accueil à 360, 390, 768 et 1 280 px, mesuré avant/après : largeur de tuile, **tuile carrée**
    (hauteur = largeur), rayon de 16 px, décalage du conteneur, liseré, voiles ;
  - e2e `home.spec.ts`.
- Dépend de S1, S4, S5 · Arbitrage D7 · Effort L

#### S4 — Tuile photo unique
- **Pourquoi** : T10. Deux cartes photo coexistent : la tuile de l'accueil, et `Card
  layout="overlay"` (listings, chambres d'un établissement). Les deux diffèrent par l'arrondi, la
  police, le nombre de lignes, les bulles et le carrousel (plus par la proportion : toutes deux
  carrées depuis le 2026-10-02).
- **Aujourd'hui** :
  - **accueil** (`Tesela` dans `SeccionPortada.tsx`) : **carrée** (`aspect-square`), rayon **16 px
    fixes** (`rounded-[16px]`), une photo, nom Poppins 700 majuscules sur 2 lignes, bulles à bord de
    1,5 px ;
  - **listings** (`TarjetaOferta` `grilla`/`carrusel` → `Card layout="overlay"`) : carré, rayon
    **8 px** (`rounded-2xl`, mesuré), `PhotoStrip` à flèches, nom dans un `h3`, donc en **police de
    titre**, sur 1 ligne tronquée, bulles à bord de 2 px.
- **Cible** (D6 = A) : `components/molecules/TeselaOferta.tsx`, serveur, qui utilise l'atome `Image`
  (il n'importe que `next/image`). C'est la `Tesela` de l'accueil, extraite.
  - **Forme** : carrée (`aspect-square`), arrondie à **16 px fixes** (`rounded-[16px]`) dans **tous**
    les contextes — rail de l'accueil (202 à 288 px de large), grille de catégorie (jusqu'à 300 px),
    fiche établissement. Le reste de l'intérieur (cartouche, bulles, texte) reste en `cqw` de la
    tuile, donc proportionnel à sa largeur.
  - **Props** :
    - `oferta` ;
    - `locale` ;
    - libellés déjà traduits : `labelDesde`, `labelCapacidad?` (« Hasta 2 personas »),
      `labelConteo?` (« 3 alojamientos », carte groupée) ;
    - `sizes` ;
    - `prioridad?`.
  - Rendu du §2.3, lignes 20 à 23, avec des **planchers** : nom ≥ 13 px, établissement ≥ 12 px,
    bulles ≥ 11 px.
  - Une bulle par information présente (prix sous ses quatre formes, capacité), jamais de bulle vide.
  - Photo `alt=""` : le lien porte déjà le nom de l'offre ; c'est la décision prise sur l'accueil.
  - `TarjetaOferta` `grilla` et `carrusel` rendent `TeselaOferta`. `lista` ne change pas.
  - Si **D6 = B** (carrousel conservé), `TeselaOferta` reçoit un emplacement facultatif pour le
    `PhotoStrip`, qui reste client, et S9 rend les flèches visibles.
- **Fichiers** :
  - `components/molecules/TeselaOferta.tsx` (+ test, story `Molécules/TeselaOferta`) ;
  - `components/molecules/TarjetaOferta.tsx` (+ test) ;
  - `SeccionRiel` (S3) ;
  - `components/atoms/Card.tsx` : la disposition `overlay` ne sert plus, à retirer en G5.
- **Pièges** :
  - Le texte alternatif « <nom>, foto i de n » disparaît des cartes : c'est voulu, une seule photo
    décorative et un lien nommé. Le dire dans le test.
  - **Le rayon ne s'écrit ni en `cqw` ni par l'échelle** : `rounded-2xl` rend 8 px dans le thème
    vitrine (§3.4), et un rayon en `cqw` varierait d'une grille à un rail. `rounded-[16px]`, et un test
    qui le fige (celui de `SeccionPortada.test.tsx` est le modèle). Les cartes de listing passent ainsi
    de 8 à 16 px : c'est voulu.
  - `sizes` exact par contexte : rail (`(min-width: 1024px) 276px, (min-width: 768px) 27vw, 78vw`) ;
    grille 3 colonnes de la colonne de 960 px (`(min-width: 1024px) 300px, (min-width: 768px) 45vw,
    90vw`).
  - Ne pas importer `TeselaOferta` dans un composant client qui l'enfermerait dans le bundle sans
    raison : elle est rendue côté serveur partout où c'est possible.
- **Vérifier** : `ecrans-categorie--con-descripcion`, `ecrans-fiche-etablissement--completa`,
  `ecrans-index-par-type--alojamientos` (carte groupée « 3 alojamientos ») ; accueil inchangé.
- Dépend de — · Arbitrage D6 · Effort M

#### S5 — `EnlaceGo` : le « GO → » extrait
- **Pourquoi** : c'est le lien de marque de l'accueil ; il sert aussi « voir tout », « voir
  l'établissement » et « voir le détail ».
- **Aujourd'hui** : dans `SeccionPortada.tsx` :
  - `go.webp` de 28 à 52 px ;
  - une flèche SVG bleu poudre ;
  - au survol : GO à ×1,05, flèche +4 px ;
  - nom accessible « GO » + libellé en `sr-only` ;
  - cible de 44 px.
- **Cible** : `components/atoms/EnlaceGo.tsx` (serveur).
  - **Props** :
    - `href` ;
    - `label` (le libellé complet, déjà traduit, en `sr-only` après « GO ») ;
    - `tamano: "portada" | "normal"` (`portada` = les `clamp` en `cqw` de l'accueil ; `normal` =
      GO de 32 px, flèche de 20 px) ;
    - `testId`.
  - Flèche de couleur `var(--flecha-go)` (F3) ; mouvement coupé en mouvement réduit.
- **Pièges** :
  - `go.webp` est marine et bleu ciel : **jamais sur une surface marine**.
  - Pas dix liens au nom identique vers dix URL : le `label` nomme toujours la cible (« Ver todo:
    Agua », « Ver Casa Kayam »).
- **Vérifier** : accueil identique ; story sur or et sur clair.
- Dépend de F3 · Arbitrage — · Effort S

#### S6 — `Aviso` : encadré info, succès, alerte, erreur
- **Pourquoi** : T22. Six encadrés ad hoc ; sur l'or, une couleur d'état est illisible (§3.1).
- **Cible** : `components/molecules/Aviso.tsx` (serveur).
  - **Props** :
    - `tono: "info" | "exito" | "alerta" | "error"` ;
    - `titulo?: string` ;
    - `children` ;
    - `accion?: ReactNode` ;
    - `rol?: "status" | "alert"` (le rôle actuel de chaque appelant est conservé) ;
    - `testId`.
  - **Rendu** :
    - `data-superficie="clara"`, fond blanc, rayon de 16 px, padding de 16 à 20 px ;
    - bordure de 1 px à la couleur du ton (info bleu moyen, succès, alerte ou erreur du thème) ;
    - icône SVG de 20 px à gauche : i, coche, triangle ou croix ;
    - titre Poppins 600 16 px, corps 15 – 16 px marine, rangée d'actions facultative ;
    - **jamais la couleur seule** : l'icône et le titre disent le ton.
  - **Remplace** :

    | Encadré actuel | Où | Ton |
    |---|---|---|
    | bandeau camp / événement | `IndiceCategoriasConOfertas` | info |
    | « hébergement requis » | `mi-viaje/page.tsx` | alerte |
    | réservations en attente | `PendingOrdersNotice` | info |
    | statut de commande | `OrderResult` | selon l'état |
    | zone de suppression | `DeleteAccountSection` | erreur |
    | ligne indisponible | `CartSummary` | erreur, compact |
    | refus (places, hôtel) | `CheckoutForm` | erreur |
    | échec de chargement | `ListadoInfinito` | erreur, action « Reintentar » |
    | états PMS | `LodgingReservationForm` | alerte / erreur |

- **Pièges** : conserver chaque `data-testid` et chaque `role` existant sur l'élément extérieur
  (les e2e les lisent).
- **Vérifier** : la story ; puis `ecrans-index-par-type--alojamiento-para-camp`,
  `ecrans-mi-viaje--camp-sin-alojamiento`, `ecrans-pago--cupo-agotado`,
  `ecrans-resultat-reservation--*`.
- Dépend de F3 · Arbitrage — · Effort S (composant) ; l'adoption se fait dans les items P

#### S7 — Puce de statut
- **Pourquoi** : T23. Un statut doit se lire d'un coup d'œil, et pas par la seule couleur.
- **Cible** : `components/atoms/PuceEstado.tsx` (serveur, un `span`).
  - **Props** :
    - `tono: "exito" | "alerta" | "error" | "info" | "neutro"` ;
    - `children` (libellé traduit) ;
    - `testId`.
  - **Rendu** :
    - pilule de 28 px, Poppins 600 13 px ;
    - icône de 14 px + texte ;
    - fond teinté du ton à environ 12 % et texte du ton, contraste ≥ 4,5:1 **mesuré** ;
    - `neutro` : bleu poudre et marine.
  - **Correspondance** (table explicite dans le composant ou chez l'appelant) :

    | Objet | Tons |
    |---|---|
    | États de commande (`OrderResultPage.status.*`, `lib/orders/orderState.ts`) | `paid`, `confirmed` → succès · `unpaid` → alerte · `awaiting` → info · `failed`, `expired`, `paid_not_honored` → erreur · `cancelled` → neutre · `refunded` → info |
    | États de ligne (`lineStatus.*`) | `reserved` → neutre · `fulfilled` → succès · `no_show` → alerte · `cancelled_by_client`, `cancelled_by_provider`, `expired` → erreur · `superseded` → neutre |
    | Éditions de camp | « N cupos » → neutre · « Completo » → erreur |
    | Événement | « Gratis » → succès |

- **Vérifier** : la story (tous les tons) ; `ecrans-resultat-reservation--*` et
  `ecrans-mes-reservations--todas-las-variantes`.
- Dépend de F3 · Arbitrage — · Effort S

#### S8 — État vide illustré, avec action
- **Pourquoi** : T24. Un état vide doit relancer le parcours.
- **Aujourd'hui** : `components/molecules/EstadoVacio.tsx` = un titre de 16 px et une description de
  14 px en `text-muted`, sans action.
- **Cible** :
  - nouvelles props `accion?: ReactNode` et `ilustracion?: "motivo" | null` ;
  - une découpe du motif (A6) de 120 à 160 px, décorative ;
  - titre en rôle `titre-bloc` (Anton, 22 px) ;
  - description en rôle `corps` (16 px, marine sur l'or grâce à F3) ;
  - action : un bouton, ou un « GO → ».
  - Il reste un composant serveur.
- **Utilisé par** :
  - les recherches sans résultat de l'accueil, de l'index et de la catégorie ;
  - la section vide d'un index ;
  - Mi viaje vide (P5) ;
  - Mis reservas sans réservation (P8) ;
  - un établissement sans offre (P4).
- **Vérifier** : `ecrans-accueil--sin-resultados`, `ecrans-index-par-type--seccion-vacia`,
  `ecrans-mi-viaje--vacio`, `ecrans-mes-reservations--sin-reservas`.
- Dépend de S1 (et F3) · Arbitrage — · Effort S

#### S9 — Carrousel photo : flèches et points visibles
- **Pourquoi** : T15.
- **Aujourd'hui** : `packages/ui/src/components/carousel.tsx` rend :
  - deux `Button` HeroUI `outline` `sm`, de 32 px, à glyphe « ‹ » / « › », posés sur la photo ;
  - des points `bg-primary` / `bg-muted`.
  - Il sert **aussi l'admin** (`apps/admin/components/catalog-card.tsx`).
- **Cible** :
  - **prop additive** `controles?: "defecto" | "sobreFoto"`, avec `defecto` = le rendu actuel (l'admin
    ne change pas) ;
  - `sobreFoto` :
    - boutons ronds de 44 px, fond blanc à 90 %, chevrons SVG marine (plus de glyphes typographiques),
      ombre `--overlay-shadow`, flou d'arrière-plan léger, à 12 px du bord, centrés verticalement ;
    - points de 8 px, l'actif marine, les autres bleu poudre ;
    - ou un compteur « 1 / 5 » en bulle (§2.3, ligne 22) en bas à droite ;
  - `PhotoStrip` passe `controles="sobreFoto"` et arrondit la photo à 24 px.
- **Fichiers** : `packages/ui/src/components/carousel.tsx` (additif), `components/molecules/PhotoStrip.tsx`
  (+ stories `Affichage/PhotoStrip`).
- **Vérifier** : `ecrans-fiche-produit--actividad-con-franjas` et `ecrans-fiche-etablissement--completa`
  à 390 et 1 280 px : flèches visibles sur une photo claire et sur une photo sombre.
- Dépend de — · Arbitrage D6 (si les cartes gardent le carrousel, elles en profitent aussi) · Effort S

#### S10 — Calendrier à la charte, et en espagnol
- **Pourquoi** : T14 (défaut connu n° 2) et T29 (cases de 28 px, sous les 44 px) ; c'est le
  composant le plus utilisé du tunnel.
- **Aujourd'hui** : `components/molecules/Calendar.tsx` enveloppe le `legacy-calendar` de
  `packages/ui` (react-day-picker).
  - Mois et jours en anglais : les formulaires ne passent pas de `locale`, comme le documente l'en-tête
    du fichier.
  - Fond `bg-surface-secondary`, cases de 44 px.
  - Aujourd'hui souligné ; jour complet barré.
- **Cible** (par les `classNames` du wrapper d'`apps/web`, **sans toucher** `legacy-calendar`) :
  - **Taille** : d'abord trouver pourquoi la fiche rend le calendrier à sa taille par défaut.
    Vérifier que les formulaires passent bien par `Calendar.tsx`, et que `CLASSE_CALENDRIER` atteint
    la racine rendue. Cible : le calendrier occupe la largeur du panneau, jusqu'à `max-w-sm`, avec des
    cases de **44 px au minimum**.
  - **Langue** : `locale` es ou en, transmise par les quatre formulaires de réservation et par
    `DateRangeField`.
  - **Conteneur** : blanc, bordure marine de 1 px, rayon de 16 px, padding de 12 à 16 px.
  - **En-têtes** :
    - mois en rôle `titre-bloc` (Anton 18 – 20 px), avec majuscule initiale ;
    - jours de la semaine en Poppins 600 12 px majuscules, bleu moyen ;
    - flèches de navigation : boutons fantômes de 44 px, chevrons SVG.
  - **Jours** :
    - jour disponible : marine, 16 px ;
    - **jour choisi** (seul, début ou fin) : **fond or, chiffre marine** (6,31:1), rayon des boutons
      (D4) ;
    - milieu de plage : bleu poudre et marine ;
    - aujourd'hui souligné, complet barré, comme aujourd'hui ;
    - désactivé en `--muted` ;
    - prix et stock sous le jour : 11 – 12 px, `--muted`.
- **Fichiers** :
  - `components/molecules/Calendar.tsx` (+ tests) ;
  - `components/molecules/DateRangeField.tsx` ;
  - `app/[locale]/(vitrine)/productos/[slug]/{ReservationForm,SlotReservationForm,LodgingReservationForm,EventoReservationForm}.tsx`.
- **Pièges** : ne pas modifier `packages/ui/src/components/legacy-calendar.tsx` (partagé) ; l'en-tête
  de `Calendar.tsx` documente des pièges mesurés (opacités empilées, barré sur le bouton) : les
  respecter.
- **Vérifier** : `ecrans-fiche-produit--actividad-con-fecha`, `--alojamiento-rango-elegido`,
  `--camp-edicion-elegida`, `ecrans-accueil--calendario-abierto`, en `es` et en `en`.
- Dépend de F3 · Arbitrage — (D4 pour le rayon) · Effort M

#### S11 — Champs de formulaire à la charte (48 px)
- **Pourquoi** : T6. Les champs font 42 px, sous les 44 px.
- **Cible** :
  - **Champ** : 48 px de haut (44 au minimum) ; rayon des boutons (D4) ; bordure de 1 px
    `--field-border` ; focus 2 px `--focus` décalé de 2 px.
  - **Libellé** : Poppins 500 15 px marine ; astérisque `danger` + mention « obligatorio » en
    `sr-only` (vérifier l'existant).
  - **Aide et erreur** : 14 px ; en erreur, bordure `danger` + icône.
  - **`PhoneField`** : indicatif et numéro forment **un seul groupe visuel** (bords extérieurs
    arrondis, filet de séparation).
  - **Case à cocher** : 20 px, libellé 15 – 16 px.
- **Fichiers** :
  - `components/atoms/{Field,Select,Textarea,PhoneField,Checkbox}.tsx` ;
  - `components/molecules/CamposContrasena.tsx` ;
  - stories `Saisie/*`, tests.
- **Vérifier** : `ecrans-pago--invitado`, `--telefono-invalido`, `ecrans-connexion--credenciales-rechazadas`,
  `ecrans-mon-profil--modificado`.
- Dépend de F3, F4 · Arbitrage D4 · Effort S

### 6.4 Pages (P)

Chaque item de page part du rendu capturé le 2026-10-02 (§4) et vise une composition. Les items F,
C et S dont il dépend font le gros du travail ; l'item P **assemble** et règle ce qui est propre à
l'écran.

#### P1 — Index par type (`/actividades`, `/alojamientos`, `/transportes`, `/camps`, `/eventos`)
- **Pourquoi** : T9, T1, T10. C'est la page la plus proche de l'accueil, mais elle porte encore sa
  première version.
- **Aujourd'hui** (`app/[locale]/(vitrine)/IndiceCategoriasConOfertas.tsx`, `PageShell large`) :
  - en tête, sur fond clair : fil d'Ariane, H1 de 24 px, recherche, bandeau camp / événement
    éventuel ;
  - puis, par catégorie, un `SeccionOfertas variante="carrusel"` :
    - une bande or pleine largeur où le titre défile en boucle au scroll (`BandaTitulo`, huit copies,
      « ↓ ») ;
    - un conteneur bleu poudre de cartes carrées à carrousel ;
    - une languette portant un bouton or « Más actividades » ;
  - 24 px de fond clair séparent deux bandes ;
  - six offres au plus par catégorie (`POR_CATEGORIA`).
- **Cible** (D1 = A, D7 = A) :
  - **Page or entière**, comme l'accueil : `PageShell variant="pagina" fondo="acento"`. Le header or
    (C1) se fond dans la page.
  - **Bandeau `navegacion`** (S2) :
    - fil d'Ariane (C3) ;
    - **H1 à point** « Actividades● » ;
    - chapô éditorial si D14 = oui (nouvelle clé `ListadoPage.chapo.<tipo>`, es + en, texte fourni
      par Jérôme) ;
    - recherche (`BuscadorInicio`, inchangée).
  - Bandeau camp / événement : `Aviso` info (S6), blanc sur l'or.
  - **Une `SeccionRiel` par catégorie** (S3, `tamanoTitulo="seccion"`) : « Agua● » et son trait, le
    motif, le rail marine, les tuiles (S4), les voiles.
    - « GO → » vers la page de la catégorie, **seulement s'il y a plus d'offres** (règle actuelle :
      `total > tarjetas.length`).
    - Nom accessible : **« Ver todo: Agua »**, nouvelle clé `ListadoPage.verCategoria` avec
      `{categoria}`, es + en. Il remplace « Más actividades », répété pour chaque catégorie.
  - Espacement entre sections : celui de l'accueil (32 → 72 px). Plus aucune bande claire.
  - **Catégorie de rattrapage** : son titre vient de `ListadoPage.sinTag.<tipo>.nombre` (« Otras
    actividades »). Corrige le `<h2>` vide, défaut connu n° 5.
  - **LCP** : `prioridad` sur la première tuile de la première section.
  - Sous `md` : une tuile visible par section, comme l'accueil.
- **Fichiers** :
  - `app/[locale]/(vitrine)/IndiceCategoriasConOfertas.tsx` ;
  - `messages/{es,en}/ListadoPage.json` ;
  - stories `Écrans/Index par type` (`app/[locale]/(vitrine)/*/page.stories.tsx`) ;
  - `SeccionOfertas` (variante `carrusel`) et `BandaTitulo` ne servent plus : G5.
- **Pièges** :
  - Les `data-testid` `categoria-<slug>` et `categoria-<slug>-ver-mas` sont lus par
    `e2e/categorias.spec.ts` et `listados.spec.ts` : les porter sur la `SeccionRiel` et son « GO ».
  - L'en-tête du fichier justifie `mostrarVerMas` (pas de lien vers la même page) : garder la règle.
  - `generateMetadata` et le JSON-LD `BreadcrumbList` sont inchangés.
- **Vérifier** :
  - stories `ecrans-index-par-type--actividades`, `--alojamientos` (carte groupée), `--camps`,
    `--sin-resultados`, `--seccion-vacia`, `--alojamiento-para-camp`, `--alojamiento-para-evento`,
    à 360, 390 et 1 280 px ;
  - e2e `categorias.spec.ts` et `listados.spec.ts`.
- Dépend de S2, S3 (donc S1, S4, S5), S6, C3 · Arbitrages D1, D7, D14 · Effort M

#### P2 — Page de catégorie (`/[type]/[categoria]`)
- **Pourquoi** : T1, T10, T16.
- **Aujourd'hui** (`app/[locale]/(vitrine)/ListadoTipo.tsx` + `components/organisms/ListadoInfinito.tsx`) :
  - fond clair ;
  - fil d'Ariane, H1 de 24 px, description en `text-muted`, recherche ;
  - grille de cartes carrées (1 / 2 / 3 colonnes) dans 704 px ;
  - « 3 de 3 ofertas » ;
  - bouton « Cargar más » (or, 12 px) ;
  - états chargement, erreur et vide.
- **Cible** :
  - **Page or entière** (D1 = A) : bandeau `navegacion`.
    - fil d'Ariane à 3 niveaux ;
    - **H1 à point** « Agua● » ;
    - **chapô = la description de la catégorie** (rôle `chapo`, marine sur l'or, 60 caractères par
      ligne), en gardant `data-testid="categoria-descripcion"` ;
    - recherche ;
    - si D16 = oui, l'image de la catégorie à droite à partir de `lg`.
  - **Grille de `TeselaOferta`** (S4) : 1 colonne sous `md`, 2 en `md`, 3 en `lg` ; écart de 16 px
    (24 en `lg`), dans la colonne de 960 px. Tuiles carrées comme les cartes d'aujourd'hui : la
    hauteur d'une rangée ne change que par l'élargissement de la colonne (704 → 960 px, F7), pas par
    la forme.
  - Compteur « 3 de 3 ofertas » en rôle `meta`, marine, centré.
  - « Cargar más » : **bouton `marine`** (F4 : un bouton or disparaîtrait sur l'or), `lg`, centré.
  - Chargement : le bouton en attente (`isPending`) ; échec : `Aviso` erreur + « Reintentar » ;
    vide : `EstadoVacio` illustré (S8), avec une action vers la page du type.
- **Fichiers** :
  - `app/[locale]/(vitrine)/ListadoTipo.tsx` ;
  - `components/organisms/ListadoInfinito.tsx` (classes de grille, bouton, états) ;
  - stories `Écrans/Catégorie` ;
  - `TarjetaOferta` (S4).
- **Pièges** :
  - Le canonical ignore `?pagina=` (spec 29) : inchangé.
  - Le `sizes` des tuiles de la grille (S4).
  - Les e2e `listados.spec.ts` et `categorias.spec.ts`.
- **Vérifier** : `ecrans-categorie--con-descripcion`, `--sin-descripcion`, `--otras`, `--cargar-mas`,
  `--cargando`, `--error-al-cargar`, `--sin-resultados`.
- Dépend de S2, S4, S6, S8, C3, F4 · Arbitrages D1, D16 · Effort M

#### P3 — Fiche produit (`/productos/[slug]`)
- **Pourquoi** : T1, T2, T3, T12, T14, T15, T16. C'est la page de **conversion** : le prix et
  l'action doivent rester visibles.
- **Aujourd'hui** (`productos/[slug]/page.tsx` → `PageShell large` → `FichaProducto.tsx`, client) :
  - fil d'Ariane (qui déborde à 390 px), « ← Volver al catálogo » ;
  - **une seule carte bordée** contenant :
    - le H1 de 24 px (faux gras en production) et la description ;
    - les photos (`PhotoStrip`, flèches presque invisibles) ;
    - le prix en 18 px / 500 ;
    - les faits (couchage, capacité, unités), les équipements (H2 18 px, H3 14 px), l'occurrence
      (événement), le transport ;
    - le **bloc de réservation** selon `modoReserva` : « Disponibilidad » en 14 px, calendrier en
      anglais, « Cantidad », CTA or de 36 px ; ou bouton de contact (vitrine) ;
    - le programme (camp), la politique d'annulation en 12 px ;
  - une seconde carte « établissement » : titre de 14 px, photos, description, adresse ;
  - le tout dans 704 px.
- **Cible** (D10 = A) :
  - **Bandeau `contenido`** (S2), or à fond perdu :
    - fil d'Ariane (C3) et lien retour (C4) ;
    - **H1 = nom du produit**, rôle `titre-page`, **sans point** ;
    - **meta** : « Ofrecido por <Casa del Embalse> » (lien vers l'établissement, nouvelle clé
      `ProductPage.ofrecidoPor`) · adresse ;
    - puis des **puces** (S7 `neutro`) pour les faits disponibles : type de couchage, capacité,
      unités, occurrence (événement), horaires du transport, « Gratis ».
  - **Contenu clair**. À partir de `lg`, **deux colonnes** (2/3 + 1/3) :
    - **gauche** :
      - galerie (`PhotoStrip`, photo arrondie à 24 px, contrôles S9, `sizes` recalculés pour
        ≈ 620 px) ;
      - description (rôle `corps`, 17 px en `lg`, `max-w-prose`) ;
      - « Equipamiento » (`titre-bloc`, liste sur 2 colonnes, en-têtes `etiqueta`) ;
      - « El plan, día a día » (camp : `titre-bloc`, un jour = une `etiqueta` + puces) ;
      - lien Google Maps (transport, bouton secondaire) ;
      - **carte « Ofrecido por »** : photo ronde de 72 px, nom (`titre-bloc`, lien), description sur
        2 lignes, adresse, `EnlaceGo` « Ver Casa del Embalse ».
    - **droite**, **panneau de réservation collant** (`sticky`, sous le header : 64 px + 16) : carte
      blanche, bordure marine de 1 px, rayon de 16 px, padding de 24 px.
      - Prix en `prix-fort` + unité en `meta` (« por persona »), ou libellé libre, ou puce
        « Gratis ».
      - Note « paiement sur place » si elle existe.
      - Le **formulaire de réservation** inchangé dans sa logique : titres `bloque` (F2),
        calendrier (S10), champs (S11), CTA or `lg` **pleine largeur** (F4).
      - Courte politique d'annulation en `Aviso` info compact.
      - Mode vitrine : `BotonContacto` pleine largeur à la place du formulaire.
  - **Sous `lg`** : une colonne, dans l'ordre suivant :
    1. bandeau ;
    2. galerie ;
    3. prix et puces ;
    4. description ;
    5. **panneau de réservation** ;
    6. équipements ;
    7. programme ;
    8. « Ofrecido por ».

    Plus une **barre collante en bas** : prix + bouton « Reservar », qui fait défiler jusqu'au
    panneau ; masquée quand le panneau est visible. Seule cette barre est nouvelle côté
    comportement : un défilement par ancre, sans logique métier.
  - Cas limites, tous déjà gérés par le code, à **garder** :
    - pas de photo : aplat au bon ratio ;
    - pas de prix : aucun bloc ;
    - événement sans lien : pas de panneau ;
    - produit sans établissement : ni « Ofrecido por » ni niveau intermédiaire du fil.
  - États PMS (lecture, injoignable, quota, connecteur coupé) : `Aviso` dans le panneau.
- **Fichiers** :
  - `app/[locale]/(vitrine)/productos/[slug]/page.tsx` (`PageShell`, bandeau, JSON-LD inchangé) ;
  - `FichaProducto.tsx` (mise en page) ;
  - les 4 formulaires de réservation (F2, F4, S10, S11) ;
  - `BotonContacto.tsx`, `ProgramaCamp.tsx` ;
  - `components/molecules/{AmenidadesList,PhotoStrip}.tsx` ;
  - `messages/{es,en}/ProductPage.json` (`ofrecidoPor`, `verEstablecimiento`, libellé de la barre
    collante) ;
  - stories `Écrans/Fiche produit` (21).
- **Pièges** :
  - Spec 30 invariant 2 : **un seul `<h1>`**, dans le bandeau, donc plus dans `FichaProducto`.
    `FichaProducto` est **client** ; le bandeau peut être rendu par `page.tsx` (serveur) avec les
    données déjà lues.
  - Le JSON-LD `Product` / `Event` décrit exactement ce que la page affiche : ne rien retirer de
    visible qu'il décrit.
  - Les 32 tests DOM des formulaires (spec 30) et les e2e `reserve*.spec.ts` lisent des
    `data-testid` qui doivent tous rester (`product-name`, `product-price`, `product-photos`…).
  - La barre collante ne doit cacher ni le toast (C4) ni le bas du formulaire : réserver sa hauteur
    en bas de page.
- **Vérifier** :
  - les 21 stories `ecrans-fiche-produit--*`, au minimum : `actividad-con-franjas`,
    `actividad-con-fecha`, `camp`, `camp-edicion-elegida`, `alojamiento-pms`,
    `alojamiento-rango-elegido`, `transporte`, `evento-vitrina`, `evento-gratis-inscripcion`,
    `precio-consultar-sin-foto`, `anadido-al-viaje`, `pms-inalcanzable` ;
  - à 360, 390, 1 024 et 1 280 px ;
  - parcours `parcours-reserver-activite--ficha-2`.
- Dépend de S2, S4, S6, S7, S9, S10, S11, F2, F4, C3, C4 · Arbitrage D10 · Effort L

#### P4 — Fiche établissement (`/establecimientos/[slug]`)
- **Pourquoi** : T1, T3, T10, T16.
- **Aujourd'hui** (`FichaEstablecimiento.tsx`, client) :
  - une carte bordée : H1 de 24 px, adresse, photos, description, horaires, CTA « Contactar por
    WhatsApp » or pleine largeur, équipements ;
  - puis « Habitaciones » et « Actividades y servicios » (H2 de 18 px) en **grilles de cartes de
    224 px** : noms en police de titre tronqués, deux grosses bulles sur la photo.
- **Cible** :
  - **Bandeau `contenido`** :
    - fil d'Ariane ;
    - **H1 = nom** (`titre-page`, sans point) ;
    - meta : adresse ;
    - puces « Check-in desde 15:00 » et « Check-out hasta 11:00 » ;
    - action : **« Contactar por WhatsApp » en bouton `marine`** (sur l'or) avec glyphe.
  - **Contenu clair** :
    - galerie (S9, 24 px) ;
    - description (`corps`) ;
    - « Equipamiento » (`titre-bloc`, 2 à 3 colonnes).
  - **« Habitaciones● »** et **« Actividades y servicios● »** : une `SeccionRiel`
    (`tamanoTitulo="seccion"`, sans « GO »), avec rail marine et motif sur fond clair. Tuiles S4,
    bulles prix et capacité.
  - Sans offre : `EstadoVacio` (S8).
- **Fichiers** :
  - `app/[locale]/(vitrine)/establecimientos/[slug]/{page,FichaEstablecimiento}.tsx` ;
  - `productos/[slug]/BotonContacto.tsx` (couleur selon la surface) ;
  - stories `Écrans/Fiche établissement`.
- **Pièges** :
  - `data-testid` `establishment-lodgings`, `establishment-activities`, `establishment-name`,
    `establishment-contact-link` : lus par `e2e/establishment-page.spec.ts`.
  - Le H1 sort de la carte vers le bandeau : un seul `<h1>`.
- **Vérifier** : `ecrans-fiche-etablissement--completa`, `--minima`, `--sin-ofertas` ; parcours
  `parcours-hebergement-nuits--establecimiento-3`.
- Dépend de S2, S3, S8, S9, F2 · Arbitrage — · Effort M

#### P5 — Mi viaje (`/mi-viaje`)
- **Pourquoi** : T2, T5, T6, T11, T13, T18, T24. C'est la première marche du tunnel.
- **Aujourd'hui** (`app/[locale]/(tunnel)/mi-viaje/page.tsx`, `<main>` à la main, `max-w-2xl p-8`) :
  - H1 de 24 px (faux gras) ;
  - `CartSummary` : carte titrée « Tu viaje del 14 oct al 16 oct » ; lignes bordées dans la carte ;
    dates ISO ; « Quitar » de 32 px à 12 px de rayon ; « Total » en 18 px ; « Total a pagar ahora »
    en 14 px gris ;
  - « Reservar » de 40 px à 4 px de rayon ;
  - encadré camp ; encadré « réservations en attente » ;
  - vide : une phrase grise ;
  - pas de pied (tunnel).
- **Cible** (D11 = A) :
  - `PageShell variant="pagina"` + **bandeau `contenido` compact** :
    - **H1 à point** « Mi viaje● » ;
    - chapô = les dates du voyage (« Del 14 al 16 de octubre »), déplacées hors de la carte ;
    - lien retour « Seguir explorando » vers l'accueil, en gardant les critères ;
    - pas de fil d'Ariane (tunnel).
  - À partir de `lg`, **deux colonnes** :
    - **gauche** : la liste des lignes (F6) dans une carte blanche, lignes à séparateurs. Pour
      chaque ligne :
      - nom en Poppins 600 16 – 17 px ;
      - meta : établissement · **date lisible** (« mié 14 oct · 10:00 », « 14 → 16 oct · 2 noches »,
        défaut connu n° 7, via les formateurs de date existants) · quantité ;
      - montant à droite (Poppins 600) ;
      - « Quitar » en bouton fantôme de 44 px avec icône poubelle et libellé visible ;
      - ligne indisponible : `Aviso` erreur compact.
    - **droite**, collant : **récapitulatif** :
      - « Total » ;
      - **« Anticipo a pagar hoy »** mis en avant dans un aplat bleu poudre, en `prix-fort` ;
      - phrase d'explication courte : le reste se paie dans chaque établissement. Nouvelle clé
        `CartPage`, à rédiger, sous réserve de Jérôme ;
      - CTA **« Reservar »** or `lg` pleine largeur ;
      - politique d'annulation en `meta`.
  - Sous `lg` : lignes, puis récapitulatif, puis **CTA collant en bas** (« Reservar · 83.300 COP »).
  - **Camp sans hébergement** : `Aviso` alerte avec les deux actions (CTA désactivé + « Elegir
    alojamiento »).
  - **Réservations en attente** : `Aviso` info avec les liens.
  - **Vide** : `EstadoVacio` illustré « Tu viaje está vacío » + action « Explorar actividades »
    (« GO » vers `/`).
- **Fichiers** :
  - `app/[locale]/(tunnel)/mi-viaje/page.tsx` ;
  - `components/organisms/CartSummary.tsx` ;
  - `app/[locale]/(tunnel)/PendingOrdersNotice.tsx` ;
  - `messages/{es,en}/CartPage.json` (si nouvelles clés) ;
  - stories `Écrans/Mi viaje`.
- **Pièges** :
  - `CartSummary` sert aussi Pago (P6), en non éditable : la variante compacte doit y rester
    cohérente.
  - Le calcul « 17 % » est dans `CartSummary` (`Math.round(total * 0.17)`) : n'en déplacer que
    l'affichage, jamais la règle.
  - `data-testid` `cart-line-*`, `remove-line-*`, `cart-total`, `cart-total-now`, `go-to-checkout`,
    `lodging-required-notice`, `pending-orders` : lus par les e2e `cart-*.spec.ts`.
- **Vérifier** : les 8 stories `ecrans-mi-viaje--*` ; parcours `parcours-reserver-activite--mi-viaje-3`
  et `parcours-camp-hebergement--mi-viaje-bloqueado-2`.
- Dépend de S2, S6, S8, F6, F2, F4 · Arbitrage D11 · Effort M

#### P6 — Pago (`/pago`)
- **Pourquoi** : T2, T6, T11, T13, T18. C'est la dernière marche avant le paiement.
- **Aujourd'hui** (`app/[locale]/(tunnel)/pago/page.tsx`, `<main>` à la main) :
  - H1 « Completa tu reserva » ;
  - `CartSummary` non éditable ;
  - `CheckoutForm` : champs de 42 px, téléphone, e-mail, case promotions, note d'annulation,
    « Confirmar reserva » de 36 px à 12 px de rayon ;
  - lien « Inicia sesión… » décalé.
- **Cible** (D11 = A) :
  - Bandeau `contenido` compact : **« Completa tu reserva● »**, chapô = les dates du voyage.
  - À partir de `lg`, deux colonnes :
    - **gauche** :
      - formulaire « Tus datos » (`titre-bloc`) avec les champs S11 et le groupe téléphone ;
      - case promotions ;
      - `Aviso` info : politique d'annulation ;
      - **« Confirmar reserva »** or `lg` pleine largeur ;
      - dessous, aligné à gauche, le lien « Inicia sesión para encontrar tus reservas » (invités).
    - **droite** : récapitulatif compact collant (`CartSummary` non éditable, F6), avec total et
      anticipo.
  - Sous `lg` : récapitulatif d'abord. Repliable, si Jérôme le veut (ce serait un comportement en
    plus) ; puis le formulaire et le CTA.
  - Refus (plus de places, refus de l'hôtel) : `Aviso` erreur **en tête du formulaire**, avec le
    message actuel.
  - En attente : bouton `isPending` avec le libellé existant.
- **Fichiers** :
  - `app/[locale]/(tunnel)/pago/{page,CheckoutForm}.tsx` ;
  - `CartSummary.tsx` ;
  - stories `Écrans/Pago`.
- **Pièges** :
  - Défaut connu n° 3 (`CheckoutForm` sans `noValidate`) : c'est un correctif fonctionnel. Le
    signaler, ne pas le mêler à l'item, sauf demande.
  - Ne pas toucher l'ordre des appels (`.claude/rules/apps.md`, « Formulaires et états »).
  - e2e `reserve.spec.ts`, `cart-resume-pending-order.spec.ts`.
- **Vérifier** : les 9 stories `ecrans-pago--*` ; parcours `parcours-reserver-activite--pago-4`.
- Dépend de S2, S6, S11, F6, F4 · Arbitrage D11 · Effort M

#### P7 — Résultat de réservation (`/reserva/[token]`)
- **Pourquoi** : T2, T11, T13, T22, T23. C'est l'écran que le client garde : il doit dire en un coup
  d'œil où en est sa réservation.
- **Aujourd'hui** (`app/[locale]/(vitrine)/reserva/[token]/page.tsx`, `PageShell narrow`, puis
  `OrderResult.tsx`) :
  - H1 « Reserva HFG-000123 » de 24 px ;
  - encadré d'état (vert, rouge ou neutre, `role="status"`) ;
  - « Pagar el anticipo » (or, 12 px) ;
  - carte « Tu viaje del… » aux lignes bordées : dates ISO, « Reservada » en 12 px, montants
    (`MontantsLigne`) ;
  - totaux ;
  - « Datos de contacto » (H2 de 14 px) ;
  - liens secondaires.
- **Cible** :
  - **Bandeau `contenido`** :
    - H1 « Reserva HFG-000123 » (`titre-page`) et, à côté (dessous sur mobile), **la puce d'état**
      (S7, ton par état) ;
    - chapô : le détail de l'état (`status.<etat>Detail`).
  - **Contenu clair** (colonne `max-w-2xl`, ou deux colonnes en `lg` : détail à gauche, contact et
    actions à droite) :
    - **`Aviso`** de l'état, ton par état, en gardant `role="status"` et
      `data-testid="order-state-<etat>"`, avec l'erreur de paiement et la note PMS ;
    - **CTA « Pagar el anticipo »** or `lg` (ou « Reintentar el pago »), placé dans l'`Aviso` ou
      juste dessous ;
    - carte des lignes (F6) : pour chaque ligne, nom, établissement (lien), date lisible, quantité,
      **puce d'état de ligne** (S7) et `MontantsLigne` restylé (libellés `meta`, montants Poppins 600
      en chiffres tabulaires, alignés à droite) ;
    - **totaux** dans un aplat bleu poudre : « Total », « Anticipo (pago en línea) » ;
    - « Datos de contacto » (`titre-bloc`) en liste de définitions ;
    - « Guarda este enlace » en `Aviso` info ;
    - « Crear una cuenta » / « Ver mis reservas » en bouton secondaire ou `EnlaceGo`.
- **Fichiers** :
  - `app/[locale]/(vitrine)/reserva/[token]/{page,OrderResult}.tsx` ;
  - `components/molecules/MontantsLigne.tsx` ;
  - stories `Écrans/Résultat de réservation` (13).
- **Pièges** :
  - **L'état vient de `deriveOrderState`**, jamais du paramètre `?payment=` : l'item ne touche qu'à
    l'affichage.
  - `data-testid` `order-state-*`, `pay-button`, `retry-payment-button`, `payment-error`,
    `pms-notice`, `trip-summary`, `keep-link`, `view-orders-link`, `guest-cancel-hint` : lus par
    `e2e/payment-return.spec.ts`.
  - Cette page est exclue par un **`Disallow`** (`/es/reserva/`, `/en/reserva/` dans
    `app/robots.ts`), **sans `noindex`**. C'est voulu, d'après la règle SEO 5 et le commentaire de
    `page.tsx` : ne pas ajouter de `robots` dans ses métadonnées.
- **Vérifier** : les 13 stories `ecrans-resultat-reservation--*` (au minimum : `por-pagar`,
  `pago-rechazado`, `confirmando`, `pagado`, `confirmado-sin-pago`, `expirado`, `anulado`,
  `lineas-mixtas`) ; parcours `parcours-paiement-reprise--*`.
- Dépend de S2, S6, S7, F6, F2, F4 · Arbitrage — · Effort M

#### P8 — Mis reservas (`/cuenta/reservas`)
- **Pourquoi** : T2, T3, T11, T13, T23.
- **Aujourd'hui** :
  - H1 de 24 px ; groupes « Próximas » / « Pasadas » en H2 de 14 px ;
  - `OrderCard` : titre « Reserva HFG-… » et état en texte ; lignes bordées dans la carte, dates
    ISO, « Anular » en contour rouge ; « Ver detalle » souligné ;
  - confirmation d'annulation dans la ligne ;
  - vide : texte + bouton ;
  - erreur : texte rouge.
- **Cible** :
  - **Bandeau `contenido`** : « Mis reservas● ».
  - Groupes « Próximas » / « Pasadas » en `titre-bloc`.
  - **`OrderCard`** :
    - en-tête : « Reserva HFG-… » (`titre-bloc`), **puce d'état** (S7), dates du voyage en `meta` ;
    - lignes à séparateurs (F6) : nom, établissement (lien), date lisible, quantité, **puce d'état
      de ligne**, `MontantsLigne`, « Anular » en bouton fantôme `danger` de 44 px ;
    - pied de carte : `EnlaceGo` « Ver detalle ».
  - **Confirmation d'annulation** (`CancelLineButton`) : `Aviso` alerte dans la ligne avec « Sí,
    anular » (`danger` plein) et « No » (fantôme). **L'échec doit être visible** (défaut connu
    n° 4 : aujourd'hui invisible après « No ») : `Aviso` erreur.
  - Vide : `EstadoVacio` illustré + « Explorar actividades ».
  - Erreur de chargement : `Aviso` erreur.
- **Fichiers** :
  - `app/[locale]/(cuenta)/cuenta/reservas/{page,OrderCard,CancelLineButton}.tsx` ;
  - `MontantsLigne.tsx` ;
  - stories `Écrans/Mes réservations`.
- **Pièges** :
  - Défaut connu n° 4 : rendre l'échec visible est un correctif d'affichage ; ne pas toucher l'appel.
  - e2e `mis-reservas.spec.ts`.
- **Vérifier** : les 8 stories `ecrans-mes-reservations--*`.
- Dépend de S2, S6, S7, S8, F6 · Arbitrage — · Effort M

#### P9 — Mi perfil (`/cuenta/perfil`)
- **Pourquoi** : T2, T6.
- **Aujourd'hui** :
  - H1 de 24 px ;
  - formulaire (nom, WhatsApp) ;
  - « Guardar » (or, désactivé par défaut) ;
  - « Ver mis reservas » (contour) ;
  - « Cerrar sesión » (contour, plus petit) ;
  - zone « Eliminar mi cuenta » bordée, avec titre de 14 px.
- **Cible** :
  - **Bandeau `contenido`** : « Mi perfil● », chapô = l'e-mail du compte s'il est disponible, sans
    nouvelle lecture de données.
  - Formulaire dans une carte blanche `max-w-xl` (S11), avec « Guardar » or `lg`.
  - Ligne d'actions secondaires : « Ver mis reservas » (bleu poudre plein) et « Cerrar sesión »
    (fantôme), tous deux à 44 px.
  - **Zone de suppression** : `Aviso` erreur (« Eliminar mi cuenta » en titre), avec « Eliminar
    cuenta » en contour `danger`. Le parcours de confirmation (e-mail à retaper) reste dans
    l'encadré.
  - Compte professionnel : `Aviso` info qui explique le blocage.
- **Fichiers** :
  - `app/[locale]/(cuenta)/cuenta/perfil/{page,ProfileForm,LogoutButton,DeleteAccountSection}.tsx` ;
  - stories `Écrans/Mon profil`.
- **Pièges** : e2e `perfil.spec.ts` ; les messages de succès et d'erreur du formulaire gardent leur
  `role`.
- **Vérifier** : les 11 stories `ecrans-mon-profil--*`.
- Dépend de S2, S6, S11, F4 · Arbitrage — · Effort S

#### P10 — Authentification (`/entrar`, `/registro`, `/olvide-password`, `/restablecer-password`, `/verificar-email`)
- **Pourquoi** : T2, T6, T18. C'est le seul endroit sans header de site : la marque doit s'y voir le
  plus.
- **Aujourd'hui** (`app/[locale]/(auth)/layout.tsx` + 5 pages) :
  - en-tête minimal (petit logo en haut à gauche) ;
  - `<main>` à la main, centré, `p-8` ;
  - H1 de 24 px (faux gras) ;
  - formulaire de 384 px : Google en contour, séparateur « o », champs de 42 px, CTA or de 12 px de
    rayon, liens soulignés.
- **Cible** (D12 = A) :
  - **À partir de `lg`, écran scindé 50 / 50** :
    - **à gauche, panneau or** (`data-superficie="or"`, pleine hauteur) :
      - le grand logo (`logo-portada.webp`, ≈ 260 px) ;
      - le slogan en Poppins 800, **en `<p>`, pas en `<h1>`** ;
      - la rue aux zócalos en bas, version allégée (A6), décorative, chargement différé.
    - **à droite, fond clair** : la **carte de formulaire** centrée :
      - blanche, rayon de 24 px, bordure marine de 1 px, padding de 32 px, `max-w-md` ;
      - **H1** (`titre-page`, ≈ 40 px) ;
      - Google pleine largeur, 48 px ;
      - séparateur « o » ;
      - champs S11 ;
      - CTA or `lg` pleine largeur ;
      - liens secondaires.
  - **Sous `lg`** : un bandeau or de 160 à 200 px (logo centré), puis la carte de formulaire qui le
    chevauche de 32 px, avec des gouttières de 20 px.
  - Le lien vers l'accueil est porté par le logo, comme aujourd'hui.
  - Succès affichables (e-mail envoyé, renvoi) : `Aviso` succès ; erreurs : `Aviso` erreur.
  - `robots: noindex` du layout : inchangé.
- **Fichiers** :
  - `app/[locale]/(auth)/layout.tsx` et les 5 `page.tsx` ;
  - les formulaires `{LoginForm,SignupForm,ForgotPasswordForm,ResetPasswordForm,ResendConfirmationForm}.tsx` ;
  - `components/molecules/{GoogleButton,CamposContrasena}.tsx` ;
  - stories `Écrans/Connexion`, `Inscription`, `Mot de passe oublié`, `Nouveau mot de passe`,
    `Vérification e-mail`.
- **Pièges** :
  - Un seul `<h1>` : le slogan du panneau est un `<p>`.
  - Le logo du panneau est décoratif, à côté d'un lien nommé « Hifago ».
  - e2e `login.spec.ts`, `signup.spec.ts`, `forgot-password.spec.ts`.
  - L'illustration ne doit pas devenir le LCP : `loading="lazy"`, pas de `priority`, chargée à partir
    de `lg` seulement.
- **Vérifier** : `ecrans-connexion--formulario`, `--credenciales-rechazadas`,
  `ecrans-inscription--formulario`, `ecrans-mot-de-passe-oublie--correo-enviado`,
  `ecrans-nouveau-mot-de-passe--enlace-invalido`, `ecrans-verification-email--reenvio-exitoso`, à 390
  et 1 280 px ; parcours `parcours-compte--*`.
- Dépend de S11, F4, F2, A1, A6 · Arbitrage D12 · Effort M

#### P11 — 404 et écrans d'erreur
- **Pourquoi** : T21. Une 404 doit relancer la navigation ; une panne doit rassurer.
- **Aujourd'hui** :
  - `app/[locale]/not-found.tsx` : `<main>` à la main, H1 de 24 px, texte, lien « Volver al
    inicio » ;
  - `components/organisms/ErrorScreen.tsx` (pannes vitrine, tunnel et compte) : H1, texte, deux
    liens mal alignés.
- **Cible** :
  - **404** (D13 = A) : **page or** (même mécanisme que l'accueil, `fondo="acento"`).
    - La rue aux zócalos (version allégée, A6), décorative.
    - **H1** « Esta página no existe » (`titre-page`) et texte (`corps`, marine).
    - **Bouton `marine`** « Volver al inicio ».
    - Une rangée de liens vers les cinq types, avec le même style que `MenuTiposPortada`. Il faudra
      alors remonter ce composant dans `components/`, puisqu'il aura deux usages.
    - Statut 404 et `noindex` : inchangés (convention Next).
  - **Erreurs** : sur fond clair, sous le header de la zone.
    - Le titre (`titre-page`) et le texte.
    - « **Reintentar** » en bouton or et « **Volver al inicio** » en bouton secondaire, **alignés sur
      une ligne**.
    - Petite découpe de motif décorative.
- **Fichiers** :
  - `app/[locale]/not-found.tsx` ;
  - `components/organisms/ErrorScreen.tsx` ;
  - `app/[locale]/(vitrine)/MenuTiposPortada.tsx` (déplacé si réutilisé) ;
  - stories `Écrans/Erreurs et page introuvable`.
- **Pièges** :
  - `not-found.tsx` rend `CoquillaVitrine` lui-même (header et pied) : ne pas doubler la coquille.
  - L'écran d'erreur doit rester sans lecture de données, puisqu'il s'affiche quand la base est en
    panne.
- **Vérifier** : `ecrans-erreurs--pagina-no-encontrada`, `--error-en-la-vitrina`,
  `--error-en-el-tunel`, `--error-en-la-cuenta`.
- Dépend de S1, F4, F2 · Arbitrage D13 · Effort S

#### P12 — Accueil : résidus
- **Pourquoi** : §2.5. Ces points se traitent **sans rien rouvrir** de ce que Jérôme a validé.
- **Cible** :
  1. Contraste du texte discret sur l'or (description de l'état vide, message d'état de la
     recherche) : réglé par F3, à **vérifier** ici.
  2. Pied marine (C2) sous la page or : vérifier la jonction or → marine, sans bande claire.
  3. **Vocabulaire** (D8) : appliquer la décision dans `HomePage.tiposPortada`, `HomePage.secciones`
     et `HomePage.masPorTipo`, en `es` et en `en`. Le titre de section de l'accueil, le menu, le H1 et
     le fil d'Ariane des listings disent alors le même mot.
  4. Une fois S1, S3 et S5 faits, l'accueil consomme `TituloRubrica`, `SeccionRiel` et `EnlaceGo`. Le
     rendu doit être identique au pixel, ce qui est vérifié dans ces items.
- **Fichiers** : `messages/{es,en}/HomePage.json` (D8) ; rien d'autre de propre à cet item.
- **Pièges** :
  - Changer un libellé de type change les **titres et les métadonnées** des listings (`meta.title`
    utilise `secciones`) : vérifier `seo.spec.ts`.
  - L'URL `/camps` ne bouge pas.
- **Vérifier** : `ecrans-accueil--defecto`, `--sin-resultados`, `--con-criterios` à 390 et 1 280 px.
- Dépend de F3, C2 · Arbitrages D3, D8 · Effort S

### 6.5 Assets (A)

#### A1 — Logo pour le header or
Recréer **`public/brand/logo-header-sur-or.webp`**, la déclinaison **sans or**, puisque le « GO » or
disparaîtrait sur l'or. La source est `HIFAGO logo fond clair BLEU.png` de la charte, déjà copiée en
`public/brand/logo-horizontal-marine-bleu.png`.
- Recadrer au contenu.
- 96 px de haut, pour un affichage à 48 px en 2×.
- WebP de 8 Ko environ, comme `logo-header-clair.webp`.

Ce fichier a existé lors de la première passe du 2026-10-01, puis il a été retiré avec le header or
de cette version (commentaire de `globals.css`, « FOND OR »). `LogoHifago` gagne une variante `sobre`
(C1).

#### A2 — Favicon et icônes
- `app/favicon.ico` est **celui de Next.js** (25 931 octets).
- Le produire depuis le **logo carré** de la charte (`LOGO carre bleu.png`, copié en
  `public/brand/logo-carre-marine-bleu.png`) : `favicon.ico` en 32 et 48 px.
- Ajouter `app/icon.png` (512 px) et `app/apple-icon.png` (180 px), selon les conventions de fichiers
  de métadonnées de Next.
- Vérifier la lisibilité du lockup à 32 px. S'il est illisible, ne garder que le carré « GO », à
  faire valider par Jérôme.

#### A3 — Image de partage (Open Graph, Twitter)
- Aucune aujourd'hui : `lib/seo/pageMetadata.ts` ne pose pas d'`images`.
- Produire une image **1 200 × 630** : fond or, logo marine et bleu ciel, slogan en Poppins 800,
  traits de la rue.
- La déclarer pour tout le site, en fichier statique `opengraph-image.png` (convention Next) à
  l'endroit qui couvre toutes les routes localisées.
- Les fiches gardent la possibilité d'une image propre plus tard (première photo), mais **pas dans
  cet item**.
- Effet attendu : partages WhatsApp et réseaux à l'image de Hifago, d'où un meilleur taux de clic.

#### A4 — Police Sugo Pro Display (si D5 = A)
- Acheter la **licence web** de Sugo Pro Display (Zetafonts). Le dossier
  `../Charte Graphique/Sugo pro display font/` ne contient que des fichiers **d'essai**, sous licence
  CC BY-NC, avec une notice commerciale : ils sont inutilisables en production.
- Produire un `woff2` **sous-ensemble** (latin, chiffres, ponctuation espagnole : `¿ ¡ ñ á é í ó ú`)
  de la graisse Bold.
- L'héberger dans `apps/web` et le charger par `next/font/local` dans `app/[locale]/layout.tsx`,
  **déclaré à la graisse 400**, la seule qu'utilisent les titres.
- `--font-titre` = Sugo, puis Anton en repli.
- Retirer la surcharge d'essai de `preview-head.html`.
- Revoir `--tracking-titre` dans le rendu de production.

Si D5 = B (Anton confirmé) : réévaluer seulement `--tracking-titre`, réglé à l'œil sur Sugo.

#### A5 — Logo horizontal large
Point déjà au backlog (« Charte (b) ») : demander au graphiste une déclinaison **sur une ligne**
(« hifaGO · Guatapé »). Le lockup actuel est presque carré (ratio 1,74:1), illisible sous 48 px. Le
header y gagnerait en lisibilité et en place à 360 px. **Hors code**, demande à faire.

#### A6 — Découpes décoratives allégées
- Une découpe de `calle-zocalos.webp` pour l'auth et la 404 : environ 900 × 600, au plus 120 Ko.
  L'original fait 401 Ko et il est le LCP de l'accueil.
- Une bande de `motif-or.webp` pour le pied (environ 1 600 × 120).
- Deux ou trois vignettes de motif pour les états vides (environ 320 × 320).
- Toutes en WebP, décoratives.

#### A7 — Ménage de `public/`
Dans `public/brand/`, retirer de `public/` les sources que le code ne sert pas (≈ 1,2 Mo publiés) :
`logo-carre-*.png`, `logo-horizontal-*.png`, après A1 et A2 qui en dérivent. Les originaux restent dans
le dossier de la charte, hors dépôt.

Autres fichiers à traiter :
- `public/logo-hifago.svg` : ancien logo provisoire ; vérifier qu'il n'est plus utilisé, puis le
  retirer ;
- les SVG de démarrage de Next (`file`, `globe`, `next`, `vercel`, `window`) : ils ne servent qu'aux
  stories `Card`, `Image` et `PhotoStrip` ; les remplacer par une photo de `/mock`, puis les retirer.

Chaque suppression se fait **grep à l'appui**.

### 6.6 Garde-fous et documentation (G)

#### G1 — `scripts/check-charte.sh` (brancher dans `npm run verify` et la CI)
Une règle qu'aucun contrôle ne vérifie n'est pas une règle (`CLAUDE.md` §11.20). Contrôles, avec
exemptions **nommées** comme dans `check-tokens.sh` :
1. Pas de `font-semibold`, `font-bold`, `font-extrabold` ni `font-medium` sur un `<h1>`–`<h3>` ni
   dans `Title`. Exemption nommée : le `<span>` du slogan de l'accueil.
2. Pas de `text-xs` ni `text-sm` sur un `<h1>`–`<h3>`.
3. Pas de texte or (`text-accent`, `text-[var(--accent)]`, `text-[var(--charte-or)]`) hors des
   fichiers de surface marine listés.
4. Pas de `text-white` avec `bg-accent`.
5. Pas de `<main` écrit à la main hors de `PageShell`. Exemptions nommées : `ErrorScreen`, et
   `not-found.tsx` s'il garde le sien.
6. Pas de `rounded-[var(--radius)]` sur un bouton : le rayon des boutons vient de l'atome.

Effort M.

#### G2 — `.claude/rules/ui.md`
Ajouter un paragraphe court, « Style Hifago », de 15 lignes au plus pour que la règle reste sous ses
100 lignes :
- les trois surfaces et leurs couleurs de texte ;
- les rôles typographiques ;
- le rayon des boutons ;
- l'interdiction des titres sous 20 px en police de titre ;
- un renvoi vers ce plan.

Retirer de la règle ce qui deviendrait faux, par exemple « Polices : Poppins (corps) et Anton
(titres) » si D5 = A. Effort S.

#### G3 — `apps/web/components/README.md`
- Supprimer la section périmée « Deux constats à connaître, non corrigés » (T25).
- Ajouter les nouveaux composants au tableau « Où va quoi » et aux groupes de stories :
  - `Affichage/` : `TituloRubrica`, `PuceEstado`, `Aviso`, `TeselaOferta` ;
  - `Structure/` : `BandeauPagina` ;
  - `Actions/` : `EnlaceGo` ;
  - `Structure/` ou `Molécules/` : `SeccionRiel`.

Effort S.

#### G4 — Planche de référence `Playground/Charte`
Une story qui montre **le style sur une page**. C'est la référence à ouvrir avant tout nouvel écran :
- les trois surfaces, avec texte, discret, lien, champ et boutons sur chacune, contrastes affichés ;
- les rôles typographiques, rendus en police de production et en police de Storybook ;
- les rayons ;
- les composants signature : titre à point, bandeau, rail avec trois tuiles, `EnlaceGo`, `Aviso` des
  quatre tons, puces de statut.

Compléter `Playground/Palette → Contrastes` avec les couples des surfaces (F3). Effort M.

#### G5 — Ménage final (grep à l'appui, après migration)
Retirer ce qui ne sert plus, avec ses tests et ses stories :
- `BandaTitulo` ;
- `SeccionOfertas`, ou sa variante `carrusel` si `grilla` / `lista` servent encore ;
- `CarruselConSombra`, si plus rien ne l'utilise ; son crochet `useBordesDesplazables` suit le rail ;
- `SiteMenu` ;
- `Card layout="overlay"` ;
- les variantes `large`, `narrow` et `centered` de `PageShell` ;
- si D9 = A, le mode sombre de la vitrine ;
- **après accord de Jérôme**, les cinq pistes de comparaison de `globals.css`, environ 400 lignes
  livrées en production pour rien. Elles sont « le dossier de la décision » : les archiver d'abord,
  au journal ou dans un fichier de `docs/`.

Effort M.

## 7. Ordre conseillé, lots, et chemin minimal par page

### 7.1 Le principe
D'abord les **fondations**, qui corrigent des défauts visibles sans changer la mise en page. Ensuite
la **coquille**, qui change toutes les pages d'un coup. Puis les **composants signature**, testés sur
l'accueil, qui doit rester identique. Enfin les **pages**, une famille à la fois. Les items d'un même
lot se font un par un, avec une vérification après chacun.

⚠️ Travailler page par page laisse le site **temporairement mélangé** : certaines pages au nouveau
style, d'autres à l'ancien. C'est acceptable sur la branche ; **ne pas déployer en production un état
à moitié fait**, sauf accord de Jérôme.

### 7.2 Les lots
| Lot | Items, dans l'ordre | Arbitrages à trancher avant | Ce qu'on voit après |
|---|---|---|---|
| **1. Fondations** | F5 → F1 → F2 → F3 → F6 | D1 et D9 (pour F3) ; D5 n'est pas bloquant | Titres lisibles et sans faux gras partout ; contraste corrigé sur l'accueil ; fin des doubles bordures ; Storybook lisible |
| **2. Boutons, champs, gabarit** | F4 → S11 → F7 → G1 | D4 | Un seul rayon, cibles de 44 / 48 px ; toutes les pages sur la colonne de l'accueil ; garde-fou en CI |
| **3. Coquille** | A1 → C1 → C2 → C3 → C4 | D2, D3 | Header or et pied marine partout ; fil d'Ariane qui ne déborde plus |
| **4. Composants signature** | S1 → S5 → S4 → S3 → S6 → S7 → S8 → S9 → S10 → S2 | D6, D7, D15 | Rien ne change sur l'accueil (identique au pixel) ; nouvelles stories |
| **5. Navigation** | P1 → P2 → P12 | D1, D8, D14, D16 | Index et catégories à l'image de l'accueil |
| **6. Fiches** | P3 → P4 | D10 | Fiches en deux colonnes, panneau de réservation |
| **7. Tunnel** | P5 → P6 → P7 | D11 | Mi viaje, Pago et le résultat à la charte |
| **8. Compte, authentification, erreurs** | P8 → P9 → P10 → P11 | D12, D13 | Plus aucun écran à l'ancien style |
| **9. Assets et ménage** | A2 → A3 → A4 ou A5 (selon D5) → A6 → A7 → G2 → G3 → G4 → G5 | D5 | Favicon, image de partage, documentation à jour, code mort retiré |

### 7.3 Chemin minimal pour une seule page
Pour refaire **une** page sans tout le reste, appliquer dans l'ordre (les items déjà faits se
sautent) :

| Page | Chemin |
|---|---|
| Index par type | F1 F2 F3 F4 F7 · A1 C1 C3 · S1 S5 S4 S3 S6 S2 · **P1** |
| Catégorie | F1 F2 F3 F4 F7 · C3 · S1 S4 S6 S8 S2 · **P2** |
| Fiche produit | F1 F2 F3 F4 F7 · C3 C4 · S1 S6 S7 S9 S10 S11 S2 · **P3** |
| Fiche établissement | F1 F2 F3 F4 F7 · C3 · S1 S5 S4 S3 S8 S9 S2 · **P4** |
| Mi viaje | F1 F2 F3 F4 F6 F7 · S1 S5 S6 S8 S2 · **P5** |
| Pago | F1 F2 F3 F4 F6 F7 · S1 S6 S11 S2 · **P6** |
| Résultat de réservation | F1 F2 F3 F4 F6 F7 · S1 S5 S6 S7 S2 · **P7** |
| Mis reservas | F1 F2 F3 F4 F6 F7 · S1 S5 S6 S7 S8 S2 · **P8** |
| Mi perfil | F1 F2 F3 F4 F7 · S1 S6 S11 S2 · **P9** |
| Authentification | F1 F2 F3 F4 · S11 · A6 · **P10** |
| 404 et erreurs | F1 F2 F3 F4 · S1 · A6 · **P11** |
| Accueil (résidus) | F3 · C2 · **P12** |

Le header (C1) et le pied (C2) changent **toutes** les pages : ils ne font pas partie d'un chemin de
page, sauf l'index par type, que l'on veut voir avec son header or.

## 8. Inventaire : écrans → fichiers → stories → e2e

Les stories se trouvent dans Storybook, à l'adresse
`http://localhost:6006/?path=/story/<id>`. Leurs identifiants commencent par le préfixe indiqué ; la
liste complète des 128 états d'écran est dans `apps/web/components/README.md` (« Inventaire écran →
états »).

| Écran | Route | Fichiers principaux | Stories (nombre) | e2e | Items |
|---|---|---|---|---|---|
| Accueil | `/` | `(vitrine)/page.tsx`, `PortadaInicio`, `SeccionPortada`, `FilaPortada`, `MenuTiposPortada`, `BuscadorInicio` | `ecrans-accueil--*` (12) | `home`, `reorder-secciones-tras-agregar`, `attribution` | P12, F3, S1, S3, S5 |
| Index par type | `/actividades`, `/alojamientos`, `/transportes`, `/camps`, `/eventos` | `IndiceCategoriasConOfertas.tsx`, `*/page.tsx` | `ecrans-index-par-type--*` (9) | `categorias`, `listados` | P1 |
| Catégorie | `/<type>/<categoria>` | `ListadoTipo.tsx`, `ListadoInfinito.tsx` | `ecrans-categorie--*` (7) | `categorias`, `listados` | P2 |
| Fiche produit | `/productos/<slug>` | `page.tsx`, `FichaProducto`, 4 formulaires, `ProgramaCamp`, `BotonContacto` | `ecrans-fiche-produit--*` (21) | `reserve`, `reserve-lodging-range`, `reserve-lodging-pms-availability`, `reserve-concurrency` | P3 |
| Fiche établissement | `/establecimientos/<slug>` | `page.tsx`, `FichaEstablecimiento` | `ecrans-fiche-etablissement--*` (3) | `establishment-page` | P4 |
| Mi viaje | `/mi-viaje` | `(tunnel)/mi-viaje/page.tsx`, `CartSummary`, `PendingOrdersNotice` | `ecrans-mi-viaje--*` (8) | `cart-multi-establishment`, `cart-resume-pending-order` | P5 |
| Pago | `/pago` | `(tunnel)/pago/{page,CheckoutForm}.tsx` | `ecrans-pago--*` (9) | `reserve` | P6 |
| Résultat | `/reserva/<token>` | `page.tsx`, `OrderResult`, `MontantsLigne` | `ecrans-resultat-reservation--*` (13) | `payment-return` | P7 |
| Mis reservas | `/cuenta/reservas` | `page.tsx`, `OrderCard`, `CancelLineButton` | `ecrans-mes-reservations--*` (8) | `mis-reservas` | P8 |
| Mi perfil | `/cuenta/perfil` | `page.tsx`, `ProfileForm`, `LogoutButton`, `DeleteAccountSection` | `ecrans-mon-profil--*` (11) | `perfil` | P9 |
| Authentification | `/entrar`, `/registro`, `/olvide-password`, `/restablecer-password`, `/verificar-email` | `(auth)/layout.tsx`, 5 pages, 5 formulaires | `ecrans-connexion--*` (6), `ecrans-inscription--*` (5), `ecrans-mot-de-passe-oublie--*` (3), `ecrans-nouveau-mot-de-passe--*` (5), `ecrans-verification-email--*` (4) | `login`, `signup`, `forgot-password` | P10 |
| 404, erreurs | — | `not-found.tsx`, `ErrorScreen`, les trois `error.tsx` | `ecrans-erreurs--*` (4) | `seo` | P11 |
| Coquille | toutes | `SiteHeader`, `SiteFooter`, `LanguageSwitcher`, `SiteMenu`, `LogoHifago` | `coquille-*` (21) | — | C1–C4 |
| Parcours | — | `components/parcours/*` | `parcours-*` (27 étapes) | — | tous |

## 9. Annexes

### 9.1 Contrastes des couleurs de la charte (formule WCAG, couleurs brutes)
| Texte sur fond | Ratio | Verdict |
|---|---|---|
| marine sur or | 6,31 | ✅ texte |
| bleu moyen sur or | 3,17 | ❌ texte (✅ composant ≥ 3:1) |
| blanc sur or | 2,07 | ❌ |
| succès / alerte / erreur sur or | 3,39 / 2,58 / 3,73 | ❌ texte |
| marine sur clair (`#f0f6fc`) | 12,04 | ✅ |
| bleu moyen sur clair | 6,05 | ✅ |
| or sur clair | 1,91 | ❌ |
| bleu ciel sur clair | 2,71 | ❌ (décor seulement) |
| marine sur bleu poudre | 8,02 | ✅ |
| bleu moyen sur bleu poudre | 4,03 | ❌ petit texte |
| blanc sur marine | 13,07 | ✅ |
| bleu poudre sur marine | 8,02 | ✅ |
| or sur marine | 6,31 | ✅ |
| bleu ciel sur marine | 4,44 | ❌ petit texte (✅ ≥ 24 px) |
| bleu moyen sur marine | 1,99 | ❌ |
| succès / alerte / erreur sur blanc | 7,02 / 5,36 / 7,74 | ✅ |
| bleu poudre sur or (bords de la recherche) | 1,27 | — identifiée par la loupe et le texte |

⚠️ Ce sont des couleurs **brutes**. Une couleur composée (translucide, mélangée) se mesure dans la
story `Playground/Palette → Contrastes` : la bordure de champ vaut 6,22:1 brute et **3,97:1
composée**.

### 9.2 Mesures relevées dans le navigateur (2026-10-02)
| Objet | Valeur | Où |
|---|---|---|
| Rayon `Button` | 12 px | « Confirmar reserva », « Quitar » |
| Rayon `LinkButton` | 4 px | « Reservar », « Mi viaje » intérieur |
| Rayon « Mi viaje » de l'accueil (desktop) | 8 px | header de l'accueil |
| Tuile de l'accueil (après la révision « tuiles carrées ») | 275 × 275 px à 1 280, 202 × 202 à 768, 288 × 288 à 390, 264 × 264 à 360 ; rayon 16 px ; voiles 16 px. Avant : 275 × 289, 23 px (1 280) et 288 × 303, 24 px (390) | `ecrans-accueil--defecto` |
| Rayon des cartes de listing (`rounded-2xl`) | 8 px (`--radius-2xl` = 2 × `--radius`) | `ecrans-categorie--con-descripcion` |
| Hauteurs de bouton | 36 (« Confirmar reserva »), 32 (« Quitar »), 40 (« Reservar ») px | Pago, Mi viaje |
| Hauteur des champs | 42 px (texte), 44 px (téléphone) | Pago |
| Calendrier de la fiche | 212 px de large, cases de 28 × 28 px (à 390 comme à 1 280) | `ecrans-fiche-produit--actividad-con-fecha` |
| Titres de la fiche produit | H1 24 px / 600 ; H2 18 et 14 px / 500 ; H3 14 px / 600 | `ecrans-fiche-produit--alojamiento-pms` |
| Largeur de page à 390 px | 551 / 803 / 407 px | fiches PMS, « Consultar », événement vitrine |
| Texte discret sur l'or | `oklch(0.477 0.093 246.2)`, soit 3,17:1 | `ecrans-accueil--sin-resultados` |
| Colonne de contenu | accueil 960 · `large` 704 · `narrow` 672 · header et pied 768 | code |

### 9.3 Les 17 titres écrits à la main (F2)
| Fichier | Ligne | Balise | Classes |
|---|---|---|---|
| `app/[locale]/(auth)/entrar/page.tsx` | 39 | h1 | `text-2xl font-semibold` |
| `app/[locale]/(auth)/olvide-password/page.tsx` | 26 | h1 | `text-2xl font-semibold` |
| `app/[locale]/(auth)/registro/page.tsx` | 45 | h1 | `text-2xl font-semibold` |
| `app/[locale]/(auth)/restablecer-password/page.tsx` | 34 | h1 | `text-2xl font-semibold` |
| `app/[locale]/(auth)/verificar-email/page.tsx` | 35 | h1 | `text-2xl font-semibold` |
| `app/[locale]/(tunnel)/mi-viaje/page.tsx` | 66 | h1 | `text-2xl font-semibold` |
| `app/[locale]/(tunnel)/pago/page.tsx` | 88 | h1 | `text-2xl font-semibold` |
| `app/[locale]/not-found.tsx` | 27 | h1 | `text-2xl font-semibold` |
| `components/organisms/ErrorScreen.tsx` | 66 | h1 | `text-2xl font-semibold` |
| `app/[locale]/(cuenta)/cuenta/perfil/DeleteAccountSection.tsx` | 78 et 88 | h2 | `text-sm font-medium` |
| `app/[locale]/(vitrine)/productos/[slug]/EventoReservationForm.tsx` | 183 | h2 | `mb-2 text-sm font-medium` |
| `app/[locale]/(vitrine)/productos/[slug]/LodgingReservationForm.tsx` | 544 | h2 | `mb-2 text-sm font-medium` |
| `app/[locale]/(vitrine)/productos/[slug]/ReservationForm.tsx` | 271 et 298 | h2 | `mb-2 text-sm font-medium`, `text-sm font-medium` |
| `app/[locale]/(vitrine)/productos/[slug]/SlotReservationForm.tsx` | 209 | h2 | `mb-2 text-sm font-medium` |
| `components/molecules/AmenidadesList.tsx` | 18 | h3 | `text-sm font-semibold` |

Les numéros de ligne datent du 2026-10-02 ; les retrouver par
`grep -rn -E "<h[123][^>]*font-(semibold|bold|medium)" apps/web/app apps/web/components`.

### 9.4 Refaire les captures
- Storybook tourne (`npm run storybook -w @hifago/web`, port 6006).
- Une story seule, sans le cadre de Storybook :
  `http://localhost:6006/iframe.html?id=<id>&viewMode=story&globals=palette:aucune;mode:clair;radius:piste`.
- Police : Storybook affiche Anton, celle de la production, depuis F5 (2026-10-02).
- Le skill **`/hifago-rendu`** fait tout cela :
  - captures à 360, 390 et 1 280 px ;
  - détection du débordement horizontal ;
  - mode avant / après.

## 10. Suivi des items

À cocher par l'IA (ou à la main) quand un item est **terminé** au sens du §0 : date, commit ou PR,
remarque.

| ID | Item | Statut | Date | Commit / PR | Remarque |
|---|---|---|---|---|---|
| F1 | Rôles typographiques et jetons de taille | fait | 2026-10-02 | non commité | 5 jetons `--taille-…` + 6 classes de rôle en `@layer components` (toujours émises, battent la base `h1–h3`, perdent contre un utilitaire) ; valeurs calculées vérifiées à 390 et 1 280 px ; 9 captures identiques au pixel avant le changement de tracking. `--tracking-titre` : 0.0667em → **0.04em**, choisi par Jérôme sur une planche A/B/C/D (0.0667, 0.04, 0.02, 0) ; seuls les titres en Anton changent, hauteurs de page identiques, aucun débordement |
| F2 | `Title` par rôles, 17 titres en dur | fait | 2026-10-02 | non commité | `Title size` = `pagina`/`seccion`/`bloque`/`etiqueta` (classes de rôle de F1, aucune graisse ni taille Tailwind) ; les 17 titres en dur passent par `Title` ; `Card` gagne `titleSize="bloque"` (additif : `sm`/`md`/`lg` restent pour les tuiles jusqu'à S4) ; bloc établissement de la fiche produit : `Card.Title` h3 → `Title as="h2" size="bloque"`. Mesuré sur 23 écrans à 360/390/1 280 : page 32 → 52 px, section 26 → 40, bloc 20 → 22, étiquette Poppins 600 14 → 15, plus aucun faux gras ni police de titre sous 20 px **hors tuiles photo des listings** (h3 Anton 18 px en 700 : S4). Écart au plan : `OrderCard` (h3, non prévu) → `bloque`, d'où « Próximas » et les titres de commande à la même taille — à revoir en P8. Aucun débordement nouveau (les 551 px de `alojamiento-pms` et les 364–365 px à 360 de trois fiches existaient avant : calendrier) |
| F3 | Surfaces or / clair / marine | fait | 2026-10-02 | 713f5ee | `data-superficie` = `or` / `marine` / `clara` dans `globals.css` (valeurs du §3.2, `clara` relit les valeurs du thème via `--clara-*`) + `--punto-titulo`, `--trazo-titulo`, `--flecha-go` ; `--field-border-hover/-focus` redéclarés par surface. Écart de forme : `PageShell fondo="acento"` pose `data-superficie="or"` sur le `<main>` au lieu d'une règle sur `main[data-fondo]` ; header `transparente` idem. Mesuré : état vide de l'accueil 3,17 → 6,31:1 ; `Contrastes` 161 couples sans échec ; pages claires et popovers identiques au pixel. **Écart validé par Jérôme** (2026-10-02, gardé) : contour de « Mi viaje » (accueil, sous `md`) bleu moyen → marine, il lisait `--muted` |
| F4 | Boutons | fait | 2026-10-02 | « plan 41, F4 » | Jeton `--rayon-bouton` (`calc(var(--radius) * 2)`, 8 px, D4) lu par `RADIUS_CLASS` des quatre atomes et par le sélecteur de langue ; classes de taille de l'atome (couche `utilities`, battent `md:h-10` de HeroUI) : `sm` 44 px 14/500, `md` 44 px 16/600 (**nouveau défaut**, au lieu de `lg`), `lg` 48 px 16/600 ; icône seule 44 × 44 à toutes les tailles ; couleur `marine` (jetons `--bouton-marine*`, story `Actions/Button → Sur l'or` : 13,07 / 8,02 / 6,31 / 6,31:1). `lg` posé sur les six CTA de conversion + `BotonContacto`. **Écart au plan** : le « Button : 12 px » mesuré n'était pas un défaut de spécificité de l'atome (il rendait 4 px) mais **15 `Button` HeroUI bruts** importés de `@hifago/ui` dans 13 écrans (auth ×5, Pago, fiche ×5, résultat, `CartSummary`) : tous passés par l'atome, `data-testid` gardés en `testId`. Puces Fechas / Personas gardées en graisse 500 (filtres, pas des actions). Mesuré à 360/390/1 280 : plus aucun bouton de la famille sous 44 px ni hors 8 px ; restent les flèches du carrousel (S9), le calendrier (S10) et les champs (S11). Accueil : « Mi viaje » 4 → 8 px sous `md`, boutons 40 → 44 px et 500 → 600 au-dessus (page +4 px à 1 280) — conséquences de D4, à valider par Jérôme |
| F5 | Sugo d'essai retirée de Storybook | fait | 2026-10-02 | 5ff6b1a | révisé après D5 = B : Sugo retirée au lieu d'un `unicode-range` ; 9 captures (3 écrans × 360/390/1280) identiques au pixel au rendu Anton d'avant |
| F6 | Fin des bordures imbriquées | fait | 2026-10-02 | 1db9ebc | `Card padding="lg"` (additif : 20 → 24 px, le visuel à fleur suit) sur `CartSummary`, `OrderCard`, `OrderResult` ; lignes en `divide-y divide-separator`, 16 px ; totaux sous le même filet ; éditions de camp en tuiles `surface-secondary` 12 px, contour marine 2 px au survol et au choix (mesurés). Ligne indisponible et `DeleteAccountSection` terminées par S6 |
| F7 | Gabarit unique (`PageShell pagina`) | fait | 2026-10-02 | « plan 41, F7 » | Variante `pagina` : grille à trois colonnes de `large` (`1fr`, colonne, `1fr`) (fond perdu intact), colonne `min(60rem, 100% − 2.5rem)` puis `min(60rem, 100% − 4rem)` à partir de `sm`, sans padding haut, `pb-12`. Mesuré dans la story « Pagina alignée sur l'accueil » : bords du contenu identiques à ceux de `COLUMNA_PORTADA` à 360, 390, 640, 800, 1 024, 1 280 et 1 600 px (20 px à 390, 160 px à 1 280), aucun débordement ; `large`, `narrow`, `centered`, l'accueil et la fiche identiques au pixel. **Aucune page migrée ici**, conformément au §6 (« chaque `page.tsx`, dans son item P ») : sans son bandeau (S2), une page sans padding haut aurait son H1 collé au header. ⚠️ Le §7.2 annonce « toutes les pages sur la colonne de l'accueil » à la fin du lot 2 : ce ne sera vrai qu'au fil des items P (et de C1 / C2 pour le header et le pied). Au passage : la story `LargeAvecFondPerdu` ne montrait aucun fond perdu (l'enfant n'avait pas `col-span-full`, que `SeccionOfertas` pose, lui) — corrigée |
| C1 | Header unique or | fait | 2026-10-02 | « plan 41, C1 » | Une seule apparence : `data-superficie="or"`, `bg-accent`, sans bordure, ombre marine au défilement (`useADefile` sur toutes les pages), `COLUMNA_PORTADA`, `h-16` ; `sticky` partout, `fixed` + transparent en haut de l'accueil. Logo `LogoHifago variante="sobre"` (A1, une image, **sans `priority`** : `loading="eager"`, le LCP d'une page intérieure est sa photo, §3.8). « Mi viaje » identique à l'accueil ; pastille **marine, chiffre blanc** (jetons `--bouton-marine*`, liseré or) partout, accueil compris. Plus de burger ni de `SiteMenu` (gardé jusqu'à G5, il importe `ROUTE_COMPTE`/`ROUTE_CONNEXION`/`IconeCompte` du header). **Écart de forme** : les langues sont posées À CÔTÉ du `<nav>` principal, pas dedans — `LanguageSwitcher` rend son propre `<nav>` nommé, et deux landmarks imbriqués s'annoncent mal (disposition de l'accueil). `data-testid` : `…-menu-account`/`…-menu-language-*` deviennent `…-account`/`…-language-*` (ceux de l'accueil ; aucun e2e ne les lit, vérifié par grep). Mesuré : aucun débordement à 360/390/1 280 sur 12 stories (« Mi viaje » sur deux lignes à 360, sans repli « drapeau seul ») ; accueil panier vide **identique au pixel**, panier plein 0,02 % (la pastille) ; pages intérieures 1 px plus courtes (bordure retirée) ; focus marine visible sur l'or, ombre au défilement vues au navigateur. Messages `menuOpenLabel`/`menuCloseLabel` désormais inutilisés : G5 |
| C2 | Pied de page marine | fait | 2026-10-02 | « plan 41, C2 » | `<footer data-superficie="marine">`, colonne `COLUMNA_PORTADA`, 32/24 px puis 40/32 à partir de `md` ; deux colonnes à partir de `md`, empilé dessous. Gauche : `LogoHifago variante="sombre"` (forcé, une image sans `logo-clair`/`logo-sombre`, `h-14` : le WebP garde sa marge, dessin ≈ 45 px) puis « Hifago · Guatapé, Colombia » en `text-muted` 14 px (bleu poudre). Droite : WhatsApp `solid accent` (or, texte marine) avec glyphe en `currentColor`, puis la langue (menu) en blanc. `LanguageSwitcher` : `hover:text-default-foreground` sur le déclencheur (sans lui, blanc sur bleu poudre au survol) et `data-superficie="clara"` sur le panneau. Nav institutionnelle vide masquée par `has-[ul:empty]:hidden` (ni landmark muet ni écart fantôme). Zone compte : `SiteFooter` ajouté au layout ; tunnel toujours sans pied. **Non fait** : le bandeau décoratif `motif-or` (« facultatif, si Jérôme le veut », et il attend la découpe A6). Mesuré : aucun débordement à 360/390/1 280 (9 stories) ; sélecteur de langue (3 stories) identique au pixel ; couleurs calculées au navigateur = jetons de la charte (texte blanc, bleu poudre, bouton or, survol marine sur bleu poudre, panneau blanc, focus or). ⚠️ Les captures pleine page de `/hifago-rendu` montrent le pied **sans logo** : l'image est en chargement différé et la capture ne défile pas — en défilant réellement, il se charge (vérifié). `check-charte.sh` : aucune surface marine à déclarer (le pied n'écrit pas d'or en texte), commentaire mis à jour |
| C3 | Fil d'Ariane | fait | 2026-10-02 | « plan 41, C3 » | Cause du débordement mesurée au navigateur : le `li` du fil (HeroUI `shrink-0`, sans retour à la ligne) dans les quatre cas (551, 803, 407 px à 390 ; 688 pour la story `NombreLargo`). `Migas` : variantes arbitraires posées sur notre `<nav>` (couche `utilities`, battent les `.breadcrumbs__…` de HeroUI) — retour à la ligne avec 4 px entre lignes, éléments qui rétrécissent, liens `--link` soulignés au survol et au focus, page courante `--foreground` 600, séparateurs `--foreground` à 60 %, toutes couleurs lues sur la surface (marine sur l'or, vérifié dans la nouvelle story `SobreOro`). Sous `sm`, niveaux intermédiaires tronqués à 14ch avec ellipse ; dernier niveau sur deux lignes au plus (`line-clamp-2`). **Piège vu au rendu** : le lien HeroUI est `inline-flex`, `text-overflow` n'y prend pas — texte coupé net sans ellipse ; `block` sous `sm` sur les seuls niveaux tronqués. Mesuré : `scrollWidth` = largeur de vue à 360 et 390 sur les trois fiches, la fiche établissement et les stories du fil. JSON-LD : construit par les `page.tsx`, non touchés ; e2e `seo.spec.ts` non lancé (il demande la stack Supabase locale) |
| C4 | Lien retour, toasts | à faire | | | |
| S1 | `TituloRubrica` | à faire | | | |
| S2 | `BandeauPagina` | à faire | | | |
| S3 | `SeccionRiel` | à faire | | | |
| S4 | Tuile photo unique | à faire | | | |
| S5 | `EnlaceGo` | à faire | | | |
| S6 | `Aviso` | fait | 2026-10-02 | « plan 41, S6 » | `molecules/Aviso.tsx` (serveur, rien de `@hifago/ui`) : `data-superficie="clara"`, fond blanc, bordure 1 px et icône SVG 20 px au ton (info = `--link`), texte marine, rayon 16 px, padding 16 → 20 px ; aucun `role` par défaut. **Écart** : prop `compacto` en plus (12 px de rayon et de padding, texte 14 px), demandée par F6 pour la ligne indisponible. Adopté sur les deux restes de F6 : ligne indisponible de `CartSummary` (compact, sous la rangée, `role="alert"` et `data-testid` gardés) et `DeleteAccountSection` (le `<h2>` reste au-dessus, boîte rouge imbriquée de la confirmation supprimée ; compte pro en ton « alerte », à valider par Jérôme). Mesuré au navigateur à 390 et 1 280 px ; les 7 autres encadrés de la table restent aux items P |
| S7 | Puce de statut | à faire | | | |
| S8 | État vide illustré | à faire | | | |
| S9 | Carrousel photo | à faire | | | |
| S10 | Calendrier | à faire | | | |
| S11 | Champs de formulaire | fait | 2026-10-02 | « plan 41, S11 » | **Écart de forme** : posé au niveau du thème (`globals.css`, « Les champs de formulaire », `@layer components` sur les classes BEM de HeroUI) et pas seulement dans les atomes — connexion, inscription, Pago, profil et quantités de la fiche composent encore des champs HeroUI bruts, dont les `data-testid` ne survivraient pas à un passage par `Field` (e2e). `--field-radius` = `--rayon-bouton` (8 px) ; 48 px (`FIELD_MIN_HEIGHT` = `min-h-12` dans les atomes) ; focus : `outline` 2 px `--focus` décalé de 2 px (rouge en erreur) ; erreur : bordure `--danger` (les trois jetons de bordure redéfinis sur le champ) au lieu du liseré extérieur, icône croix cerclée en `::before` de `.error-message` ; libellé 15 px / 500 ; aide et erreur 14 px ; case 20 px, libellé 15 px (ligne gardée à 44 px). `PhoneField` : indicatif et numéro collés (bords intérieurs droits, filet = bordure de l'indicatif). Astérisque : `::after` rouge de HeroUI, et `aria-required` posé par les atomes — la mention `sr-only` « obligatorio » n'ajoute rien, non posée. Mesuré au navigateur : tous les champs à 48 px à 360/390/1 280 (avant 38–44), rayons 8 px, focus vérifié au clavier ; accueil identique au pixel. `CamposContrasena` inchangé (couvert par le thème). Messages d'erreur écrits à la main par les écrans (Pago, auth) : sans icône ni bordure tant que les items P ne les relient pas au champ |
| P1 | Index par type | à faire | | | chapôs `es`/`en` à fournir par Jérôme (D14) |
| P2 | Catégorie | à faire | | | |
| P3 | Fiche produit | à faire | | | |
| P4 | Fiche établissement | à faire | | | |
| P5 | Mi viaje | à faire | | | |
| P6 | Pago | à faire | | | |
| P7 | Résultat de réservation | à faire | | | |
| P8 | Mis reservas | à faire | | | |
| P9 | Mi perfil | à faire | | | |
| P10 | Authentification | à faire | | | |
| P11 | 404 et erreurs | à faire | | | |
| P12 | Accueil : résidus | à faire | | | |
| A1 | Logo sur or | fait | 2026-10-02 | « plan 41, A1 » | `public/brand/logo-header-sur-or.webp` : 179 × 96, 7 996 octets (WebP qualité 80, alpha 100), dérivé de `logo-horizontal-marine-bleu.png` (marine + bleu ciel, sans or) rogné au contenu par `sharp().trim()`. **Écart de forme** : `logo-header-clair`/`-sombre` gardent une marge de 10 à 12 px (contenu 144 × 78 dans 167 × 96) ; celui-ci est rogné comme le demande l'item, donc à 48 px de haut le dessin est plus grand (≈ 90 px de large au lieu de 84) — mesuré à 360 px dans C1. Branché par C1 (variante `sobre`) |
| A2 | Favicon et icônes | à faire | | | |
| A3 | Image de partage | à faire | | | |
| A4 | Police Sugo (licence) | fait | 2026-10-02 | non commité | D5 = B : réduit à réévaluer `--tracking-titre` en Anton, sans licence — fait dans F1 (0.04em, choix de Jérôme) |
| A5 | Logo horizontal large | à faire | | | demande au graphiste |
| A6 | Découpes décoratives | à faire | | | |
| A7 | Ménage de `public/` | à faire | | | |
| G1 | `check-charte.sh` | fait | 2026-10-02 | « plan 41, G1 » | Les six contrôles du §6, branchés dans `npm run verify` (donc la CI et le pre-push), 5 s sous Windows. Périmètre : le code rendu d'`apps/web`, hors stories, tests et playground. La règle 1 lit tout le bloc `<hN>…</hN>` (une graisse sur un `<span>` du titre compte) ; exemption nommée : `PortadaInicio.tsx` (slogan). Règle 5 : exemptions nommées `PageShell`, `ErrorScreen`, `not-found` (P11), et **temporaires** les 5 pages d'auth (→ P10), Mi viaje (→ P5), Pago (→ P6), à retirer avec leur migration. Règle 3 : aucune surface marine déclarée (C2, S3 les nommeront). **Garde-fou ajouté** : un fichier témoin synthétique enfreint les six règles ; une règle qui ne le retrouve pas sort en code 2 (une première version passait au vert sans rien lire). Mutation : un fichier fautif fait rougir les six règles, `Title.tsx` aussi |
| G2 | `.claude/rules/ui.md` | à faire | | | |
| G3 | README des composants | à faire | | | |
| G4 | Planche `Playground/Charte` | à faire | | | |
| G5 | Ménage final | à faire | | | |
