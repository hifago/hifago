---
name: hifago-charte
description: Applique ou audite le style Hifago (charte 2026 + accueil) sur la vitrine, d'après le plan docs/specs/41-charte-hifago-toute-la-vitrine.md — un item (F1, C2, S3, P5…), un lot, ou une page entière — en vérifiant au rendu réel avant/après ; tient le suivi et les arbitrages de Jérôme. Invocation Codex — $hifago-charte [ID…], page [écran], lot [n], audit [écran], etat, decide [Dn] [choix]
---

# /hifago-charte — habiller la vitrine au style de l'accueil, item par item

## La source unique : le plan
Tout est dans `docs/specs/41-charte-hifago-toute-la-vitrine.md`. Ce skill **n'ajoute aucune règle** :
il applique le plan et en tient le suivi.

| Section du plan | Sert à |
|---|---|
| **§0** contrat compact | les douze règles du style, les invariants, la carte des items. **Toujours lu en premier** (offset et limit donnés par `docs/INDEX.md`) |
| §5 arbitrages | `D1`…`D16`, avec leur statut |
| §6 items | le détail de chaque item (`#### <ID> — …`) |
| §7 ordre | lots et chemin minimal par page |
| §8 inventaire | écran → fichiers → stories → e2e |
| §10 suivi | état de chaque item |

Si le plan et le code divergent, **le code fait foi** : signaler l'écart et proposer la mise à jour
du plan plutôt que de forcer.

## Argument `$ARGUMENTS`
| Valeur | Effet |
|---|---|
| `<ID>` ou une liste (`F1 F2`, `F1-F4`) | Applique ces items, dans l'ordre, un par un |
| `page <écran>` | Applique le chemin minimal de l'écran (§7.3), en s'arrêtant après chaque item pour l'accord de Jérôme |
| `lot <n>` | Applique le lot n (§7.2), un item à la fois |
| `audit <écran>` | Confronte l'écran aux règles du §0, **sans rien modifier** ; rend un constat par règle avec l'item qui corrige |
| `etat` | Lit le §10 et le §5 : fait, à faire, bloqué par quel arbitrage, prochain item conseillé |
| `decide <Dn> <choix>` | Inscrit la décision de Jérôme au §5 et débloque les items qui en dépendent |

Noms d'écran : `accueil`, `index`, `categorie`, `fiche-produit`, `fiche-etablissement`, `mi-viaje`,
`pago`, `resultat`, `reservas`, `perfil`, `auth`, `erreurs`, `coquille`.

## Cadrage (`.claude/rules/orchestration.md`)
Annoncer en une ligne, avant de commencer, la forme et l'effort :
- appliquer : « seul, effort `high`, les contrats sont fixés par le plan » ;
- audit : « seul, `high` » ;
- `etat` ou `decide` : « seul, `low` ».

Pas de workflow multi-agents sans demande explicite de Jérôme.

## Procédure — appliquer un item
0. **Branche et arbre** : jamais sur `main` (en créer une si besoin). `git status` doit être lisible ;
   ne pas mélanger l'item avec des changements d'une autre session.
1. **Lire** :
   - le §0 ;
   - l'item : `grep -n '^#### <ID> ' docs/specs/41-charte-hifago-toute-la-vitrine.md`, puis Read avec
     `offset` ;
   - la ligne « Dépend de » : chaque dépendance doit être « fait » au §10 ; sinon, proposer de la faire
     d'abord ;
   - la ligne « Arbitrage » : si un `D…` est encore **ouvert** au §5, **s'arrêter**. Poser à Jérôme la
     question telle qu'elle est écrite au §5, avec la recommandation, et attendre.
2. **Lire le code** des fichiers listés. Si l'état décrit (« Aujourd'hui ») ne correspond plus,
   s'adapter au code réel et le dire.
3. **Rendu avant** : `/hifago-rendu` sur les stories de la ligne « Vérifier », à 360, 390 et 1 280 px,
   dans `<scratchpad>/rendu/avant`.
