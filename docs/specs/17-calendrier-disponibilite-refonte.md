---
id: specs-calendrier-disponibilite-refonte
titre: "Calendrier/disponibilité — audit complet + refonte phasée (Tranches 0-2 prêtes à coder)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: partiel
reste: >
  Tranche 1 (crash price_cop null, Mis Reservas) et Tranche 2 (SVAR, moteur unifié chambre/
  alojamiento) livrées. Créneaux réservables forkés dans la spec 18 (livrée séparément) ;
  ressource partagée généralisée renvoyée à une future spec.
revise:
  - "docs/02-cahier-des-charges-socio.md#3d"
  - "docs/02-cahier-des-charges-socio.md#3e"
  - "docs/02-cahier-des-charges-socio.md#3f"
maj: 2026-08-17
resume: >
  Aucune spec « calendrier » n'existait pour le nouveau stack alors que la logique est dispersée
  sur 6+ documents et deux cadrages jamais transformés en spec actionnable. Corrige un bug de
  survente confirmé (price_cop null sur un hôtel), restaure la visibilité des réservations côté
  socio (absente en v2, présente en v1), ajoute l'édition d'une réservation (jamais construite ni
  en v1 ni en v2), et pose l'architecture du moteur unifié chambre d'hôtel + alojamiento par nuits.
  Comparatif technologique du calendrier inclus (§3bis). Tranches 3/4 renvoyées à une spec future.
mots_cles: [calendrier, disponibilite, cupos, availability, product_availability, room_type,
  stay_rates, create_order, modify_order_line, mis reservas, heroui calendar, fullcalendar,
  tanstack table, hifago]
repond_a:
  - "Quel est l'état réel du calendrier/de la disponibilité dans le nouveau stack ?"
  - "Pourquoi un hôtel sans prix propre fait-il planter create_order ?"
  - "Comment un socio voit-il qui a réservé son activité ?"
  - "Comment modifier la date ou la quantité d'une réservation existante ?"
  - "Comment rendre une chambre d'hôtel réellement réservable ?"
  - "Quelle librairie de calendrier utiliser côté admin/socio/client ?"
---

> **Amendement daté du 2026-08-27 — l'étage hôtel a été supprimé.** `products.type='hotel'`,
> `product_room_types`, `room_media`, `room_type_availability`, `room_type_date_rates`,
> `order_lines.room_type_id` et `set_room_type_availability` n'existent plus (T3 de la spec 24 :
> application par le commit 38c1b55, base par la migration `20260827220000`). Une chambre est
> désormais un produit `type='lodging'` à part entière. **Toute mention de `room_type`,
> `product_room_types` ou d'une « branche chambre » ci-dessous décrit un état passé** ; le mécanisme
> équivalent vit sur `products`/`product_availability`. Détail et raisons : `docs/specs/24-modele-
> hebergement-et-surface-lobbypms.md` §4, et le bandeau de `docs/specs/13-admin-hotel-habitaciones.md`.

> ⚠️ Spécifique à cette spec : `resolve_date_price` a perdu son premier paramètre
> `p_room_type_id` — sa signature vivante est `(p_product_id, p_date, p_tier_base_price_cop,
> p_stay_rates)`. Le garde-fou `capacity_exceeds_physical` de `set_room_type_availability` est
> parti avec la fonction ; son portage sur `products` reste ouvert (spec 24, T2).

# Calendrier/disponibilité — audit complet + refonte phasée

> **Cible stack** : Hifago (`hifago/apps/admin`, `hifago/apps/web`, `hifago/supabase`). Croise et
> remplace la dispersion actuelle de la logique calendrier sur les specs 08/11/12/13/14 et les
> cadrages `00-modele-de-donnees.md`/`05-reference-technique.md`, jamais transformés en spec
> actionnable pour ce sujet précis.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (Tranches 0/1/2 seulement) | brouillon |
| 1 | Contexte et problème | brouillon |
| 2 | Portée | brouillon |
| 3 | Décisions retenues | brouillon |
| 3bis | Choix technique du calendrier | brouillon |
| 4 | Parcours cible | brouillon |
| 5 | Écran(s) | brouillon |
| 6-9 | *(fusionnées dans 0 pour les Tranches 0-2 ; détaillées narrativement pour les Tranches 3-4)* | — |
| 10 | Décisions tranchées / points ouverts | brouillon |
| 11 | Annexe — traçabilité code→règle | brouillon |
| 12 | Documents liés | brouillon |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

