---
id: specs-admin-transporte
titre: "Admin : active products.type='transport' dans le parcours produit — lieu + tags + prix par tramos de capacité de véhicule, réutilisation intégrale du ProductForm unifié"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-09-16
resume: >
  Active le type de produit `transport`, autorisé par le CHECK constraint depuis la toute première
  migration catalogue mais jamais exposé à un écran admin. Réutilise le parcours ProductForm
  unifié (spec 11/12/13) sans aucune divergence de mécanisme : lieu optionnel (point de départ),
  tags, prix simple ou par tramos de capacité de véhicule (remplace les fiches produit séparées
  « hasta 4/7 pers. » de la V1 par des tramos d'un même produit), bornes de quantité. Pas de
  check-in/check-out ni de capacité produit (schedule='date' en V1, aucun cupo interne — le
  transporteur dispatche son propre parc). Aucune migration, aucune nouvelle RPC, aucun changement
  côté apps/web (portail déjà générique pour tout type hors evento). Admin seulement — pas de
  reconstruction de la « carte transport multi-transporteurs » groupée de la V1, décision explicite
  de Jérôme.
mots_cles: [admin, transport, transporte, traslado, price_tiers, product-form, provider,
  establishment, hifago]
repond_a:
  - "Comment l'admin crée-t-il et édite-t-il un trajet de transport (traslado) ?"
  - "Pourquoi un transport n'a-t-il ni check-in/check-out ni capacité produit ?"
  - "Comment modéliser « hasta 4 pers. »/« hasta 7 pers. » pour un trajet de transport ?"
  - "La carte transport multi-transporteurs de la V1 existe-t-elle côté hifago ?"
---

> **Amendement daté du 2026-08-27 — l'étage hôtel a été supprimé.** `products.type='hotel'`,
> `product_room_types`, `room_media`, `room_type_availability`, `room_type_date_rates`,
> `order_lines.room_type_id` et `set_room_type_availability` n'existent plus (T3 de la spec 24 :
> application par le commit 38c1b55, base par la migration `20260827220000`). Une chambre est
> désormais un produit `type='lodging'` à part entière. **Toute mention de `room_type`,
> `product_room_types` ou d'une « branche chambre » ci-dessous décrit un état passé** ; le mécanisme
> équivalent vit sur `products`/`product_availability`. Détail et raisons : `docs/specs/24-modele-
> hebergement-et-surface-lobbypms.md` §4, et le bandeau de `docs/specs/13-admin-hotel-habitaciones.md`.

