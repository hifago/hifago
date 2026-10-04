---
id: specs-remise-en-route-suite-e2e
titre: "Remise en route de la suite E2E Playwright"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: brouillon
maj: 2026-10-01
resume: >
  Sortie de docs/backlog.md le 2026-09-17, où elle occupait à elle seule un paragraphe de 1888
  caractères alors que le fichier plafonne à 60 lignes et prescrit « 1 ligne par point, jamais de
  récit ». Le backlog le disait lui-même : « chacun demande son diagnostic, c'est un chantier à
  part ». Porte l'état exact des rouges au moment de la mise en pause (2026-09-09, décision
  Jérôme), ce qui est déjà réglé et ne doit pas être re-diagnostiqué, et ce qui s'est aggravé
  depuis sans que personne ne puisse le voir — une suite en pause ne signale plus rien.
mots_cles: [e2e, playwright, tests, suite en pause, regression, globalTeardown, p_lines]
repond_a:
  - "Pourquoi la suite E2E ne tourne-t-elle plus ?"
  - "Quels tests sont rouges, et lesquels sont de vrais défauts ?"
  - "Qu'est-ce qui a déjà été diagnostiqué et ne doit pas l'être une seconde fois ?"
---

# Remise en route de la suite E2E

> **Statut : à faire.** Réactivation complète = ce document archivé et la ligne de renvoi retirée
> de `docs/backlog.md`.

## 1. L'état au moment de la mise en pause

**Mise en pause le 2026-09-09, décision de Jérôme.** La suite ne tourne plus ni dans `/hifago-test`
par défaut, ni en CI — qui n'en a d'ailleurs jamais eu de job. `npm run test:e2e` reste lançable à
la main, et un fichier isolé aussi (c'est ce qui a été fait le 2026-09-17 pour
`reserve-lodging-pms-availability.spec.ts`).

État relevé le 2026-09-09 : **19 rouges sur 120** — 17/82 en `apps/admin`, 2/38 en `apps/web`.

| Origine | Nombre | Nature |
|---|---|---|
| `apps/admin` | 17 | **De vrais défauts.** Mesuré le 2026-09-08 : 16 des 18 échouaient aussi en `--workers=1` — donc ni parallélisme, ni pollution. Natures : 4 navigations qui n'aboutissent pas (`toHaveURL`), 5 éléments absents, 4 timeouts, 3 textes faux. Chacun demande son propre diagnostic. |
| `apps/web` | 2 | `attribution.spec.ts` passe SEUL et échoue en suite (pollution). `reserve-lodging-pms-availability.spec.ts` était rouge même isolé — ✅ **RÉPARÉ le 2026-09-17**, voir §3. |

## 2. Ce qui s'est aggravé PENDANT la pause

C'est le coût réel d'une suite à l'arrêt : elle cesse de signaler, donc les ruptures s'accumulent en
silence.

- **Cinq fichiers d'`apps/admin` passent `p_lines` à `create_order`** (`admin-order-status`,
  `admin-ledger`, `admin-modify-order-line`, `admin-product-price-tiers`, `admin-product-delete`) —
  paramètre supprimé par la spec 32 le 2026-09-10, soit le lendemain de la mise en pause. Ils ne
  peuvent PAS passer. Non comptés dans les 19 ci-dessus. Trouvés le 2026-09-11 en remplaçant
  `cancel-order.spec.ts`, qui portait la même rupture. `apps/web/e2e/mis-reservas.spec.ts` est dans
  le même cas.
- **Le `globalTeardown` ne purgeait plus rien du 2026-09-10 au 2026-09-17** : `cart_items`, née avec
  le panier en base, manquait à sa liste de FK en NO ACTION vers `products`. Le symptôme est
  trompeur — le teardown échoue APRÈS que les tests sont passés, donc la suite rougit sur un test
  qui a réussi, et le `catch` englobant fait que la base garde TOUS ses résidus. Corrigé le
  2026-09-17 ; au run suivant il a purgé 14 produits accumulés. Liste revérifiée dans
  `pg_constraint` : **cinq** FK en NO ACTION, pas quatre.