> ⚠️ **Tout le volet hôtel de la Tranche 2 (`product_room_types`, `room_type_*`, chambre
> d'hôtel) a été supprimé par la spec 24 T3 (2026-08-27)** : ce qui s'y rapporte ci-dessous décrit
> un état passé, ne pas le coder. Une chambre est désormais un produit `type='lodging'` (spec 24) ;
> les créneaux réservables sont dans la spec 18.
>
> Cette section ne couvre que les Tranches 0, 1 et 2 (prêtes à coder). Les Tranches 3 et 4 sont
> décrites narrativement en §2/§10 — pas de signature figée pour elles, cf. §2.

### Tranche 0 — Correctifs immédiats *(implémentée le 2026-08-17)*

Aucune nouvelle table. Deux surfaces à fermer pour le bug `price_cop is null`, pas une :

1. **UX admin** : dans `apps/admin/app/admin/products/[id]/edit/page.tsx` (lignes 156-161), le
   lien « Calendario & cupos » devient conditionnel — masqué si `type IN ('evento','hotel')` tant
   que la Tranche 2 (calendrier par chambre) n'existe pas pour `hotel`, et tant qu'`evento` reste
   non réservable en ligne (Tranche 4).
2. **Invariant serveur, dans `create_order` lui-même** (dernière version :
   `supabase/migrations/20260815240000_create_order_qty_bounds_and_tiers.sql`) : avant le calcul
   `v_total_cop := v_line_price_cop * qty`, refuser si `v_line_price_cop is null` :
   `return jsonb_build_object('ok', false, 'reason', 'price_missing')`. Nécessaire même si (1) est
   fait — `create_order` est `security definer`, contourne RLS, reste appelable en RPC directe
   avec n'importe quel `product_id` publié (le catalogue est public).
3. `apps/admin/lib/lists/filters.ts` : ajouter `'hotel'` à `PRODUCT_TYPES`.
4. `apps/admin/app/admin/establishments/[id]/page.tsx` (ou équivalent listant les établissements) :
   lien « Recurso compartido » affiché seulement si l'établissement porte au moins un produit
   `type IN ('camp','evento')` — sinon masqué.
5. Migration : retirer `'tour'` du `CHECK` `products_type_check` (table `products`) et de
   `PRODUCT_TYPES` (`apps/admin/lib/lists/filters.ts`) — confirmé zéro chemin de création possible
   (`product-form.tsx` ne propose que les 6 types annoncés), donc zéro donnée à migrer.
6. Migration : `alter table product_calendar drop column closed_slot` + retirer toute référence à
   `schedule='slot'` dans le code (colonne `products.schedule` reste, sa valeur `'slot'` devient
   inatteignable côté UI — `product_slot_rules` est le mécanisme retenu pour les créneaux, cf. §10
   pour la justification de ce choix plutôt qu'un report).

### Tranche 1 — Vue opérationnelle des réservations + modification d'une ligne *(implémentée le 2026-08-17)*

**Nouvel écran socio — « Mis Reservas »** (`apps/admin/app/partner/(app)/reservations/page.tsx` ou
sous-route de `products/`) :
- Requête : `order_lines` jointes à `products`/`establishments` filtrées sur les produits dont
  `establishment_id` appartient à un établissement du partenaire connecté (RLS existante
  `order_lines_select`/`products_select_public` à vérifier, sinon nouvelle policy lecture seule),
  `status <> 'hold'`, triées `date desc`, limite 100.
- Colonnes : date, créneau (si applicable), produit (nom localisé), `holder_name`, qty, total_cop,
  statut. ⚠️ **Périmé** — décrivait `holder_name` **uniquement** (jamais `holder_phone`/`holder_email`,
  PII minimale reprise du comportement v1) ; RENVERSÉ par une décision de Jérôme du 2026-08-19
  (migration `20260819180000_order_lines_holder_contact_operator.sql`, cahier `02` § Écarts connus) —
  le socio a désormais besoin de contacter son client, `holder_phone`/`holder_email` sont exposés.
  La pièce d'identité reste exclue.

**Admin — filtre produit sur `/admin/orders`** :
- `apps/admin/lib/lists/filters.ts` : ajouter `product_id` à `ORDERS_FILTER_DEFINITIONS`.
- `apps/admin/app/admin/orders/page.tsx` : `if (filters.product_id) query =
  query.eq("product_id", filters.product_id)` — nécessite que `order_lines` porte bien
  `product_id` en colonne directement filtrable (déjà le cas).
- `apps/admin/components/availability-calendar.tsx` : chaque case du mois porte un lien
  `/admin/orders?product_id=<id>&date_from=<date>&date_to=<date>` quand `booked > 0`.

**RPC `modify_order_line(p_order_line_id uuid, p_new_date date, p_new_qty int, p_reason text)
returns jsonb`** — nouvelle migration, `security definer`, `set search_path = ''`, grant
`authenticated` (admin uniquement — vérifier `is_admin(auth.uid())` en garde 1) :
1. `select ... from order_lines where id = p_order_line_id for update` (verrou sur la ligne
   source) ; refuse si `status` n'est pas actif (`reserved`/`fulfilled` selon vocabulaire feature 8)
   ou si `p_reason` est vide.
2. Verrouille la ligne `product_availability(product_id, p_new_date)` `for update`.
3. **Arithmétique de capacité** : `v_available := capacity - (booked - v_old_qty +
   p_new_qty)` — jamais `booked + p_new_qty` seul (double-compterait la réservation existante).
   Refuse `{ok:false, reason:'full'}` si négatif.
4. Décision produit requise avant d'écrire l'`update`/l'`insert` (cf. §10, point ouvert n°1) :
   selon la réponse, soit la capacité de l'ancienne date est libérée (`booked := booked -
   v_old_qty` sur l'ancienne ligne `product_availability`) soit elle ne l'est jamais (comme
   `cancel_order`) — **ne pas coder avant cette décision tranchée par Jérôme**.
5. Marque la ligne d'origine `status := 'superseded'` (nouveau statut terminal, à ajouter au
   `CHECK` de `order_lines.status`) plutôt que de la modifier en place ; insère une nouvelle ligne
   portant `p_new_date`/`p_new_qty`, mêmes `price_cop`/`acompte_cop`/snapshots de commission que
   l'originale (créer une copie, pas un recalcul — l'historique financier de la ligne d'origine
   reste intact, cf. `00-modele-de-donnees.md` §5), avec une colonne `replaces_order_line_id`
   pointant vers l'ancienne.
6. Décision requise avant d'écrire (§10, point ouvert n°3) : que devient une éventuelle entrée
   `pms_reconciliation_entries` FK'ée sur l'ancienne `order_line_id` ?
- **Scope v1 explicite** : cette RPC ne gère que les lignes dont le produit n'est ni `hotel`
  réservé par chambre ni un futur lodging par nuits (Tranche 2) — elle raisonne uniquement sur
  `product_availability` par date unique. Réécriture prévue en Tranche 2 pour devenir polymorphe
  (chambre/nuit).

**Écran** : bouton « Modificar » dans `apps/admin/app/admin/orders/OrdersTable.tsx`, à côté de
« Cambiar estado » — ouvre un dialogue avec le même composant calendrier que la réservation
cliente pour choisir la nouvelle date, quantité re-bornée par `min_qty`/`max_qty` du produit.

### Tranche 2 — Moteur unifié chambre d'hôtel + alojamiento par nuits *(implémentée le 2026-08-17)*

**Nouvelles tables** (deux tables dédiées avec FK réelle — PAS une table polymorphe
`entity_type`/`entity_id`, cf. §10 pour la correction et sa justification) :

```sql
create table product_date_rates (
  product_id uuid not null references products(id) on delete cascade,
  date date not null,
  price_cop bigint not null,
  note text,
  primary key (product_id, date)
);
-- RPC-only : revoke insert, update, delete on product_date_rates from authenticated, anon;

create table room_type_date_rates (
  room_type_id uuid not null references product_room_types(id) on delete cascade,
  date date not null,
  price_cop bigint not null,
  note text,
  primary key (room_type_id, date)
);
-- RPC-only, même raisonnement.

create table room_type_availability (
  room_type_id uuid not null references product_room_types(id) on delete cascade,
  date date not null,
  capacity int not null,
  booked int not null default 0,
  primary key (room_type_id, date)
);
-- RPC-only, miroir exact de product_availability.
```

**`order_lines`** : ajouter `room_type_id uuid references product_room_types(id)` (nullable — NULL
pour tout ce qui n'est pas une chambre d'hôtel), `end_date date` (nullable — présent seulement pour
une ligne à plage de nuits ; `date` porte alors le check-in, `end_date` le check-out exclusif,
sémantique `[date, end_date[` identique à la v1).

**`create_order`, nouvelle branche par plage** (Phase 2/3/4, dans la même transaction) :
1. Pour une ligne `room_type_id is not null` ou `type='lodging' and end_date is not null` :
   construire les dates `[date, end_date[`.
2. Verrouiller `room_type_availability(room_type_id, d)` (ou `product_availability(product_id, d)`
   pour un lodging) pour chaque `d`, **`order by d for update`** (patron déjà en place dans la
   branche camp de `create_order`, réutilisé tel quel pour l'ordre déterministe — la clé verrouillée
   suit la granularité par entité, jamais `provider_resource_calendar`, cf. §10).
3. Refuse si une seule nuit est fermée/pleine.
4. Résout le prix de chaque nuit via `resolve_date_price` (nouvelle fonction SQL, cf. ci-dessous),
   somme nuit par nuit (jamais un prix forfaitaire — arrondi par nuit, invariant repris de la v1
   `stayService.quote()`).
5. Décrémente chaque `room_type_availability`/`product_availability` de la plage, insère la ligne.

**Fonction `resolve_date_price(p_entity_type text, p_room_type_id uuid, p_product_id uuid, p_date
date) returns bigint`** — chaîne de priorité (§10 point ouvert n°2 tranche la sémantique de `qty`,
mais la chaîne de prix elle-même est proposée ici, à confirmer) :
1. `room_type_date_rates`/`product_date_rates` pour cette date exacte, si une ligne existe.
2. Sinon `stay_rates` (saison haute / majoration week-end) appliqué au tarif par palier.
3. Sinon `price_tiers`/`product_room_types.price_tiers` (palier de quantité).
4. Sinon `price_cop`/`product_room_types.price_cop` (prix de base).

**Plafond Phase 1 `create_order`** : étendre le test `v_product_type = 'lodging'` actuel (lignes
≤4, unités ≤12) pour inclure `'hotel'` — même plafond ou un plafond dédié, à trancher en écrivant
(§10).

**Client `apps/web/.../ReservationForm.tsx`** : nouveau mode plage pour `lodging`/`hotel` — cadré
comme un écran neuf (sélecteur de type de chambre, disponibilité par chambre, validation nuit par
nuit), pas un simple changement de `mode` sur le composant existant. Choix de composant calendrier :
cf. §3bis.

**Admin/socio** : nouvelle grille « chambres × dates » — cf. §3bis (TanStack Table + `SimpleTable`,
pas un calendrier classique), une ligne par `room_type_id`, une colonne par date, cellule éditable
(prix + capacité du jour).

**Tests** : pgTAP (contraintes des 3 nouvelles tables, whitelist RPC) + concurrence — matrice élargie
par rapport au patron camp (plages identiques, imbriquées, adjacentes, qty multiples de la même
chambre le même soir sur la même fenêtre), cf. §10.

### Invariants (toutes tranches)

- L'anti-survente est **toujours** vérifiée dans la transaction serveur (`create_order`/
  `modify_order_line`), jamais uniquement côté client.
- Une capacité déjà vendue ne se libère jamais par un simple clic d'édition de calendrier — seule
  une action tracée (annulation, ou la décision Tranche 1 point ouvert n°1 une fois tranchée pour
  `modify_order_line`) peut la libérer.
- Toute nouvelle table de capacité/prix par date suit le patron sparse/override de
  `product_calendar` — jamais une ligne pré-générée par jour.
- `modify_order_line` ne modifie jamais une ligne en place : elle la remplace, historique et
  snapshots financiers d'origine intacts.
- ⚠️ **Périmé** — décrivait « PII minimale côté socio (jamais téléphone/email dans « Mis
  Reservas »), pleine visibilité côté admin (déjà le cas dans `/admin/orders`) » ; RENVERSÉ le
  2026-08-19 (migration `20260819180000`, cahier `02` § Écarts connus) — le socio voit désormais
  `holder_phone`/`holder_email`, comme l'admin.

### Cas limites (toutes tranches)

- `price_cop` null sur un produit non `evento` : refusé par `create_order`, message
  `price_missing`, jamais un crash `NOT NULL`.
- `modify_order_line` vers une date pleine/fermée : refusé, ligne d'origine intacte.
- `modify_order_line` sur une ligne déjà `superseded`/annulée : refusé (`not_active`).
- Plage de nuits chevauchant partiellement une plage déjà réservée sur la même chambre : refusée
  sur la première nuit en conflit, aucune nuit de la nouvelle plage n'est consommée (tout ou rien).
- Aucune ligne `product_date_rates`/`room_type_date_rates` pour une date : repli sur `stay_rates`
  puis `price_tiers` puis prix de base, jamais un prix `null`/0.

### Fichiers touchés

**Tranche 0** : `apps/admin/app/admin/products/[id]/edit/page.tsx`,
`supabase/migrations/<nouvelle>_calendar_guards_and_cleanup.sql` (garde `create_order` + drop
`'tour'`/`closed_slot`), `apps/admin/lib/lists/filters.ts`, écran de liste établissements (lien
Recurso compartido).

**Tranche 1** : nouvelle route socio réservations, `apps/admin/lib/lists/filters.ts` (filtre
`product_id`), `apps/admin/app/admin/orders/OrdersTable.tsx` (bouton Modificar),
`apps/admin/components/availability-calendar.tsx` (lien vers `/admin/orders`),
`supabase/migrations/<nouvelle>_modify_order_line.sql`.

**Tranche 2** : `supabase/migrations/20260817210000_room_type_availability_and_date_rates.sql`
(`product_date_rates`/`room_type_date_rates`/`room_type_availability`, `order_lines.room_type_id`/
`end_date`, `resolve_date_price`, `resolve_tier_price`, `create_order` réécrit avec deux branches
plage, `set_room_type_availability`, `set_date_rate`, garde plage sur `modify_order_line`) ;
`supabase/tests/database/room_type_and_date_range_booking.test.sql` (34 assertions) ;
`tests/concurrency/create_order_room_range.concurrency.mjs` (3 scénarios) ; écran neuf
`apps/admin/components/room-availability-grid.tsx` + `apps/admin/app/admin/products/[id]/
room-availability/page.tsx` + `apps/admin/app/partner/(app)/products/[id]/room-availability/
page.tsx` (dérogation `SimpleTable` validée §3bis) ; liens conditionnels ajoutés dans
`apps/admin/app/admin/products/[id]/edit/page.tsx` et `apps/admin/app/partner/(app)/products/
ProductsGrid.tsx` (+ `page.tsx`, colonne `type`) ; écran client neuf
`apps/web/.../HotelReservationForm.tsx` (sélecteur de chambre + `react-day-picker` `mode="range"`,
décision §10 point 6) branché dans `apps/web/.../products/[slug]/page.tsx` ; `CartContext.tsx`
(`roomTypeId`/`roomTypeName`/`endDate`) et `CheckoutForm.tsx` (lignes par plage, nouvelles raisons
de refus traduites) ; e2e `apps/web/e2e/reserve-hotel-room.spec.ts` +
`apps/admin/e2e/admin-room-availability-grid.spec.ts`. Complété le 2026-08-17 (§10 points 9/11) :
`supabase/migrations/20260817220400_modify_order_line_range_support.sql` (réécriture polymorphe) +
`ModifyOrderLineDialog.tsx`/`OrdersTable.tsx` étendus + e2e
`admin-modify-room-range-order-line.spec.ts` ; `apps/web/.../LodgingReservationForm.tsx` (nouveau,
branché via `isLodging` dans `page.tsx`) + e2e `reserve-lodging-range.spec.ts` ;
`availability-calendar.tsx` étendu (« Precio especial » par date, `set_date_rate('product', ...)`)
+ les deux `availability/page.tsx` (admin/partner) + pgTAP dédié
`set_date_rate_product.test.sql` + e2e `admin-lodging-date-rate.spec.ts`.

**Gap post-implémentation, fermé le 2026-08-18 (§10 point 12)** :
`supabase/migrations/20260818090000_product_default_capacity.sql` (`products.default_capacity`,
fallback dans `create_order`/`modify_order_line`) + `supabase/migrations/
20260818093000_product_default_capacity_proposal_parity.sql` (parité proposition socio,
4 fonctions) ; `tests/concurrency/create_order_default_capacity.concurrency.mjs` (matérialisation
sous concurrence, 5 runs) ; nouveaux cas pgTAP dans `create_order.test.sql`,
`modify_order_line.test.sql`, `product_creation_proposal.test.sql`, `product_proposals.test.sql`,
`moderate_product_proposal.test.sql` ; champ « Cupo diario por defecto » dans
`product-type-fields.tsx`/`useProductTypeFieldsState.ts`/`product-form.tsx`/
`productCreationPayload.ts`/`productEditPayload.ts` ; badge « Por defecto : N » dans
`availability-calendar.tsx`/`.css` + les deux `availability/page.tsx` (admin/partner).

---

## 1. Contexte et problème

Jérôme constate que « plein de choses ne vont pas » sur le calendrier/la disponibilité du nouveau
stack Hifago. Deux explorations complètes (v1 legacy à la racine du dépôt, Express/SQLite, et v2
`hifago/`) plus une critique adversariale dédiée établissent un constat de départ : **aucune spec
« calendrier » n'existe** dans `hifago/docs/specs/` (01 à 16) — la logique est dispersée sur les
specs 08/11/12/13/14 et deux documents de cadrage (`00-modele-de-donnees.md`,
`05-reference-technique.md`) qui ont déjà tranché une partie de l'architecture cible sans jamais
avoir été transformés en spec actionnable pour ce sujet.

### Ce que fait la v1 legacy aujourd'hui

Moteur unique `src/services/inventoryService.js`. Cupos = `product_calendar` (exceptions
**sparse/override**, `PRIMARY KEY(product_id,date)`, absence de ligne = état par défaut) +
décompte via `order_lines`. Anti-survente **toujours** dans la transaction
`orderService.createOrder`, jamais côté front. Cupos par créneau = capacité comptée séparément par
demi-journée (`schedule='slot'`, décision Jérôme 2026-07-30). Une place vendue ne se reprend
jamais d'un clic (`assertNoSoldSeatsLost`, garde serveur). Maison entière hors PMS (Bania) :
`stay_rates` (grille par palier + majoration **mensuelle**, jamais par date précise) + nuitées
`[start_date,end_date[`. Casa Kayam (PMS) : disponibilité 100% LobbyPMS, jamais dupliquée en
SQLite, calendrier admin en lecture seule. Camps/eventos : un seul `type='tour'` sous-jacent,
`calendar_default_open=0` forcé à la création (fermé par défaut). Les bugs connus G10/G11/G12
(client ignorait les cupos restants ; admin ne voyait pas le consommé ; capacité=0 non signalée
fermée) sont déjà résolus — aucun chantier calendrier v1 encore ouvert au backlog.

**Deux capacités v1 qui n'existent pas côté v2, confirmées par grep** :
- **Socio — « Mis Reservas »** (`docs/2-reference/02-app-partner.md`, module Prestador,
  `GET /api/partner/operator/overview`) : les 100 dernières `order_lines` des produits du
  prestataire, hors `hold` — date/créneau, produit, `holder_name` (PII **minimale**, ni téléphone
  ni email), qty, total, statut. `hifago/apps/admin/app/partner/` ne contient aujourd'hui aucun
  fichier order/booking/reserva — un socio v2 peut ouvrir/fermer son calendrier mais ne voit
  jamais qui a réservé.
- **Éditer une réservation (date/quantité)** : n'existe **nulle part**, ni v1 ni v2. La v1
  « Pedidos » (`docs/2-reference/03-app-admin.md` §8) ne fait que des transitions de statut
  (`realizada`/`no_show`/`cancelaciones`). `ChangeStatusDialog.tsx` (v2) reproduit exactement ce
  même périmètre. La sémantique cible est pourtant déjà tranchée (`00-modele-de-donnees.md` §5,
  2026-08-13) : « une modification peut ajouter une ligne, annuler une ligne précise ou
  **remplacer une ligne (date/quantité)** ; les snapshots financiers de la ligne d'origine restent
  intacts » — jamais construite.

Le calendrier lui-même et la liste des réservations sont **disjoints partout, y compris en v1** :
un jour porte un agrégat (« M 2/3 · T 0/3 », point ● si vendu), savoir QUI a réservé oblige à
changer d'écran (Pedidos/Mis Reservas, filtrable par date mais jamais relié au clic sur une case).

### Ce que fait la v2 hifago aujourd'hui

`product_calendar`/`product_availability` (RPC-only, `set_product_availability` déjà unifié
admin+socio, cf. spec 15/17bis) fonctionnent pour date unique + activité/transport/camp/lodging
générique — bien testé (pgTAP + concurrence). `provider_resource_calendar`/`availability_blocks` :
ressource partagée **camp uniquement**, câblée en dur sur `establishment_id` (pas la table de
liaison many-to-many que le modèle cible §4c décrit) ; blocage croisé camp↔activité ordinaire
différé. `product_slot_rules` : définitionnel seulement (Tranche 1 de la spec 11), zéro
réservation réelle ; `schedule='slot'`/`product_calendar.closed_slot` (legacy) mort en parallèle —
deux mécanismes de créneau, aucun fonctionnel, coexistence déjà signalée comme non tranchée dans
le commentaire de tête de `20260816091000_product_slot_rules.sql`. `product_room_types` (chambres
hôtel) : riche en définition (prix, tarifs par palier, `stay_rates`, photos), **zéro RPC ne
référence `room_type_id`** — confirmé aussi par `docs/specs/13-admin-hotel-habitaciones.md` §10.
`stay_rates` (lodging et chambre hôtel) : jamais consommé par `create_order`.

**Bug confirmé, chaîne d'atteinte complète retracée** (déjà noté comme risque *non confirmé* dans
la spec 13 §10 — confirmé ici) :
1. `apps/admin/app/admin/products/[id]/edit/page.tsx` (lignes 156-161) affiche le lien
   « Calendario & cupos » sans condition de type.
2. `apps/admin/app/admin/products/[id]/availability/page.tsx` n'a aucune garde de type — un admin
   peut ouvrir des cupos sur un produit `hotel` exactement comme sur une activité.
3. `apps/web/app/[locale]/products/[slug]/page.tsx` (ligne 83) n'exclut que `type==='evento'` du
   `ReservationForm` générique — `'hotel'` n'est pas exclu (0 occurrence de `'hotel'` dans
   `apps/web`, confirmé par grep).
4. `create_order` (`20260815240000_create_order_qty_bounds_and_tiers.sql`, Phase 4) calcule
   `v_total_cop := v_line_price_cop * qty` sans erreur si `price_cop` est `NULL` (arithmétique NULL
   silencieuse en PL/pgSQL) — c'est l'`insert into order_lines` juste après qui casse sur la
   contrainte `NOT NULL` (`20260814180000_order_lines_commission_snapshot.sql`), une exception
   Postgres brute au lieu d'un refus métier propre.

Deux surfaces distinctes ferment ce bug, pas une : masquer le lien admin (UX) **et** garder le
refus serveur dans `create_order` (invariant, nécessaire même si l'UX est corrigée — la RPC est
appelable directement).

**Bugs UI mineurs confirmés** : `'hotel'` absent de `PRODUCT_TYPES`
(`apps/admin/lib/lists/filters.ts`) ; lien « Recurso compartido » affiché pour tout établissement
même sans camp/evento ; type `'tour'` orphelin — confirmé **mort**, pas juste suspect (aucun
chemin de création ne le produit, malgré sa présence dans le `CHECK` et le filtre).

Notification prestataire post-réservation (camp/evento) : prévue par deux cahiers des charges et
le modèle de données, jamais construite (dépend d'un système de notification transverse pas encore
construit, cf. Tranche 4).

## 2. Portée

**In (Tranches 0/1/2, cette spec, prêtes à coder)** :
- Tranche 0 : correctifs immédiats (bug `price_cop`, filtre de type, liens conditionnels, nettoyage
  `'tour'`/`closed_slot`).
- Tranche 1 : vue opérationnelle des réservations (« Mis Reservas » socio, lien calendrier→commandes
  admin) + modification d'une réservation existante (`modify_order_line`, scope non-lodging/hôtel).
- Tranche 2 : moteur unifié chambre d'hôtel réservable + alojamiento par nuits (prix variable par
  date, capacité par chambre, plage check-in/check-out).

**Out, nommé et scopé ici mais renvoyé à une spec dédiée future (numéro non attribué)** :
- Tranche 3 : créneaux (`product_slot_rules`) réellement réservables — direction posée en §10, pas
  de signature RPC figée, à spiker avant validation (même statut que l'extension camp l'était avant
  `05-reference-technique.md` §1bis).
- Tranche 4 : généralisation de la ressource partagée (`availability_resources` many-to-many),
  blocage croisé camp↔activité ordinaire, evento réservable en ligne, notification prestataire —
  seule tranche qui touchera de vraies données de production (backfill nécessaire), délibérément
  séparée pour cette raison.

## 3. Décisions retenues

Décisions déjà actées ailleurs, à ne pas rouvrir :

- **Sparse/override par date, jamais une ligne pré-générée par jour** (`00-modele-de-donnees.md`
  §1, décision 2026-08-12) — le patron déjà validé par `product_calendar` est repris à l'identique
  pour `product_date_rates`/`room_type_date_rates`/`room_type_availability`.
- **Ressource de disponibilité partagée générique** (`00-modele-de-donnees.md` §4c, décision
  2026-08-13) — `availability_resources` + liaison many-to-many produit↔ressource, réservation
  atomique, notification prestataire post-commit. Renvoyé à la Tranche 4.
- **Granularité de modification d'une réservation** (`00-modele-de-donnees.md` §5, décision
  2026-08-13) : ajouter une ligne / annuler une ligne précise / remplacer une ligne (date+qty) en
  conservant l'historique — jamais un écrasement en place. Base de `modify_order_line` (Tranche 1).
- **Squelette de verrouillage multi-jours** (`05-reference-technique.md` §1bis) : dates verrouillées
  dans un ordre déterministe (`order by date for update`), test de concurrence obligatoire avant de
  considérer un pattern acquis — repris pour la Tranche 2, avec une matrice de tests élargie (§10).
- **Une place vendue ne se reprend jamais d'un clic** (cahier des charges socio §3d, client §3d) —
  refus côté serveur nommant la date et le nombre de places, jamais une simple désactivation
  d'interface.
- **Deux clauses de révision déjà écrites dans `docs/04-architecture-cible.md`**, qui autorisent
  explicitement à rouvrir le choix de librairie calendrier (§3bis n'est donc pas une décision
  déjà tranchée qu'on rouvrirait en douce) :
  - Lignes ~204-209 : le remplacement de `react-day-picker` par le `Calendar`/`DatePicker` natif
    HeroUI v3 est **explicitement laissé ouvert**, pas une décision protégée.
  - Lignes ~226-227 : `@fullcalendar/resource-timeline` (payant) volontairement écarté « au premier
    périmètre », avec une clause de révision explicite « à garder en tête si une vue multi-chambres
    façon PMS est demandée plus tard » — exactement la situation de la Tranche 2.

## 3bis. Choix technique du calendrier

Fait vérifié dans le code installé (pas dans une documentation externe) : `@heroui/react` (déjà
dépendance du projet, design system mandaté par `hifago/CLAUDE.md` §2) expose déjà des primitives
compound complètes `Calendar`/`RangeCalendar`/`CalendarYearPicker`
(`node_modules/@heroui/react/dist/components/{calendar,range-calendar,calendar-year-picker}`,
basées sur `react-aria-components`) — **jamais utilisées dans le code applicatif aujourd'hui**.
`packages/ui/src/index.ts` fait déjà `export * from "@heroui/react"` : `import { Calendar,
RangeCalendar } from "@hifago/ui"` fonctionnerait dès aujourd'hui, sans aucune plomberie
supplémentaire — le seul coût est applicatif (écrans à construire), pas d'installation.
`CalendarSelectionMode` (`react-stately`) vaut `'single' | 'multiple'` : `Calendar` couvre
nativement la sélection multiple non contiguë (besoin admin : jusqu'à 31 dates puis lot) ;
`RangeCalendar` est un **composant séparé** pour une plage contiguë (besoin client Tranche 2).
`isDateUnavailable`/`minValue`/`maxValue` déjà dans l'API — couvrent les dates fermées/pleines
grisées et la fenêtre bornée dans le temps.

| Option | Déjà dans le dépôt | Coût/risque migration | Limite réelle |
|---|---|---|---|
| FullCalendar `dayGrid`+`interaction` (actuel, admin/socio) | Oui — `availability-calendar.tsx`, CSS de restylage déjà écrit | Zéro pour l'existant | Multi-sélection non contiguë : rien de câblé aujourd'hui (un jour à la fois). Grille chambres×dates : non couvert sans `resource-timeline` (payant) |
| HeroUI `Calendar` (`selectionMode="multiple"`) | Exporté par `@hifago/ui`, zéro usage applicatif réel | Moyen — nouvel écran à construire (`CalendarCell`/`CalendarCellIndicator` custom pour les badges par jour), mais primitives déjà stylées HeroUI, pas de CSS à resynchroniser | Correspond nativement au besoin multi-sélection admin (31 dates). Nécessite `@internationalized/date` (`CalendarDate`), conversion à écrire depuis `date-fns`/ISO utilisé ailleurs. Pas conçu pour une grille chambres×dates |
| `react-day-picker` (actuel, client, `mode="single"`) | Oui — `legacy-calendar.tsx`, wrapper très investi (`DayButton` custom, `data-date` ciblé par des tests e2e, modifiers dernière place/complet) | Zéro pour le mode actuel ; moyen pour `mode="range"` (styles `range_start`/`range_middle`/`range_end` déjà partiellement présents) | Pas de `selectionMode='multiple'` façon admin. En mode plage : la notion de « dernière place » n'a plus de sens évident sur une plage entière, à repenser |
| HeroUI `RangeCalendar` | Exporté par `@hifago/ui`, zéro usage | Élevé si remplace `react-day-picker` : perdre les acquis (badges, ciblage e2e) contre la cohérence design system | Nativement adapté à une plage contiguë. Ne couvre pas la multi-sélection non contiguë (composant distinct de `Calendar`) |
| TanStack Table + `SimpleTable` | Convention déjà établie (`hifago/CLAUDE.md` §2), déjà utilisée pour tables denses à cell renderers custom | Faible — aucune nouvelle dépendance, nouvel écran avec le moteur déjà en place | **Bonne réponse pour la grille chambres×dates** (lignes=types de chambre, colonnes=jours, cellule éditable=prix/dispo) — pas un calendrier classique. `SimpleTable` reflow mobile = cartes empilées, **contre-productif pour une matrice** — dérogation explicite à documenter et faire valider par Jérôme (scroll horizontal + colonne figée), pas une décision solo |
| `@fullcalendar/resource-timeline` | Non installé | Élevé — **licence payante récurrente** (Commercial ou GPLv3 ; usage commercial ici, la clause CC-NC ne s'applique pas) | Couvrirait la grille chambres×dates nativement en tant que « calendrier », mais coût annuel pour un besoin (grille éditable, pas de drag-and-drop demandé) que TanStack Table couvre déjà sans coût |

**Recommandation par cas d'usage — pas une réponse unique** :

1. **Mois-grille admin/socio, produit unique (écran actuel)** : garder FullCalendar `dayGrid`+
   `interaction` tel quel — fonctionne, zéro dette. Pour le nouveau besoin de multi-sélection par
   lot (jusqu'à 31 dates) : évaluer un essai réel HeroUI `Calendar selectionMode="multiple"` côte
   à côte avant de trancher (correspondance native plus proche du besoin), plutôt qu'étendre
   FullCalendar au-delà de ses deux plugins gratuits actuels — décision à valider par un
   prototype, pas seulement par cette lecture de documentation.
2. **Sélecteur client single-date** : ne pas toucher `react-day-picker`, aucune raison de bouger.
   Pour check-in/check-out (Tranche 2) : **tranché sur prototype réel le 2026-08-17** (§10 point 6)
   — étendre `react-day-picker` en `mode="range"`, pas `RangeCalendar` HeroUI.
3. **Grille chambres×dates (nouveau besoin, Tranche 2)** : TanStack Table + `SimpleTable`, pas un
   calendrier au sens classique — dérogation au reflow-mobile **tranchée sur prototype réel le
   2026-08-17** (§10 point 7), validée.
4. **Éviter `@fullcalendar/resource-timeline`** sauf fait nouveau fort (ex. besoin réel de
   drag-and-drop entre chambres, non demandé aujourd'hui) — le coût de licence récurrent n'achète
   rien que TanStack Table ne couvre déjà pour le besoin réellement exprimé.

## 4. Parcours cible

Narré à partir des comportements v1 déjà documentés (`docs/2-reference/02-app-partner.md`,
`03-app-admin.md`, `04-app-reservar.md`) — dit explicitement pour chacun s'il est repris tel quel,
adapté, ou amélioré au-delà de ce que la v1 faisait. **Note de sourçage** : les exigences
« case ≥44px / `aria-label` / `aria-pressed` » ci-dessous viennent du comportement **v1 legacy**
documenté — la relecture adversariale de cette spec n'en a trouvé aucune trace dans
`docs/specs/09-design-system-admin.md` ni le skill `hifago-ui` côté v2. Elles sont proposées ici
comme **une reprise volontaire du comportement v1, nouvelle exigence v2**, jamais présentées comme
un requis déjà acté côté v2.

**Client** (repris tel quel de la v1, `04-app-reservar.md`) : mini-calendrier par produit, mois
navigables `[aujourd'hui, +180j]`, dates fermées/pleines grisées, demi-journée fermée teintée pour
un produit à créneaux, ligne « Quedan N lugares » dès ≤6 places (clignote si le client insiste sur
`+` au plafond), stepper reclampé à chaque changement de date/créneau. **Amélioré** en Tranche 2 :
sélection de plage check-in/check-out pour lodging/hôtel, sélecteur de type de chambre.

**Admin** (repris et étendu de `03-app-admin.md` §8) : case du mois = occupation « M 2/3 · T 0/3 »
+ point ● si vendu, sélection multi-date puis ouverture/fermeture par lot (max 31), fermeture jour
entier vs demi-journée, jours passés non sélectionnables, refus serveur nommant la date+le nombre
de places en cas de tentative de reprise du vendu. **Nouveau, au-delà de la v1** (Tranche 1) :
cliquer une case ouvre la liste des réservations de ce jour pour ce produit — la v1 n'avait pas
cette liaison (calendrier et Pedidos disjoints).

**Socio** (repris de `02-app-partner.md` §Calendrier prestataire) : mêmes états/refus que l'admin
(même service `set_product_availability`), cases ≥44px, `aria-label` état+réservations,
`aria-pressed`, légende énumérant les 4 états, toast « Selección reiniciada » au changement de
mois, libellé « Cupos por franja » si per-slot. **Nouveau, restauré de la v1** (Tranche 1) : écran
« Mis Reservas » — la v1 l'avait, la v2 ne l'a pas encore.

## 5. Écran(s)

Voir §0 « Fichiers touchés » pour la liste par tranche — regroupement fonctionnel :
- **Fiche produit admin** (`/admin/products/[id]/edit`) : lien Calendario conditionnel par type.
- **Calendrier produit** (`/admin/products/[id]/availability`, `/partner/products/[id]/availability`) :
  inchangé en Tranche 0/1 (lien vers commandes ajouté en Tranche 1), refonte de rendu en Tranche 2
  pour le mode plage/prix (chambre, alojamiento).
- **Pedidos admin** (`/admin/orders`) : filtre produit + bouton Modificar (Tranche 1).
- **Nouveau : Mis Reservas socio** (Tranche 1).
- **Nouveau : grille chambres×dates** (Tranche 2, admin + socio).
- **ReservationForm client** (`apps/web`) : mode plage pour lodging/hôtel (Tranche 2).

## 10. Décisions tranchées / points ouverts

**Tranchées ici** :
- Type `'tour'` : suppression directe (Tranche 0) — confirmé zéro chemin de création, zéro donnée
  possible, pas un arbitrage à ouvrir.
- `schedule='slot'`/`closed_slot` : suppression des colonnes mortes, `product_slot_rules` retenu
  comme unique mécanisme de créneau futur (Tranche 3) — décidé une seule fois ici, pas re-posé en
  Tranche 3.
- Architecture du prix par date (Tranche 2) : deux tables dédiées avec FK réelle
  (`product_date_rates`, `room_type_date_rates`), **pas** une table polymorphe `entity_type`/
  `entity_id`. Le brouillon initial de cette spec proposait une table polymorphe en la présentant
  comme le même patron que `add_catalog_media`/`reorder_gallery` — vérifié faux :
  `add_catalog_media(p_entity_type, ...)` (`20260816130000_room_media_and_room_stay_rates.sql`)
  est un **dispatcher RPC** au-dessus de trois tables physiques distinctes
  (`product_media`/`establishment_media`/`room_media`), chacune avec une vraie FK — le vrai
  précédent est donc l'inverse d'une table polymorphe sans intégrité référentielle. Corrigé avant
  écriture de cette spec.
- Verrouillage multi-nuits (Tranche 2) : la boucle déterministe (`order by date for update`) vient
  du patron camp et se transpose ; la **granularité de la clé verrouillée** suit
  `product_availability`/`room_type_availability` (par entité), jamais
  `provider_resource_calendar` (par établissement partagé) — les deux précédents ne jouent pas le
  même rôle, à ne pas fusionner.

**Tranchées le 2026-08-17 (retour direct de Jérôme + recherche pour le point sur la réconciliation)** :
1. **`modify_order_line` est neutre en capacité** : elle libère la capacité de l'ancienne date/
   ligne (contrairement à `cancel_order`, qui ne libère jamais rien — décision produit distincte et
   volontaire) et consomme la nouvelle, dans la même transaction.
2. **`pms_reconciliation_entries` orpheline → transférée vers la nouvelle ligne**, jamais close
   automatiquement ni laissée orpheline. Recherché : la table (`20260814210000_pms_reconciliation_
   entries.sql`) porte déjà `attempts`/`open`/`retrying`/`resolved`/`permanently_failed`, mais
   aucun connecteur Lobby ne l'alimente encore (backlog) et l'API Lobby n'a de toute façon aucun
   endpoint de modification de réservation (seulement `POST /bookings` et `POST /cancel-booking/
   {id}`, confirmé dans `docs/3-integrations/lobby_pms_api.md`) — un futur retry portera donc de
   toute façon sur l'état de la NOUVELLE ligne. `update pms_reconciliation_entries set
   order_line_id = v_new_line_id where order_line_id = p_old_line_id and status in
   ('open','retrying')`, historique de tentatives conservé. Clore automatiquement contournerait la
   règle déjà en place qui exige un motif humain pour résoudre une entrée
   (`resolve_reconciliation_entry`). *Note annexe, hors périmètre de cette spec* : le commentaire de
   `00-modele-de-donnees.md` §5 selon lequel « le schéma réel ne porte pas encore le cycle cible »
   visait en fait l'ancienne table legacy `exceptions_queue`, pas `pms_reconciliation_entries` —
   devenu obsolète, à corriger séparément.
3. **Sémantique de `qty` pour une chambre — dépend de `product_room_types.kind`, déjà en base**
   (`'dorm'` / `'private'`, `20260816110000_product_hotel_rooms.sql`) : pour `kind='dorm'`, `qty`
   = nombre de lits (voyageurs) — cohérent avec un `price_cop` déjà pensé par personne ; pour
   `kind='private'`, `qty` = nombre de chambres — cohérent avec un prix par chambre/nuit. Décrément
   de `room_type_availability` toujours en unités de `qty` telles quelles ; la capacité totale
   d'une ligne `dorm` au moment de sa définition admin est `quantity × capacity` (nombre de
   dortoirs physiques × lits par dortoir), celle d'une ligne `private` est `quantity` (nombre de
   chambres physiques).
4. **Plafond par ligne pour une chambre — `product_room_types.min_qty`/`max_qty`, déjà en base**
   (mêmes colonnes que `products.min_qty`/`max_qty` pour une activité), pas le plafond générique
   `lodging_cap_exceeded` (qui reste réservé à `type='lodging'`, sémantique différente).
5. **Chaîne de priorité des prix** (Tranche 2, §0) : override date > stay_rates > price_tiers >
   prix de base — confirmée par Jérôme, retenue telle quelle.

**Tranchées le 2026-08-17 (suite) — sur prototype réel, pas sur documentation seule** (Jérôme :
« il faut tester pour savoir ») :

6. **Calendrier client check-in/check-out : `react-day-picker` en `mode="range"`, pas `RangeCalendar`
   HeroUI.** Les deux ont été réellement montés et exercés (navigateur, sélection d'une plage,
   franchissement d'une nuit fermée) :
   - `react-day-picker` : passer `mode="range"` sur le `Calendar` existant suffit — les styles
     `range_start`/`range_middle`/`range_end` et les attributs `data-range-*` de
     `legacy-calendar.tsx` (déjà écrits, jamais exercés avant ce prototype) s'activent sans y
     toucher. Rendu correct au premier essai, badges dernière-place/fermé compatibles avec le mode
     plage. **Mais** il laisse sélectionner une plage qui traverse une nuit fermée sans le moindre
     avertissement natif (testé : plage 19→25 août incluant le 22 fermé, acceptée visuellement) —
     la détection par nuit (déjà prévue au §3bis note b) doit être portée par l'app, exactement
     comme pressenti.
   - `RangeCalendar` HeroUI : aucun rendu par défaut, il faut assembler à la main tout l'arbre
     compound (`Header`/`Heading`/`NavButton`/`Grid`/`GridHeader`/`HeaderCell`/`GridBody`/`Cell`/
     `CellIndicator`) — un premier essai sans le texte du jour dans `Cell` a produit un calendrier
     visuellement cassé (aucun numéro de jour visible, seulement des points), sans la moindre erreur
     de build/typecheck : le bug n'existe qu'au rendu réel. Système de dates
     `@internationalized/date` (`CalendarDate`) à convertir à chaque frontière avec le reste
     d'`apps/web` (`date-fns`/ISO partout ailleurs). En échange, un vrai avantage confirmé en
     interaction : `isDateUnavailable(date, anchorDate)` désactive nativement, dès le clic sur la
     date de départ, toute date dont la sélection formerait une plage traversant une nuit
     indisponible (testé : ancre au 19 août, nuit du 22 fermée → tout le 22 août et au-delà devient
     non cliquable) — une garantie que `react-day-picker` n'offre pas nativement.
   - **Décision** : garder `react-day-picker`, étendre en `mode="range"`. L'avantage réel de
     `RangeCalendar` (blocage proactif au clic) est un confort, pas une garantie de correction —
     la seule barrière qui compte reste `create_order`/le futur verrou de capacité serveur, jamais
     l'affichage. Le coût de bascule (assemblage compound complet à écrire, conversion
     `@internationalized/date` à propager, perte des acquis `data-date` e2e déjà en place) n'achète
     donc pas une garantie supplémentaire réelle, seulement un déplacement de complexité vers le
     composant plutôt que vers la validation applicative — qui doit de toute façon exister
     côté serveur. Reste un point d'attention pour l'implémentation Tranche 2 (pas un blocage) :
     porter une détection « nuit fermée dans la plage en cours de sélection » côté client, en
     s'inspirant du comportement HeroUI observé plutôt qu'en se contentant d'un avertissement
     après coup une fois la plage validée.

7. **Dérogation reflow mobile de `SimpleTable` pour la grille chambres×dates : confirmée, retenue.**
   Deux rendus de la même donnée (5 chambres × 7 puis × 14 dates) montés et capturés à 375px de
   large :
   - Reflow par défaut (non modifié) : chaque chambre devient une pile de 7-14 cartes
     « date : cupo(s) », l'axe colonne (date) disparaît entièrement — confirmé inutilisable pour
     une matrice, exactement l'hypothèse du §3bis.
   - Dérogation (dans `SimpleTable`/`SimpleTableHeader`/`SimpleTableBody`/`SimpleTableRow`/
     `SimpleTableCell` : classes `className` qui rétablissent `table`/`table-row`/`table-cell` sous
     `md` + première colonne `sticky left-0`, sans forker le composant ni toucher son comportement
     par défaut pour ses deux autres usages actuels, `CommissionsTable`/`ReservationsTable`, qui
     gardent le reflow cartes intact) : rendu en grille compacte et lisible à 375px, testé jusqu'à
     14 colonnes — le conteneur bascule alors en scroll horizontal (`overflow-x-auto`, déjà présent
     dans `SimpleTable`) et la colonne « Chambre » reste effectivement figée pendant le défilement
     (vérifié en scrollant programmatiquement le conteneur).
   - **Décision** : dérogation validée pour l'écran grille chambres×dates de la Tranche 2
     uniquement — à poser comme `className` locaux sur les primitives `SimpleTable*` existantes au
     moment de construire cet écran, jamais comme un changement du comportement par défaut du
     composant partagé.

**Tranchées en écrivant le code de la Tranche 2 (2026-08-17)** — décisions de conception non
figées par le brouillon initial de cette spec, documentées ici plutôt que devinées silencieusement :

8. **Sémantique de `resolve_date_price` : `stay_rates` MODIFIE le prix déjà résolu (palier/base),
   ne le REMPLACE jamais.** La chaîne « override date > stay_rates > price_tiers > prix de base »
   (§10 point 5) ne peut se lire comme une simple substitution en cascade : `stay_rates` (cf.
   `apps/admin/lib/products/stayRates.ts`) est un **pourcentage de majoration** (saison/week-end),
   structurellement incapable de tenir lieu de prix absolu. Implémenté comme :
   `resolve_date_price(entité, date, prix_déjà_résolu_par_palier)` → si un override existe pour
   cette date exacte, il gagne intégralement (ignore tout le reste) ; sinon le prix par palier/base
   transmis par l'appelant est majoré du pourcentage saison + week-end applicables à cette date
   précise (cumulatifs, pas exclusifs l'un de l'autre).
9. ~~`modify_order_line` refuse explicitement toute ligne à plage~~ — **réécrite polymorphe le
   2026-08-17** (`supabase/migrations/20260817220400_modify_order_line_range_support.sql`),
   annoncée comme travail futur au point ci-dessus, désormais faite. Signature étendue d'un 5e
   paramètre `p_new_end_date date default null` (rétrocompatible — `create or replace` ne peut pas
   changer la forme d'une liste d'arguments, un `drop function` explicite précède la recréation
   pour ne jamais laisser deux overloads ambigus). Gère les 3 formes de ligne : date unique
   (branche historique **inchangée au mot près**, les 26 assertions pgTAP d'origine restent vertes
   sans modification), chambre par plage, alojamiento par plage. Le delta de capacité par nuit
   généralise le `v_same_slot`/`effective_booked` déjà en place pour la date unique : chaque nuit
   commune à l'ancien ET au nouvel intervalle reçoit un seul `update` portant le delta net
   (nouvelle qty − ancienne qty), jamais une libération suivie d'une consommation séparées qui la
   compterait de travers. Prix re-résolu nuit par nuit via `resolve_date_price`/`resolve_tier_price`,
   même patron que `create_order`. Écran `ModifyOrderLineDialog.tsx` étendu (check-in/check-out
   pour une ligne à plage). 31 nouvelles assertions pgTAP (`modify_order_line.test.sql`, 57 au
   total), e2e dédié (`admin-modify-room-range-order-line.spec.ts`).
10. **Garde-fou `capacity_exceeds_physical` ajouté à `set_room_type_availability`** (absent du
    patron `set_product_availability` dont cette RPC s'inspire) : la capacité physique réelle d'une
    chambre est connue (`quantity × capacity` pour un dortoir, `quantity` pour une chambre privée,
    cf. point 3 ci-dessus) — refuser une capacité de cupos qui la dépasse évite une survente par
    simple faute de frappe admin, à coût quasi nul puisque l'information est déjà en base.
11. ~~Portée client volontairement bornée à l'hôtel pour cette passe~~ — **fermée le 2026-08-17**.
    `LodgingReservationForm.tsx` (nouvel écran, miroir de `HotelReservationForm.tsx` sans sélecteur
    de chambre — bornes/palier/prix sourcés directement sur `products`, pas un `room_type`) branché
    dans `products/[slug]/page.tsx` via une branche `isLodging` symétrique à `isHotel` ; `type=
    'lodging'` n'utilise donc plus jamais le `ReservationForm.tsx` générique (resté strictement
    inchangé, toujours seul chemin pour activité/transport). Aucune régression : zéro couverture
    e2e n'existait sur l'ancien chemin date-unique de `lodging` côté client avant ce changement
    (vérifié par grep), donc rien à préserver — nouvel e2e `reserve-lodging-range.spec.ts`.
    Côté admin/socio, `availability-calendar.tsx` (mode `"product"` uniquement, mode `"resource"`
    laissé identique) gère désormais un « Precio especial » par date via `set_date_rate('product',
    ...)`, affiché sur la cellule du calendrier sous le badge cupos/booked (même position que la
    grille chambres) ; nouveau test pgTAP dédié `set_date_rate_product.test.sql` (6 assertions,
    fichier séparé pour ne pas toucher `room_type_and_date_range_booking.test.sql` en parallèle
    d'un autre chantier) et e2e `admin-lodging-date-rate.spec.ts`.

**Gap post-implémentation découvert en production, fermé le 2026-08-18** :

12. **`products.default_capacity` — asymétrie non prévue par cette spec, découverte sur un vrai
    produit (jetski, `type='activity'`) resté invendable après sa création.** Diagnostic : pour
    tout type hors `lodging`/`hotel`, AUCUN champ ne permet de fixer un cupo à la création — la
    capacité n'existe que par date, via `product_availability`, configurable uniquement sur ce
    calendrier. `calendar_default_open` donne déjà un défaut pour l'ouvert/fermé (pas besoin de
    configurer chaque jour) ; rien d'équivalent n'existait pour la capacité, donc même un produit
    « toujours ouvert » restait invendable tant qu'aucune ligne explicite n'avait été posée à la
    main. Aggravé par une confusion utilisateur réelle : `Cantidad mínima/máxima` (borne par
    commande) a été prise pour le cupo réel — ce ne sont pas le même concept, rien dans l'UI ne les
    distinguait.
    Fix : colonne `products.default_capacity` (nullable, symétrique de `calendar_default_open`,
    `supabase/migrations/20260818090000_product_default_capacity.sql`) — tant qu'aucune ligne
    `product_availability` n'existe pour une date, `create_order` et `modify_order_line` (branche
    date unique uniquement — chambre/alojamiento gardent leurs propres modèles déjà explicites) la
    matérialisent désormais (`capacity=default_capacity, booked=0`) juste avant leur verrouillage
    `FOR UPDATE` habituel, jamais après — l'unicité `(product_id, date)` + `ON CONFLICT DO NOTHING`
    ferme la fenêtre de concurrence entre deux premières réservations simultanées d'un jour jamais
    configuré (validé par un test de concurrence dédié, 5 runs propres, N=20). Un override admin
    explicite n'est jamais écrasé (`ON CONFLICT DO NOTHING`, testé). Champ UI ajouté (« Cupo diario
    por defecto », activity/camp/transport uniquement, avec un texte distinguant explicitement ce
    champ de `Cantidad mínima/máxima`) et branché dans les DEUX parcours de création/édition
    (admin-direct et proposition socio — `create_product_from_proposal`/
    `submit_product_creation_proposal`/`submit_product_proposal`/`moderate_product_proposal`,
    `supabase/migrations/20260818093000_product_default_capacity_proposal_parity.sql`). Calendrier
    admin/socio (`availability-calendar.tsx`) : nouveau badge « Por defecto : N » distinct de
    « Sin configurar », priorité `closed > configured > default > unconfigured` — un override
    explicite n'est jamais masqué par le badge par défaut.
    **Découverte annexe en investiguant ce produit précis, pas un nouveau fait** (déjà documenté en
    §1 « Ce que fait la v2 hifago aujourd'hui ») : ce même jetski portait aussi une règle
    `product_slot_rules` (créneaux 9h-17h/1h, capacité 10) configurée de bonne foi par Jérôme à la
    création, en croyant que c'était LE mécanisme de cupo — confirmé purement décoratif, jamais lu
    par `create_order` ni affiché côté client. Question posée à Jérôme : approximer avec un cupo
    par JOUR (sans notion d'heure) en attendant la Tranche 3, ou laisser ce produit invendable
    jusqu'à ce que les créneaux soient réellement réservables ? **Décision explicite : attendre.**
    Le jetski reste donc volontairement sans `default_capacity` configuré — première demande
    concrète, côté produit réel, motivant de prioriser la Tranche 3 plutôt qu'un signal seulement
    théorique.

## 11. Annexe — traçabilité code→règle

| Section | Fichiers sources |
|---|---|
| §1 v1 legacy | `src/services/inventoryService.js`, `src/services/orderService.js`, `docs/2-reference/{02-app-partner,03-app-admin,04-app-reservar,05-data-model,08-known-gaps}.md` |
| §1 bug price_cop | `apps/admin/app/admin/products/[id]/edit/page.tsx`, `apps/admin/app/admin/products/[id]/availability/page.tsx`, `apps/web/app/[locale]/products/[slug]/page.tsx`, `supabase/migrations/20260815240000_create_order_qty_bounds_and_tiers.sql`, `supabase/migrations/20260814180000_order_lines_commission_snapshot.sql` |
| §3 décisions cadrage | `hifago/docs/00-modele-de-donnees.md` §1/§4c/§5, `hifago/docs/05-reference-technique.md` §1bis, `hifago/docs/04-architecture-cible.md` (clauses de révision calendrier) |
| §3bis tech calendrier | `apps/admin/components/availability-calendar.tsx`, `packages/ui/src/components/legacy-calendar.tsx`, `packages/ui/src/index.ts`, `node_modules/@heroui/react/dist/components/{calendar,range-calendar}`, `node_modules/react-stately/dist/types/src/calendar/types.d.ts` |
| §0 Tranche 1 | `docs/2-reference/02-app-partner.md` (Mis Reservas), `apps/admin/lib/lists/filters.ts`, `apps/admin/app/admin/orders/{page.tsx,OrdersTable.tsx,ChangeStatusDialog.tsx}`, `supabase/migrations/20260814161500_cancel_order_rpc.sql`, `supabase/migrations/20260814210000_pms_reconciliation_entries.sql` |
| §0 Tranche 2 | `supabase/migrations/20260816110000_product_hotel_rooms.sql`, `20260816130000_room_media_and_room_stay_rates.sql`, `docs/specs/13-admin-hotel-habitaciones.md` §10, `docs/00-modele-de-donnees.md` §1/§2 |

## 12. Documents liés

`hifago/docs/00-modele-de-donnees.md`, `hifago/docs/05-reference-technique.md`,
`hifago/docs/04-architecture-cible.md`, `hifago/docs/01-cahier-des-charges-client.md` §3d/§7,
`hifago/docs/02-cahier-des-charges-socio.md` §3d, `hifago/docs/03-cahier-des-charges-admin.md` §3c,
`docs/specs/08-admin-gestion-activite.md`, `docs/specs/11-admin-activite-parcours-unifie-creneaux.md`,
`docs/specs/12-admin-alojamiento-house.md`, `docs/specs/13-admin-hotel-habitaciones.md`,
`docs/specs/14-admin-transporte.md`.