> **Amendement daté du 2026-09-16 — le transport porte désormais des horaires et DEUX lieux
> structurés.** Trois affirmations de cette spec sont révoquées à la demande de Jérôme :
>
> 1. **« Toute donnée d'horaires structurée » n'est plus hors périmètre** (§2 Out). Un transport
>    porte une **fenêtre de départs quotidienne** — `transport_first_departure_time` /
>    `transport_last_departure_time` — et un nombre de **places annoncées par départ**
>    (`transport_seats_per_departure`). ⚠️ **Ces trois champs sont PUREMENT INFORMATIFS** : ils ne
>    sont lus par aucune RPC, ne décrémentent rien, et ne rendent pas le transport réservable à
>    l'heure. Ce ne sont surtout **pas** des `product_slot_rules`, qui rendraient `create_order`
>    bloquant (refus `slot_required`, `docs/specs/18` §0). Le cupo réel d'un transport reste
>    `products.default_capacity`, par date.
> 2. **« Aucune migration » est faux** (§0 Modèle de données). La migration
>    `20260916*_transport_departure_info.sql` ajoute 9 colonnes à `products` et 6 CHECK de portée.
> 3. **Le « lieu (point de départ) » n'est plus `products.address`/`lat`/`lon`** (§2 In, §4 pt 3).
>    Le transport a désormais deux lieux dédiés et symétriques — `transport_departure_address`/
>    `_lat`/`_lon` et `transport_arrival_address`/`_lat`/`_lon` — saisis par le même widget Google
>    Places, et le trio générique n'est plus exposé ni utilisé pour ce type (migration de données
>    incluse). Raison : un trajet a deux extrémités, et une seule convention de nommage pour un
>    seul concept.
>
> **Ancrage legacy** (« refaire pas réinventer ») : ces informations existaient déjà en production,
> mais **figées dans le code** — `public/reservar.js:176` du dépôt parent porte `transport_info_html`
> (« salidas … desde el Parque de El Poblado o la Carrera 70 (Laureles) a las 7:00 y 7:45 »), avec
> son miroir lecture seule assumé dans `public/admin.html:755`. Ce lot les sort du code pour les
> rendre éditables depuis le backoffice, et les affiche sur la fiche produit de la vitrine.
> **Amendement daté du 2026-09-17 — un transport ne se réserve plus en ligne, il se CONTACTE.**
> Demande Jérôme : « normalement il faut juste son num de tel pour contacter », puis « non
> obligatoire le num et sinon c'est celui de hifago ». Deux affirmations de plus sont révoquées :
>
> 1. **§2 In « Un trajet de transport devient un produit vendable normal, visible sur le portail
>    public via le mécanisme générique » est FAUX depuis ce lot.** La fiche d'un transport n'affiche
>    plus ni calendrier ni panier : elle affiche un bouton de contact WhatsApp. La colonne
>    `transport_contact_phone` (E.164, **optionnelle**) porte le numéro du transporteur ; laissée
>    vide, la fiche retombe sur le WhatsApp de Hifago. C'est ce repli qui rend la règle vraie sans
>    exception : `resolverUrlContacto()` (`apps/web/lib/catalog/producto.ts`) garantit qu'un
>    transport a toujours une URL de contact, donc que `resolverModoReserva` le classe toujours en
>    `"vitrina"` — **sans qu'aucune règle ne bifurque sur `products.type`**, la bifurcation par la
>    FORME restant le principe du projet. Priorité : URL propre du transporteur > son WhatsApp >
>    celui de Hifago.
> 2. **§0 « pas de capacité produit » redevient VRAI, après avoir été contredit par les mocks.**
>    `default_capacity` n'est plus exposé pour ce type et les valeurs posées par mockData (40, 20,
>    4, 7) sont vidées : sans calendrier, aucune ligne de `product_availability` n'est matérialisée,
>    le champ serait inerte tout en faisant croire à un plafond. La capacité de véhicule vit
>    désormais dans `transport_seats_per_departure`, qui est **affichée** (« 40 plazas por salida »)
>    et ne bloque rien.
>
> Migration : `20260917100000_transport_contact_phone.sql`. Garantie prouvée par
> `apps/web/lib/catalog/producto.test.ts` (« un transport n'a JAMAIS de calendrier »), pas seulement
> écrite.

> Ce qui **reste** hors périmètre : la carte transport multi-transporteurs groupée, l'affichage sur
> les cartes de résultats de l'accueil (tranché par Jérôme le 2026-09-16 : « ces infos doivent être
> dans la fiche du produit »), et un service de nuit à cheval sur minuit (`last >= first`).

# Admin : activer `type='transport'` dans le parcours produit

> **Cible stack** : Hifago uniquement (`hifago/apps/admin`). Suite directe de
> [`11-admin-activite-parcours-unifie-creneaux.md`](11-admin-activite-parcours-unifie-creneaux.md)
> (parcours `ProductForm` unifié réutilisé tel quel), sur le même modèle que
> [`12-admin-alojamiento-house.md`](12-admin-alojamiento-house.md) et
> [`13-admin-hotel-habitaciones.md`](13-admin-hotel-habitaciones.md). **Implémentée le
> 2026-08-16**, à la demande de Jérôme, après vérification de la V1 legacy
> (`src/services/migrations/001_init.sql`, `src/services/catalogService.js`,
> `scripts/seed_gotravel_transport.js`) — cf. §1.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** | implémenté |
| 1 | Contexte et problème | implémenté |
| 2 | Portée | implémenté |
| 3 | Décisions retenues | implémenté |
| 4 | Parcours cible | implémenté |
| 5 | Écran(s) | implémenté |
| 6-9 | *(fusionnées dans 0)* | — |
| 10 | Décisions tranchées / points ouverts | implémenté |
| 11 | Annexe — traçabilité code→règle | implémenté |
| 12 | Documents liés | implémenté |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Endpoints / RPC

