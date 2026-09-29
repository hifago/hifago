---
id: specs-panier-en-base
titre: "Panier en base"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
revise: ["docs/01-cahier-des-charges-client.md#3e"]
maj: 2026-09-13
resume: >
  Fait passer le panier de la mémoire du navigateur (CartContext) à deux tables Postgres (carts,
  cart_items) rattachées à l'identité posée par la spec 31 — condition validée le 2026-09-07 pour
  que le panier survive plusieurs jours, que le serveur puisse le lire (réordonnancement de
  l'accueil, spec 28 T3), et que l'attribution d'un invité ne se perde plus à la fermeture de
  l'onglet. Construit aussi l'écran /carrito que la spec 27 avait déjà prévu sans jamais le bâtir
  (intégré au périmètre le 2026-09-10, à la demande de Jérôme). Les 4 tranches sont livrées et
  vérifiées en navigateur (produit réel du seed → panier → paiement → commande confirmée) ; 2
  points ouverts (§10) et 2 régressions mineures signalées restent au journal du 2026-09-10.
mots_cles: [panier, cart_items, carts, attribution_code, CartContext, create_order, plafonds, carrito, CartSummary]
repond_a:
  - "Où vit une ligne de panier, et quels champs porte-t-elle ?"
  - "Comment create_order lit-il désormais ses lignes et son attribution ?"
  - "Que se passe-t-il si une ligne du panier redevient indisponible avant le checkout ?"
---

# Panier en base

> **Cible stack** : hifago. Spec bloquante : débloque la Tranche 3 de la spec 28 (réordonnancement
> de l'accueil selon le panier) ; dépend de la spec 31 (identité anonyme), entièrement livrée le
> 2026-09-10.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (pour coder — lire seul, sans le reste) | brouillon |
| 1 | Contexte et problème | brouillon |
| 2 | Portée | brouillon |
| 3 | Décisions retenues (entretien du 2026-09-10) | brouillon |
| 4 | Parcours cible | brouillon |
| 5 | Écran(s) | brouillon |
| 10 | Décisions tranchées / points ouverts | brouillon |
| 11 | Annexe — traçabilité code→règle | brouillon |
| 12 | Documents liés | brouillon |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Ce que ça change, en une phrase

Le panier quitte `CartContext` (React `useState`, jamais persisté,
`apps/web/lib/cart/CartContext.tsx`) pour deux tables Postgres (`carts`, `cart_items`) rattachées à
`account_id` — l'identité posée par la spec 31. Un Server Component peut désormais le lire (débloque
spec 28 T3) ; il survit à la fermeture de l'onglet et change d'appareil ; `create_order` lit ses
propres lignes et sa propre attribution côté serveur au lieu de les recevoir en paramètres d'un
client qui pourrait les falsifier.

### Modèle de données (delta)

| Table | Changement | Colonnes | Pourquoi |
|---|---|---|---|
| `carts` (nouvelle) | créée | `account_id uuid PRIMARY KEY references auth.users`, `attribution_code text`, `attribution_source text`, `created_at timestamptz NOT NULL default now()` | Une ligne par identité. Porte l'attribution — **jamais** l'identité elle-même, c'est l'engagement déjà pris par spec 31 invariant 3 et son §0 (« `carts` (spec suivante) portera `attribution_code` ») |
| `cart_items` (nouvelle) | créée | `id uuid PRIMARY KEY default gen_random_uuid()`, `account_id uuid NOT NULL references auth.users`, `product_id uuid NOT NULL references public.products`, `date date NOT NULL`, `end_date date`, `slot_start_time time`, `qty int NOT NULL`, `created_at timestamptz NOT NULL default now()` | Remplace `CartContext.lines`. Mêmes colonnes de date/créneau qu'`order_lines` (mêmes formes de ligne : produit à date, par plage, à créneau) |
| `orders` / `order_lines` | inchangées | — | `create_order` continue d'écrire exactement ce qu'il écrit aujourd'hui, juste depuis une source différente |

**Pas de `price_cop` sur `cart_items`** : le prix est toujours lu depuis `products.price_cop`
jusqu'au checkout (décision du 2026-09-10) — `create_order` calcule tous les montants côté serveur,
inchangé. **Pas de `status`** : un panier n'est jamais un stock réservé (cahier §3e). **Pas de
`type`/`slug`/photo/nom d'établissement dénormalisés** : toujours une jointure `product_id →
products → establishments` à la lecture (décision du 2026-09-10) — c'est elle qui débloque le
réordonnancement de l'accueil (spec 28 T3), un Server Component pouvant désormais faire cette
jointure directement, ce qu'un état React ne permettait pas.

**Pas de fusion de lignes** : deux lignes visant le même produit et la même date restent deux
lignes `cart_items` distinctes, retirables indépendamment — comportement déjà documenté et voulu
dans `CartContext.tsx:17-19` (cahier des charges client A14), à préserver tel quel, pas à
redécider. Donc pas de contrainte `UNIQUE(account_id, product_id, date)`.

### RLS / RPC-only

Les deux tables sont **RLS directe** (CLAUDE.md §3.2) : une identité gère ses propres données non
capacitaires, rien n'est verrouillé/décrémenté avant `create_order`. Policies `account_id = (select
auth.uid())` pour select/insert/update/delete sur les deux tables (règle CLAUDE.md §3.4, l'appel
`auth.uid()` toujours enveloppé). `apps/web` insère/retire/modifie directement via supabase-js,
**aucune RPC** nécessaire pour ajouter/retirer une ligne ou changer une quantité.

### Contrat — ce que `create_order` doit faire différemment

| Aujourd'hui (`supabase/migrations/20260910140000_simplification_spec31.sql`) | Demain |
|---|---|
| Reçoit `p_lines jsonb` du client | Lit `cart_items where account_id = auth.uid()` côté serveur |
| Reçoit `p_attribution_code text`, `p_attribution_source text` du client | Lit `carts.attribution_code`/`attribution_source where account_id = auth.uid()` |
| — | Vide (`delete from cart_items where account_id = auth.uid()`) après avoir obtenu `order_id`, **seulement en cas de succès** |

**`drop function` explicite requis** (la signature perd deux paramètres) — jamais un
`create or replace` qui retire un paramètre (supabase.md règle 7). Extraire le corps vivant par
`pg_get_functiondef` avant de le réécrire (même règle) : c'est une RPC critique au sens de
CLAUDE.md §4, le squelette anti-survente (`SELECT … FOR UPDATE`, un seul aller-retour) ne bouge
pas, seule la provenance des données change.

### Invariants

1. Un panier n'est jamais un stock réservé — rien n'est verrouillé/décrémenté avant `create_order` (cahier §3e, inchangé).
2. Deux lignes visant le même produit et la même date restent deux entrées distinctes, retirables indépendamment (cahier A14, comportement `CartContext` actuel préservé).
3. Le prix n'est jamais stocké sur `cart_items` — toujours lu depuis `products.price_cop` jusqu'à `create_order`, qui calcule tous les montants côté serveur (inchangé, cahier §3e).
4. L'attribution vit sur `carts`, jamais sur l'identité (spec 31 invariant 3 — engagement déjà pris).
5. La conversion d'un invité en compte réel garde son panier sans rien migrer : `account_id` ne change pas (Supabase lie l'email à l'identité anonyme existante, spec 31 §1) — donc `carts`/`cart_items` suivent d'eux-mêmes.
6. Une ligne devenue indisponible à la reprise du panier reste affichée, avec un moyen de la retirer — jamais un retrait automatique silencieux (cahier §3e).
7. Seule une commande protège une identité de la purge à 30 jours — un panier non (spec 31 invariant 10, déjà tranché : un visiteur venu par lien attribué qui revient après 30 jours sans commander perd panier et attribution).
8. Plafonds de `create_order` inchangés dans leur **principe** (un plafond global sur toute la commande, jamais par établissement, cahier §3e) — cf. §10 pour leur **valeur**, qui est un point ouvert distinct de cette spec.

### Cas limites

| Cas | Comportement attendu |
|---|---|
| Le visiteur ajoute au panier, ferme l'onglet, revient le lendemain | Panier et attribution intacts (`carts`/`cart_items` en base) — remplace le comportement actuel où tout est reperdu |
| Le visiteur revient après 30 jours sans avoir commandé | Purgé avec son identité (invariant 7/spec 31 invariant 10) |
| Un produit d'une ligne du panier change de prix avant checkout | Le nouveau prix s'applique (pas de snapshot, invariant 3) |
| Un produit d'une ligne du panier devient indisponible/invendable avant checkout | Signalé en place à la lecture du panier, retrait proposé, jamais un retrait automatique (invariant 6) |
| Le même client revient depuis un autre appareil, déjà connecté | Même `account_id` → même panier ; rien à fusionner |
| `create_order` réussit | `cart_items` de ce compte vidées après l'obtention de `order_id` |
| `create_order` échoue (garde, plafond, PMS) | `cart_items` intactes — le client garde son panier pour corriger et retenter |
| `enable_anonymous_sign_ins` revient à `false` (spec 31 cas limite) | L'ajout au panier échoue déjà proprement à la création de session, avant même d'atteindre `cart_items` — rien de nouveau à gérer ici |

### Fichiers touchés

| Fichier | Nature |
|---|---|
| `supabase/migrations/<NN>_carts_et_cart_items.sql` | création des deux tables + RLS directe |
| `supabase/migrations/<NN>_create_order_lit_panier_et_attribution.sql` | `drop function` + nouvelle signature de `create_order` |
| `apps/web/lib/cart/CartContext.tsx` | remplace `useState`/`setLines` par des appels supabase-js directs sur `cart_items` (et upsert `carts` au premier ajout) |
| `apps/web/app/[locale]/(tunnel)/pago/CheckoutForm.tsx` | ne passe plus `p_lines`/`p_attribution_code`/`p_attribution_source` à `create_order` ; son rendu de lignes inline (`lines.map`, `CheckoutForm.tsx:328`) est remplacé par `<CartSummary editable={false} />` |
| `apps/web/proxy.ts` | cookie `hifago_ref` inchangé dans sa pose ; sa lecture se déplace du checkout vers le premier ajout au panier (capture dans `carts.attribution_code`) |
| `apps/web/app/[locale]/(tunnel)/mi-viaje/page.tsx` | nouveau (créé sous (tunnel)/carrito, renommé `mi-viaje` le 2026-09-16) — Server Component, route déjà prévue par spec 27 (`docs/specs/27-architecture-vitrine-et-routage.md:75`), jamais bâtie |
| `apps/web/components/organisms/CartSummary.tsx` | nouveau — déjà cité en exemple dans `apps/web/components/README.md` sans jamais avoir été écrit ; rendu client (retrait de ligne), utilisé en mode éditable sur `/carrito` et en mode lecture seule sur `/pago` |
| `apps/web/components/organisms/SiteHeader.tsx` | une ligne : `ROUTE_PANIER` bascule de `"/pago"` à `"/carrito"` (constante déjà prévue à cet effet, `SiteHeader.tsx:54` et son commentaire) |

## 1. Contexte et problème

Décidé le 2026-09-07 (cahier §3e, « Où il vit ») : le panier doit vivre en base plutôt que dans le
navigateur, pour quatre raisons déjà actées — il persiste réellement, il suit l'appareil, le
serveur peut le lire (ce que réclame concrètement la Tranche 3 de la spec 28, bloquée depuis faute
de pouvoir lire le panier depuis un Server Component), et la conversion d'un invité en client
enregistré garde son panier sans migration puisque l'identifiant ne change pas. Cette spec était
explicitement mise **après** l'identité anonyme dont elle dépend (spec 31, livrée le 2026-09-10) :
sans identité durable, un panier en base n'a rien de stable à quoi se rattacher.

Aujourd'hui, `CartContext.tsx` porte encore la totalité du panier en mémoire React
(`useState<CartLine[]>`), perdu à tout rechargement complet — son commentaire de tête le dit
explicitement, en indiquant que ce fichier n'anticipe que ce que la spec 31 exigeait (l'identité),
pas encore les lignes elles-mêmes. Une ligne de panier (`CartLine`) ne porte aujourd'hui ni le
`type` de l'offre, ni son `slug`, ni l'id de son établissement, ni de photo — seulement
`productId`/`productName`/`establishmentName` (dénormalisés en texte au moment de l'ajout),
`date`/`endDate`/`slotStartTime`, `qty`, `priceCop`. L'absence de `type` rend le réordonnancement
des sections de l'accueil selon le panier littéralement inécrivable (spec 28, Tranche 3 sortie du
périmètre le 2026-09-07 « sur constat d'infaisabilité »,
`docs/specs/28-vitrine-accueil-et-resultats.md:237-243`).

L'attribution d'un invité pose un problème lié, déjà en partie résolu par la spec 31 mais
explicitement **pas totalement** : aujourd'hui, `attribution_code` est un paramètre que
`CheckoutForm.tsx` passe à `create_order`, lu depuis le cookie `hifago_ref` posé par `proxy.ts` sur
`?ref=<code>` — un cookie **de session**, sans `maxAge`, perdu à la fermeture de l'onglet
(`apps/web/proxy.ts:10-22`). Un panier qui survit plusieurs jours mais une attribution qui ne
survit pas à la fermeture de l'onglet, c'est exactement l'incohérence que spec 31 documente en
contexte (§1 : « le panier persistant faisait perdre l'attribution d'un invité ») et régle en
partie (l'identité, elle, est durable), tout en réservant explicitement le reste à cette spec-ci
(invariant 3 de spec 31, et son §0 : « `carts` (spec suivante) portera `attribution_code` »).

## 2. Portée

**In** : les deux tables `carts`/`cart_items`, leur RLS, le nouveau contrat de `create_order`
(lecture serveur des lignes et de l'attribution), la réécriture de `CartContext` pour écrire
directement dans ces tables, la capture de l'attribution au premier ajout au panier plutôt qu'au
checkout. **Ajouté le 2026-09-10, à la demande de Jérôme** : l'écran `/carrito` — route déjà
prévue par spec 27 mais jamais construite (`CheckoutForm.tsx` porte aujourd'hui à la fois la liste
du panier et le formulaire de paiement, un pis-aller documenté comme tel depuis le 2026-09-02) —
et le composant `CartSummary` qui figurait déjà, sans jamais avoir été écrit, dans l'exemple
`organisms/` d'`apps/web/components/README.md`. C'est le premier écran qui a réellement besoin de
l'invariant 6 (ligne indisponible affichée, retirable, jamais retirée seule).

**Out** :
- Le réordonnancement des sections de l'accueil selon le panier (spec 28 T3) — cette spec le
  **débloque** (le `type` devient lisible côté serveur), elle ne l'implémente pas.
- La correction des valeurs de plafond dans `create_order` (12/36/40/20 vs les 4/12/20 actuellement
  codés) — écart trouvé en préparant cette spec, distinct de son objet, cf. §10.
- L'interaction entre `carts.attribution_code` (durée de vie = le panier) et
  `partner_accounts.saved_attribution_code` (durée de vie = le compte, déjà en place pour un
  compte réel) — cf. §10, point ouvert.

## 3. Décisions retenues (entretien du 2026-09-10)

| # | Décision | Alternative écartée |
|---|---|---|
| ① | `cart_items` est une table séparée d'`order_lines`, jamais un statut supplémentaire dessus | Réutiliser `order_lines` avec un statut `in_cart` — mélangerait lignes non engagées et lignes ayant traversé le verrou anti-survente |
| ② | `cart_items` ne stocke que `product_id` ; type/nom/photo/établissement sont toujours lus par jointure à `products`/`establishments` | Dénormaliser ces champs dans la ligne au moment de l'ajout, comme `CartContext` le fait aujourd'hui |
| ③ | Le prix n'est jamais stocké sur `cart_items` — toujours `products.price_cop` en direct jusqu'au checkout | Un `price_cop` figé (snapshot) dès l'ajout au panier |
| ④ | Plafond du panier : un seul plafond **global** sur toute la commande | Un plafond répété par établissement — *confirme, sans le rouvrir, ce que le cahier §3e avait déjà tranché le 2026-09-07* |
| ⑤ | `create_order` lit ses propres `cart_items`/`carts` via `auth.uid()` côté serveur, au lieu de recevoir les lignes et l'attribution en paramètres | Garder le contrat actuel (client envoie `p_lines`/`p_attribution_code`) — un client ne pourrait alors jamais falsifier prix, quantité ou référent |

## 4. Parcours cible

1. Le visiteur clique « Ajouter au panier » sur une fiche produit.
2. `CartContext.addLine` (inchangé dans son ouverture, spec 31) vérifie/crée la session Supabase
   (anonyme si besoin).
3. Si c'est le **premier** ajout de cette identité (`carts` n'a pas encore de ligne pour ce
   `account_id`) : upsert d'une ligne `carts` portant l'`attribution_code`/`attribution_source` lus
   depuis le cookie `hifago_ref` s'il est présent, sinon `null`.
4. Insertion d'une ligne `cart_items` (RLS directe, pas de RPC).
5. Le visiteur revient plus tard (autre jour, autre appareil, connecté ou non), et clique l'icône
   panier (`SiteHeader`, inchangée) qui pointe désormais vers `/carrito` : le panier se lit par une
   jointure `cart_items → products → establishments`, filtrée `account_id = auth.uid()`. Chaque
   ligne est confrontée à la disponibilité courante du produit ; une ligne devenue indisponible est
   signalée avec un moyen de la retirer (invariant 6), jamais retirée seule.
6. Depuis `/carrito`, le visiteur passe à `/pago` — qui affiche le même récapitulatif
   (`CartSummary` en lecture seule) mais ne permet plus d'y retirer une ligne, seulement de payer.
7. Au checkout, `create_order` (aucun paramètre de lignes/attribution) lit lui-même
   `cart_items`/`carts` pour `auth.uid()`, applique les mêmes gardes et plafonds qu'aujourd'hui,
   crée `orders`/`order_lines`, puis vide `cart_items` de ce compte si et seulement si la commande
   est créée.

## 5. Écran(s)

**`/carrito`** (`apps/web/app/[locale]/(tunnel)/carrito/page.tsx`, nouvelle — Server Component) :
- Lit `cart_items` pour `auth.uid()`, joint `products`/`establishments`, revérifie la disponibilité
  de chaque ligne (mécanisme à identifier à l'implémentation, cf. §10).
- Passe les lignes sérialisées (avec un indicateur « indisponible » par ligne) à `CartSummary` en
  mode éditable.
- Panier vide : message + lien vers l'accueil, pas d'écran blanc.

**`CartSummary`** (`apps/web/components/organisms/CartSummary.tsx`, nouveau, `"use client"` —
frontière RSC/Client, `.claude/rules/apps.md`) : un bloc par ligne (produit, établissement, date ou
plage ou créneau, quantité, prix courant `qty × products.price_cop`), le total, et — seulement en
mode éditable (`/carrito`) — un bouton de retrait par ligne (`delete` direct sur `cart_items`, RLS,
pas de RPC) et un bandeau distinct pour une ligne indisponible (jamais retirée automatiquement,
invariant 6). En mode lecture seule (`/pago`), ni bouton de retrait ni bandeau d'indisponibilité :
`create_order` revalidera de toute façon à ce moment-là.

**`/pago`** (`CheckoutForm.tsx`, existante, simplifiée) : perd son rendu de lignes inline
(`lines.map`, `CheckoutForm.tsx:328`) au profit de `<CartSummary editable={false} />` ; garde le
seul formulaire de paiement (nom, WhatsApp, email, consentement, cahier §3e).

**`SiteHeader`** (existante, inchangée dans son rendu) : `ROUTE_PANIER` bascule de `"/pago"` à
`"/carrito"` — une constante, déjà prévue pour ça.

## 10. Décisions tranchées / points ouverts

- **Conséquence trouvée en adaptant les tests, pas une régression** : `create_order` garde son
  garde-fou `product_not_found` (product introuvable) dans son code, mais il n'est plus
  atteignable — `cart_items.product_id` porte une FK vers `products` (aucun `ON DELETE CASCADE`),
  donc un id de produit inexistant échoue à l'`INSERT` dans `cart_items`, avant même que
  `create_order` ne s'exécute. Aucun autre chemin connu ne l'atteint non plus (supprimer un
  produit encore référencé par un panier échouerait sur la même FK). Le garde-fou reste en place
  comme défense en profondeur ; son test correspondant (`create_order.test.sql` cas 3) a été
  retiré plutôt que contourné (`supabase/tests/database/create_order.test.sql`, plan 94→93).
- **Écart trouvé, pas de cette spec** : `create_order` a aujourd'hui `v_lodging_lines > 4 or
  v_lodging_units > 12` et `v_prestation_lines > 20`
  (`supabase/migrations/20260910140000_simplification_spec31.sql:158,161`) — les valeurs **d'avant**
  le 2026-09-07 (un seul établissement). Le cahier §3e documente pourtant, à la même date, des
  valeurs relevées (12/36/40/20) pour permettre une commande multi-établissements — jamais
  implémentées. Trouvé en préparant cette spec (`create_order` étant de toute façon réécrit pour
  ⑤), **pas corrigé ici** : à confirmer par Jérôme, proposition — le faire dans la même migration
  puisque la fonction est de toute façon réécrite.
- **Point ouvert : interaction `carts.attribution_code` / `partner_accounts.saved_attribution_code`.**
  `create_order` a aujourd'hui un repli — un compte réel (jamais anonyme depuis spec 31 invariant
  3) sans `p_attribution_code` reçoit l'attribution **durable** sauvegardée sur son compte
  (`saved_attribution_code`, `supabase/migrations/20260827220000_drop_hotel_room_types.sql:445-448`).
  `carts.attribution_code` a une durée de vie plus courte (celle du panier, purgeable). Cette spec
  ne tranche pas si les deux coexistent (le repli compte réel reste un filet quand le panier n'a
  pas d'attribution) ou si `carts` remplace entièrement ce mécanisme pour tout le monde.
- **Point ouvert : un `?ref=` qui arrive pendant qu'un panier est déjà ouvert met-il à jour
  `carts.attribution_code`, ou celui-ci est-il figé à la création de la ligne `carts` ?** Le
  comportement actuel (cookie relu à chaque checkout) revient de fait au « toujours la dernière
  valeur » ; cette spec ne tranche pas si c'est le comportement voulu une fois l'attribution
  déplacée sur `carts`.
- **Point ouvert : mécanisme de revérification de disponibilité à la reprise du panier**
  (invariant 6) — cette spec fixe l'exigence (jamais de retrait automatique), pas le mécanisme
  technique de revérification, qui doit réutiliser un calcul de disponibilité déjà existant plutôt
  qu'en inventer un nouveau ; à identifier à l'implémentation.
- **Non lié à cette spec, trouvé le même jour** : `docs/specs/README.md`/frontmatter classent
  encore la spec 31 « brouillon » alors qu'elle est entièrement livrée depuis ce matin
  (`docs/backlog.md`) — `scripts/docs_index.js` vérifie mécaniquement que les deux s'accordent
  (essayé de corriger le seul README, rejeté par le script). Reste « brouillon » pour l'instant :
  peut-être volontaire tant que le point de vérification Cloud du job de purge n'est pas vérifié —
  à trancher par Jérôme, pas décidé ici.

## 11. Annexe — traçabilité code→règle

| Section | Fichiers sources |
|---|---|
| §0 Modèle de données | `apps/web/lib/cart/CartContext.tsx:16-34` (forme actuelle de `CartLine`), `supabase/migrations/20260813194515_availability_orders_core_tables.sql:51-62` (forme d'`order_lines`, dont `cart_items` s'inspire) |
| §0 Contrat `create_order` | `supabase/migrations/20260910140000_simplification_spec31.sql` (dernière version vivante) |
| §0 Attribution | `apps/web/proxy.ts:10-22` (cookie `hifago_ref`), `apps/web/app/[locale]/(tunnel)/pago/CheckoutForm.tsx:206-210` (lecture actuelle), `docs/specs/31-identite-anonyme.md:66,101-109` (invariant 3, engagement `carts`) |
| §1 Contexte | `docs/01-cahier-des-charges-client.md:706-724` (§3e, « Où il vit »), `docs/specs/28-vitrine-accueil-et-resultats.md:237-243` (blocage réordonnancement) |
| §10 Plafonds | `docs/01-cahier-des-charges-client.md:690-704` (§3e, tableau des valeurs), `supabase/migrations/20260910140000_simplification_spec31.sql:34-36,158,161` |
| §5 Écran `/carrito` | `docs/specs/27-architecture-vitrine-et-routage.md:75` (route déjà prévue), `apps/web/components/organisms/SiteHeader.tsx:44-54` (décision Jérôme 2026-09-02, constante `ROUTE_PANIER`), `apps/web/components/README.md` (exemple `CartSummary` jamais écrit), `apps/web/app/[locale]/(tunnel)/pago/CheckoutForm.tsx:114,328` (rendu actuel à extraire) |

## 12. Documents liés

- `docs/specs/31-identite-anonyme.md` — spec dont celle-ci dépend (identité durable).
- `docs/specs/28-vitrine-accueil-et-resultats.md` §Tranche 3 — spec débloquée par celle-ci.
- `docs/specs/27-architecture-vitrine-et-routage.md` — route `/carrito` déjà prévue, construite ici.
- `apps/web/components/README.md` — conventions atoms/molecules/organisms appliquées à `CartSummary`.
- `docs/01-cahier-des-charges-client.md` §2f, §3e — décisions cahier auxquelles celle-ci se
  conforme (persistance, plafonds, attribution).
- `docs/backlog.md` — « Panier en base » retiré du backlog dès que cette spec passe en
  `statut: implemente`.