4. **Appliquer la cible, toute la cible, rien que la cible.** Pas de refonte opportuniste. Règles dures,
   qui reprennent les invariants du §0 :
   - jetons seulement (`scripts/check-tokens.sh`) ;
   - aucune dépendance nouvelle ;
   - HeroUI via `@hifago/ui` uniquement, et **jamais** dans un `page.tsx` ni un composant serveur, pas
     même `cn` ;
   - textes en `es` **et** `en` ;
   - liens par `@/i18n/navigation` ;
   - `data-testid` intacts ;
   - pas de prop `className` ;
   - classes Tailwind écrites en toutes lettres ;
   - `packages/ui` modifié seulement de façon **additive** (l'admin en dépend) ;
   - un seul `<h1>` visible ;
   - rien de masqué selon la largeur, sauf le décor ;
   - l'accueil identique au pixel quand l'item le touche « sans changement ».
5. **Tests et contrôles** :
   - `/hifago-test <fichiers touchés>` (vitest), et mettre à jour dans le même item les tests qui
     figent une valeur visuelle modifiée, en disant pourquoi ;
   - `npm run typecheck -w @hifago/web` ;
   - `npx eslint` sur les fichiers ;
   - `bash scripts/check-tokens.sh`, `check-design-system.sh`, `check-seo.sh`, `check-i18n-links.sh` et
     `check-data-layer.sh` ;
   - `check-charte.sh` dès que G1 existe ;
   - si un message a changé, le test de parité `messages/parity.test.ts`.
6. **Rendu après** : `/hifago-rendu … apres`, puis `compare`.
   - Mesurer les critères de l'item : tailles, rayons, hauteurs, débordement.
   - Si un jeton de couleur a changé, capturer `Playground/Palette → Contrastes` : tout doit être vert.
   - Regarder les images, pas seulement les chiffres.
7. **Montrer à Jérôme** : avant / après à 390 et 1 280 px, ce qui a changé, ce
   qui reste, et les écarts éventuels au plan.
   - **Ouvrir les images dans son navigateur** (demande de Jérôme, 2026-10-02) : les regrouper dans
     une page HTML du scratchpad (images en chemins relatifs, une légende par image, la
     recommandation en tête), puis `Invoke-Item <chemin>.html` (PowerShell). Jamais un lien vers un
     PNG du scratchpad : hors du workspace, il ne s'ouvre pas depuis le chat. Même chose pour une
     planche de choix.
8. **Clore** :
   - cocher l'item au §10 du plan (« fait », date, remarque) ;
   - ajouter une entrée courte au journal du mois (`docs/journal/`, en *append*) ;
   - mettre `docs/backlog.md` à jour si un arbitrage s'ouvre ou se ferme ;
   - `npm run docs:index` si un document de `docs/` a changé.
   - **Ne pas commiter** sans demande.

## Modes `page` et `lot`
Suivre l'ordre du §7.3 (page) ou du §7.2 (lot) en sautant les items déjà « fait ». Après **chaque**
item : rendu, puis attente de l'accord de Jérôme, sauf s'il a dit « enchaîne ». Rappeler que le site
est temporairement mélangé tant que tous les écrans ne sont pas passés : pas de déploiement en
production d'un état à moitié fait sans son accord.

## Mode `audit <écran>`
1. Écran → stories (§8 du plan, table de `/hifago-rendu`) ; captures avec `--mesure`.
2. Pour chacune des **douze règles** du §0 et chaque invariant :
   - conforme ou écart ;
   - **preuve** : mesure ou capture ;
   - **item qui corrige** (ou « item manquant : … », avec la description proposée).
3. Ajouter les alertes de l'outil : débordement, `<h1>`, police de titre sous 20 px, faux gras, cibles
   sous 44 px, rayons multiples.
4. Ne **rien** modifier. Proposer l'ordre d'application.

## Mode `decide <Dn> <choix>`
- Écrire au §5 du plan : statut « tranché le AAAA-MM-JJ : <choix> (Jérôme) ».
- Retirer « attend Dn » des remarques du §10.
- Ajouter une ligne au journal du mois.
- Si la décision fige une règle durable (par exemple le rayon des boutons), proposer de la reporter
  dans `.claude/rules/ui.md` : c'est l'item G2.
- Lister les items débloqués.
- **Ne jamais décider à la place de Jérôme**, même avec une recommandation forte.

## Pièges à connaître (détail dans le plan)
- **Polices** : Anton confirmée (D5 = B) ; depuis F5, Storybook affiche la police de production.
  Une capture d'avant le 2026-10-02 peut encore montrer la Sugo d'essai (chiffres en filigrane).
- **Surfaces** (F3) : redéfinir les jetons sur `main` et sur le header, **pas sur `<body>`**. Les
  popovers (suggestions, calendrier) sont rendus au bout du `<body>` et doivent rester clairs.
- **`check-tokens.sh`** :
  - il exige `letter-spacing: var(--tracking-titre)` sur la règle `h1–h3` ;
  - il refuse tout autre `tracking-` à côté de la police de titre.
- **`PageShell.test.tsx`** fige les largeurs de `large` : écrire ceux de `pagina` sans casser
  l'existant tant que `large` sert.
- **`carousel.tsx`** sert aussi `apps/admin/components/catalog-card.tsx` ; **`legacy-calendar.tsx`**
  est partagé : passer par les props additives ou par les wrappers d'`apps/web`.
- **jsdom n'applique pas les media queries** : tout ce qui est responsive se prouve au rendu, pas en
  test unitaire.
- **Storybook mémorise la piste** : `/hifago-rendu` la force ; à l'œil, choisir « La charte Hifago
  2026 ».

## Ce que ce skill ne fait pas
- Il ne rouvre aucune décision déjà prise sur l'accueil (journal du 01 au 02/10).
- Il ne change aucun comportement métier : réservation, paiement, panier, données, appels.
- Il ne touche pas `apps/admin` ni le thème `admin`.
- Il n'ajoute aucune dépendance, police ou couleur hors charte.
- Il ne commite pas et ne déploie pas sans demande explicite.