Aucune RPC nouvelle, aucune modification de `create_order` : sa seule branche par type distingue
`lodging` (nuitées) et `camp` (ressource partagée) ; transport tombe dans la branche générique
`else` (bornes `min_qty`/`max_qty`, résolution de prix par `price_tiers`, verrou
`product_availability(product_id, date)`) — exactement le modèle `schedule='date'` de la V1, sans
aucun changement. Toutes les écritures admin restent RLS-directe (données définitionnelles, aucun
des 4 critères RPC-only de `hifago/CLAUDE.md` §3.1 ne s'applique).

### Modèle de données (delta)

**Aucune migration.** `products.type` accepte `'transport'` depuis la toute première migration
catalogue (`20260813190232_catalog_core_tables.sql`), jamais retiré dans les extensions
suivantes du CHECK (dernière version en vigueur :
`20260816110000_product_hotel_rooms.sql`). `products_price_cop_required_unless_evento`
n'exempte pas `transport` — comportement voulu, un trajet a un vrai prix (comme une activité).
`products.establishment_id not null` s'applique à transport comme à tout autre type : un
transporteur (Aeroturex, Gotravel en V1) devient un partner + establishment hifago comme n'importe
quel socio — même précédent déjà établi pour `evento`/`camp`, aussi peu « un lieu physique ».
Toutes les colonnes utilisées (`address`/`lat`/`lon`, `price_cop`/`price_tiers`, `min_qty`/`max_qty`)
existent déjà et sont déjà génériques.

### Invariants

- Le parcours de création/édition d'un transport est le **même composant** `ProductForm` que
  l'activité/l'alojamiento/l'hôtel — aucune divergence de mécanisme, aucun nouveau state, aucune
  nouvelle validation.
- **Pas de sous-produit** : contrairement à l'hôtel (`product_room_types`), un trajet de transport
  est une ligne de produit plate — exactement le modèle V1 (un trajet/tarif = une fiche produit
  distincte), simplifié par un seul mécanisme de tramos au lieu de fiches séparées par capacité.
- **Pas de check-in/check-out, pas de capacité produit, pas de `stay_rates`** — `schedule='date'`
  en V1 (pas de créneaux horaires structurés), `capacity_default=NULL` en V1 (« le transporteur
  dispatche son propre parc », même absence que pour une activité qui n'a pas non plus de capacité
  produit dédiée).
- **Prix par tramos de capacité de véhicule** remplace le modèle V1 de fiches séparées : « hasta 4
  pers. »/« hasta 7 pers. » deviennent deux tramos (`price_tiers`) d'un même produit plutôt que
  deux produits distincts — simplification permise par un outillage que la V1 n'avait pas au moment
  où le transport y a été construit (spec 08/11 avaient déjà généralisé `price_tiers`).
- **Aucun changement côté `apps/web`** : la fiche produit générique
  (`apps/web/app/[locale]/(vitrine)/productos/[slug]/page.tsx`) ne branche que sur `isEvento` — tout le reste,
  transport y compris, tombe déjà dans le rendu générique (`ReservationForm` + `price_cop`/
  `product_availability`). L'accueil (`apps/web/app/[locale]/(vitrine)/page.tsx`) liste déjà tous les
  produits `sellable=true` en vrac, sans distinction de type.

### Cas limites

- Aucun cas limite nouveau au-delà de ceux déjà couverts par le prix par tramos/bornes de quantité
  (spec 08) — transport ne fait qu'activer des mécanismes déjà validés, sans ajouter de règle.

### Fichiers touchés

Créés : `apps/admin/e2e/admin-product-transport.spec.ts`,
`docs/specs/14-admin-transporte.md` (ce document).
Modifiés : `apps/admin/components/product-form.tsx` (type union, flag `isTransport`, gating
`hasLocationAndTags`/`hasPriceQtyFields`, option du sélecteur `Tipo`, textes d'erreur/bouton),
`apps/admin/app/admin/products/[id]/edit/page.tsx` (flag local, titre contextuel),
`docs/specs/README.md`, `docs/00-modele-de-donnees.md`.
Détail complet et traçabilité : §11.

---

## 1. Contexte et problème

Jérôme veut pouvoir créer/éditer un trajet de transport (traslado) avec le même parcours admin
qu'une activité/un alojamiento/un hôtel — aucune nouvelle mécanique demandée, juste l'activation
d'un type déjà envisagé par le schéma.

**Découverte de recherche clé** — `products.type` accepte déjà `'transport'` depuis la toute
première migration catalogue (`20260813190232_catalog_core_tables.sql`), jamais retiré des
extensions suivantes du CHECK. `apps/admin/lib/lists/filters.ts` liste déjà `transport` comme
valeur de filtre sur `/admin/products`, sans qu'aucun produit de ce type n'ait jamais pu être créé
depuis l'écran (le `<Select data-testid="type-select">` de `ProductForm` n'exposait que 5 des 7
valeurs autorisées en base).

**Vérification V1 (« refaire pas réinventer », [[hifago_rebuild_not_reinvent]])** — `transport` y
est un type de produit générique, **pas une entité dédiée** :
`src/services/migrations/001_init.sql` définit `products` avec un unique `CHECK(type IN
('lodging','activity','transport','tour'))`, sans table `trajets`/`horaires`/`routes` séparée.
Chaque trajet/tarif est une **ligne de produit distincte**, rattachée à un `provider_id`
(transporteur — Aeroturex, Gotravel) : `scripts/seed_gotravel_transport.js` crée 4 fiches
distinctes pour 4 tarifs (« Privado aeropuerto ↔ Guatapé · hasta 4 pers. » à 210 000 COP, « …
hasta 7 pers. » à 362 000 COP, et l'équivalent pour Medellín porte-à-porte à 326 000/507 000 COP —
prix **par trajet et par véhicule, pas par passager**). Champs V1 systématiquement absents ou
constants pour `type='transport'` : `category` (jamais rempli, réservé à `activity`),
`capacity_default` (toujours `NULL`), `schedule` (toujours `'date'`, jamais `'slot'`), `unit`
(non pertinent, pensé pour `lodging`). Aucune donnée d'horaires structurée en base — les horaires
Aeroturex sont un texte figé côté client (`transport_info_html`), hors périmètre admin.
`lobby_product_id`/`lobby_category_id` : lien historique avec un seul produit legacy (Aeroturex,
ex-produit Lobby `565423`), **sorti** de Lobby (backlog V1 item C2) — le transport est aujourd'hui
entièrement interne, aucun lien LobbyPMS, contrairement à `lodging`/`hotel`.

La V1 a aussi une « carte transport multi-transporteurs » côté portail client
(`public/reservar.js`, `renderTransport`) qui regroupe dynamiquement les fiches par
`provider_name` avec un brouillon cumulable avant validation — une fonctionnalité en soi, distincte
de l'activation admin du type.

## 2. Portée

**In** :
- Nouveau type `transport` (« Transporte ») dans le sélecteur `Tipo` de `ProductForm`, même point
  d'entrée que les autres types (lien « + Actividad » existant, aucun nouveau lien/écran).
- Réutilisation intégrale du parcours activité/alojamiento/hôtel : nom/description i18n, lieu
  optionnel (point de départ), photos dès la création, tags, prix simple ou par tramos de capacité
  de véhicule, bornes min/max de quantité.
- Un trajet de transport devient un produit vendable normal, visible sur le portail public via le
  mécanisme générique déjà en place (accueil + fiche produit), sans aucune adaptation côté
  `apps/web`.

**Out, explicitement hors périmètre (décision Jérôme)** :
- La « carte transport multi-transporteurs » groupée par transporteur côté `apps/web` — le portail
  reste la liste plate/générique déjà existante, sans regroupement par établissement ni brouillon
  cumulable. À traiter comme une spec à part si un jour voulue.
- Toute donnée d'horaires structurée (la V1 n'en avait pas non plus pour transport).
- ~~Toute réintégration LobbyPMS pour transport — déjà découplé en V1 (backlog C2), aucune
  régression à réintroduire.~~ **Amendé le 2026-08-26** : un transport peut désormais être rattaché
  à un *service* LobbyPMS (`products.lobby_product_id`), au même titre qu'une activité — migration
  `20260826110000_product_creation_proposal_lobby_transport.sql` et
  `apps/web/app/api/pms/reserve-nights/route.ts`. Ce n'est pas la « réintégration » écartée ici
  (qui visait la disponibilité et le prix) : le transport reste piloté par hifago de bout en bout,
  seul le reflet de la consommation sur le booking de l'hôte est ajouté. Cf.
  [`24-modele-hebergement-et-surface-lobbypms.md`](24-modele-hebergement-et-surface-lobbypms.md).