- **Trouvé le 2026-09-26** (en vérifiant en réel les specs touchées par le chantier assistant par
  étapes produit/établissement, spec 40 — sans rapport avec ce chantier-là, découvert seulement
  parce que la suite a enfin été relancée) :
  - `admin-camp-booking.spec.ts` — même cause racine que `p_lines` ci-dessus (panier en base, spec
    32), côté `apps/web` cette fois : le testid `added-to-cart` n'existe plus nulle part dans le
    code source (grep exhaustif sur `apps/web`), seulement dans ce test.
  - `apps/admin/app/partner/(app)/page.tsx` — `allActive` (ligne ~91) est vérifié AVANT
    `needsFirstEstablishment` (ligne ~111) dans le JSX (ligne 196 vs 205) : un Prestador tout juste
    onboardé (referrer+operator, tous deux `active` par défaut depuis le 2026-08-20) ne voit donc
    jamais le CTA « Añadir establecimiento », seulement la barre compacte « Prestador activo ».
    Possible vrai défaut produit (priorité d'affichage), pas seulement un test cassé.
  - `ModerateProposalForm.tsx` — `toast.success(...)` suivi immédiatement de `router.push` (aucun
    await entre les deux) : la navigation semble emporter le toast avant qu'il soit observable.
    Reproduit sur `partner-propose-product-creation.spec.ts`, pas revérifié sur les autres specs qui
    font la même assertion — possiblement une vraie course, pas juste un test fragile.
  - `admin-product-publish.spec.ts` — `getByText(productName)` en violation de mode strict : le fil
    d'Ariane (lien "current page") et le `<h1>` portent désormais tous les deux exactement ce texte
    en même temps. Dépendant du timing (passait seul plus tôt dans la même session).
  - `admin-partner-registry.spec.ts` — le switch `code-active-switch-SEED-REFACTIVE` ne bascule pas
    après clic, reproduit même en `--workers=1`. Zone (codes d'attribution partenaire) non creusée.
  - Détail complet, dont ce qui a été revérifié en base pour écarter une cause côté wizard :
    `docs/journal/2026-09.md`, entrée du 2026-09-26 « Specs Playwright mises à jour… ».

## 3. Ce qui est RÉGLÉ — ne pas re-diagnostiquer

- **L'authentification** : plus aucun échec. C'était un deadlock, pas le chiffrement des secrets
  (détail au journal).
- **L'accumulation de résidus entre exécutions** : `globalTeardown`, posé le 2026-09-08 et réparé le
  2026-09-17 (voir §2). Il ne traite pas la concurrence intra-suite, qui reste ouverte.
- **Le panneau `ServerFilters` cliqué avant hydratation** après un rechargement GET : helper
  `abrirFiltros`, 8 specs.
- **`reserve-lodging-pms-availability.spec.ts`** (2026-09-17) : ce n'était pas un défaut produit
  mais un test qui affirmait un comportement supprimé le 2026-08-29 (une plage ne peut plus enjamber
  une nuit pleine, commit `bccd9a8`) — il cliquait un bouton devenu `disabled` et attendait qu'il
  s'active. Réécrit pour affirmer la règle actuelle ; la règle métier elle-même est désormais tenue
  en Vitest, où elle est éprouvable par mutation.

## 4. Ordre de reprise proposé

1. **Les ruptures mécaniques d'abord** : les six fichiers qui passent `p_lines` (§2). Ce sont des
   corrections de signature, pas des diagnostics — elles dégagent le terrain.
2. **Relever l'état réel** en une exécution complète, `--workers=1`, après ces corrections. Le
   chiffre de 19 date du 2026-09-09 et n'a plus de valeur : huit jours de chantier front ont passé.
3. **Diagnostiquer les rouges d'`apps/admin` un par un**, en commençant par les 4 timeouts (les plus
   susceptibles d'être, comme le spec PMS, des tests qui affirment un monde révolu).
4. **La concurrence intra-suite** en dernier (`cart-multi-establishment`, `attribution`,
   `admin-reconciliation`, `admin-home-navigation` : ils passent seuls, échouent en suite) — il
   faudrait des données scopées par test, c'est un changement de méthode, pas un correctif.

## 5. Point ouvert

La CI n'a **jamais** eu de job e2e. Remettre la suite au vert sans l'y brancher la laisserait
retomber en silence — c'est exactement ce qui s'est produit ici (`CLAUDE.md` §11.20 : une règle que
rien ne vérifie est un souhait). À trancher avec Jérôme au moment de la réactivation : job CI
bloquant, ou nocturne non bloquant.

## 6. Relevé du 2026-10-01 (e2e de fusion de la remédiation de l'audit)

Base locale re-semée le jour même — le seed est **mensuel** (dispo du mois suivant) : relancé le 1er du
mois sans re-semer, la moitié de la suite web rougit sur des dates introuvables (`data-date`,
`slot_not_found`). Suites lancées sur `staging@4549c1d`.

- **`apps/web`** : 49 verts sur 54 au passage complet. Rouges restants :
  - `home.spec.ts:106` — « Ver más » rendu en carte (sans `href`) au lieu du lien sous la section ;
    dépend du nombre d'offres seedées (code inchangé depuis le 2026-09-16) ;
  - `reserve.spec.ts:100` — attend `data-failed="true"` sur la ligne refusée : attribut disparu avec
    la spec 32 (même cause que `cart-multi-establishment.spec.ts`, adapté, celui-ci non) ;
    `create_order` renvoie bien `reason: "full"` et la ligne (vérifié en transaction annulée) ;
  - `reserve.spec.ts:28` — pollution : le panier du compte seedé partagé en parallèle ; vert seul.
- **`apps/admin`** : 53 verts / 25 rouges en parallèle ; les 18 suspects relancés en `--workers=1` :
  12 verts. Rouges restants, tous antérieurs :
  - déjà décrits en §2 : `added-to-cart` (`admin-camp-booking`, `partner-qr-tool`,
    `partner-reservations`), barre « Prestador activo » (`partner-join`, propositions
    d'établissement), toast emporté par `router.push` (`partner-propose-product-creation`), mode
    strict (`admin-product-publish`), interrupteur du registre (`admin-partner-registry`), `p_lines`
    ×5, pollution (`admin-home-navigation:106`) ;
  - **identiquement rouges sur le code d'avant la remédiation du jour** (`4f21efa`, même base) :
    `admin-establishment-pms-connector`, `admin-evento-vitrine`, `admin-invitations:62`,
    `partner-agenda` ×2 (dont un nettoyage bloqué par la FK `cart_items` → `products`),
    `partner-availability` ×2, `partner-establishment-proposals`,
    `partner-propose-establishment-creation-photo`.