- Check-in/check-out, capacité produit, `stay_rates` — non pertinents pour ce type (cf. §0
  invariants), non exposés.

## 3. Décisions retenues

- **Aucune migration, aucune nouvelle RPC** — le CHECK constraint autorise déjà `'transport'`
  depuis la toute première migration ; `create_order` couvre déjà transport via sa branche
  générique. C'est une pure activation UI côté `ProductForm`.
- **Prix par tramos de capacité plutôt que fiches produit séparées** — la V1 modélisait « hasta 4
  pers. »/« hasta 7 pers. » comme deux produits distincts, faute d'outillage de tramos au moment de
  sa construction. Hifago a déjà généralisé `price_tiers` (spec 08/11) : un trajet à plusieurs
  paliers de capacité devient un seul produit à plusieurs tramos, cohérent avec l'usage déjà fait
  pour l'alojamiento/l'hôtel. Rien n'empêche un admin de créer malgré tout deux produits séparés
  s'il préfère répliquer l'organisation V1 — les deux options restent disponibles, aucune n'est
  imposée par le schéma.
- **Pas de capacité produit ni de check-in/check-out** — fidèle à la V1 (`capacity_default=NULL`,
  `schedule='date'`), et cohérent avec `isActivity` qui n'a pas non plus de capacité produit dédiée.
- **`hasLocationAndTags`/`hasPriceQtyFields` étendus à `isTransport`**, `hasCheckInOut` inchangé
  (`isLodging || isHotel` seulement) — transport rejoint exactement le même groupe que l'activité
  pour ces deux flags, sans toucher au troisième.
- **Établissement obligatoire pour un transporteur** — même précédent déjà établi avec
  `evento`/`camp` (`products.establishment_id not null` pour tous les types) : un transporteur
  devient un partner + establishment hifago comme n'importe quel socio, aucune dérogation de schéma.
- **Pas de reconstruction de la carte groupée multi-transporteurs** — décision explicite de Jérôme
  en cours de session (scope admin seulement), le portail public minimal déjà en place (accueil en
  vrac, fiche produit générique) suffit pour cette tranche.

## 4. Parcours cible

1. L'admin ouvre `/admin/products/new` depuis le lien « + Actividad » d'un établissement
   représentant le transporteur, bascule le sélecteur `Tipo` sur « Transporte ».
2. Il saisit le nom (ES/EN) — ex. « Privado aeropuerto ↔ Guatapé · hasta 4 pers. » — et la
   description (ES/EN, optionnelle) via `LocalizedTextField`, identique à l'activité.
3. Il renseigne optionnellement un lieu (point de départ), des photos, des tags — identique à
   l'activité.
4. Il définit le prix : simple, ou par tramos de capacité de véhicule (ex. 1-4 pers. à 210 000 COP,
   5-7 pers. à 362 000 COP) et les bornes min/max de quantité — mécanisme réutilisé tel quel.
5. Un seul clic sur « Crear transporte » : le produit est créé (`sellable=false` par défaut, même
   garde-fou que les autres types).
6. Redirection vers `/admin/establishments`. L'admin peut ensuite éditer le même transport depuis
   `/admin/products/[id]/edit` — tous les champs dans le même composant `ProductForm`, sans bloc
   séparé (pas de sous-produit, contrairement à l'hôtel).
7. Une fois publié (`sellable=true`), le trajet apparaît sur le portail public via le mécanisme
   générique déjà en place — sans regroupement par transporteur.

## 5. Écran(s)

- **`/admin/products/new`** et **`/admin/products/[id]/edit`** — même composant `ProductForm` que
  l'activité/l'alojamiento/l'hôtel (specs 11/12/13), section lieu/tags/prix gated
  `hasLocationAndTags`/`hasPriceQtyFields`, désormais incluant `isTransport`. Aucune section
  nouvelle, aucun composant nouveau.
- Titre d'édition contextuel « Editar transporte » (`apps/admin/app/admin/products/[id]/edit/page.tsx`),
  même précédent que « Editar alojamiento »/« Editar hotel ».

---

## 10. Décisions tranchées / points ouverts

- **Carte transport multi-transporteurs groupée** — explicitement hors périmètre de cette tranche
  (décision Jérôme). Si un jour voulue, nécessiterait d'exposer publiquement le nom de
  l'établissement/transporteur (aujourd'hui non lu par la fiche produit générique) et une nouvelle
  UI côté `apps/web` avec un mécanisme de brouillon cumulable — une spec à part entière.
- **Deux tramos vs deux produits séparés pour les paliers de capacité** — le choix est laissé à
  l'admin au moment de la création, les deux options restent possibles avec le schéma actuel (cf.
  §3). Pas de règle imposée.
- **`apps/admin/lib/lists/filters.ts` — trou `'hotel'` manquant** dans `PRODUCT_TYPES` (constaté en
  vérifiant que `'transport'` y figurait déjà) : réel mais sans rapport avec cette tâche, signalé à
  Jérôme, pas corrigé ici (un changement = un sujet, même discipline que les specs précédentes).

## 11. Annexe — traçabilité code→règle

| Section | Fichiers sources |
|---|---|
| §1 Contexte, vérification V1 | `src/services/migrations/001_init.sql`, `src/services/catalogService.js`, `scripts/seed_gotravel_transport.js`, `public/reservar.js` (racine legacy) ; `docs/2-reference/04-app-reservar.md`, `docs/4-pilotage/backlog.md` (items B2/C2) |
| §0 `type='transport'` déjà en base | `hifago/supabase/migrations/20260813190232_catalog_core_tables.sql` ; branche générique de `create_order` (ex. `20260815240000_create_order_qty_bounds_and_tiers.sql`) ; `apps/admin/lib/lists/filters.ts` |
| §0 `apps/web` déjà générique | `apps/web/app/[locale]/products/[slug]/page.tsx`, `apps/web/app/[locale]/page.tsx` |
| §3 Réutilisation `price_tiers`/`min_qty`/`max_qty` | `apps/admin/lib/products/priceTiers.ts` (spec 08, inchangé) |
| §3 `establishment_id not null` pour tout type | `hifago/supabase/migrations/20260813231500_products_establishment_id.sql` |

## 12. Documents liés

- [`11-admin-activite-parcours-unifie-creneaux.md`](11-admin-activite-parcours-unifie-creneaux.md) —
  parcours `ProductForm` unifié réutilisé tel quel.
- [`12-admin-alojamiento-house.md`](12-admin-alojamiento-house.md),
  [`13-admin-hotel-habitaciones.md`](13-admin-hotel-habitaciones.md) — mêmes patrons d'activation
  de type, gabarit direct de cette spec.
- `hifago/docs/00-modele-de-donnees.md` §3 — audit champ par champ mis à jour par cette spec.
