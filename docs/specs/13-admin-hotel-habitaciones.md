---
id: specs-admin-hotel-habitaciones
titre: "Admin : active products.type='hotel' — un hôtel a plusieurs sous-produits qui sont des chambres, chacune avec son propre prix/capacité"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: supprimee
remplace_par: [24]
reste: >
  Supprimée le 2026-08-27 (T3 de la spec 24) — l'étage hôtel n'existe plus, ni en code ni en base.
  Ce document reste comme archive de ce qui a été construit et de pourquoi il a été défait.
maj: 2026-08-27
resume: >
  Active un nouveau type de produit `hotel` : photos/description/lieu/check-in/check-out réutilisés
  du parcours ProductForm (specs 08/11/12), mais le prix ne vit pas sur l'hôtel — il vit sur ses
  chambres. Nouvelle table enfant product_room_types (même patron que product_slot_rules) : chaque
  chambre a son propre price_cop/price_tiers/min_qty/max_qty (mécanisme de la spec 12 réutilisé tel
  quel), son propre nom/description i18n, sa capacité, un type (dortoir/chambre privée), ses propres
  photos (room_media, add_catalog_media/reorder_gallery étendus à 'room_type') et son propre prix par
  période (stay_rates, StayRatesEditor de la spec 12 réutilisé tel quel). L'édition des chambres est
  passée d'un delete-all-reinsert à un upsert par id stable — nécessaire pour ne pas effacer en
  cascade les photos d'une chambre à chaque sauvegarde. Aucun précédent V1 non-PMS — terrain vierge,
  alignement volontaire sur la forme de GET /api/v1/rooms LobbyPMS (quantity, descriptions[],
  photos[]) pour anticiper une Tranche 2 sans redesign. Définition admin seulement, aucune chambre
  n'est orderable via create_order dans cette tranche.
mots_cles: [admin, hotel, habitaciones, chambres, product_room_types, room_media, dormitorio,
  privada, lobbypms, price_tiers, stay_rates, hifago]
repond_a:
  - "Comment l'admin crée-t-il un hôtel avec plusieurs types de chambres ?"
  - "Comment le prix d'une chambre (dortoir/chambre privée) est-il défini ?"
  - "Comment ajouter des photos ou un prix par période à une chambre précise ?"
  - "Pourquoi products.price_cop est-il null pour un hôtel ?"
  - "Comment ce modèle se rattachera-t-il un jour à LobbyPMS ?"
---

> ## ⛔ Cette spec décrit une fonctionnalité SUPPRIMÉE
>
> `products.type='hotel'`, `product_room_types`, `room_media`, `room_type_availability` et
> `room_type_date_rates` **n'existent plus**. Retirés en deux temps le 2026-08-27 : l'application
> par le commit 38c1b55 (T3 étape 1), la base par la migration `20260827220000` (T3 étape 2).
>
> **Pourquoi.** Ce troisième étage — produit → chambre → nuit — n'existait ni chez LobbyPMS (un
> jeton = une propriété, puis directement des catégories de chambres) ni dans la v1 en production
> (`src/config/properties.js` : les produits `lodging` sont « des TYPES DE COUCHAGE à l'intérieur
> d'une propriété »). Il dupliquait intégralement la branche produit — capacité, prix par date,
> médias, `price_tiers`, `stay_rates`, une branche entière de `create_order`, un écran de
> disponibilité — pour zéro hôtel réel : la préprod comme la production n'ont jamais compté un seul
> produit de ce type. L'hôtel est désormais l'**établissement** (page publique `/establishments/
> [slug]`, spec 24 T1), et chaque chambre un produit `lodging` avec son `lodging_kind`.
>
> **Ce qui reste vrai dans ce document** : le raisonnement produit sur ce qu'une chambre doit
> porter (nom, description, capacité, quantité, prix, paliers, photos, tarifs saisonniers). Tout
> cela vit maintenant sur `products`. **Ce qui est faux** : chaque nom de table, de colonne, de
> RPC et d'écran cité ci-dessous.

# Admin : activer `type='hotel'` — un hôtel a plusieurs chambres

> **Cible stack** : Hifago uniquement (`hifago/apps/admin`). Suite directe de
> [`12-admin-alojamiento-house.md`](12-admin-alojamiento-house.md) (parcours `ProductForm` réutilisé,
> check-in/check-out réutilisés tels quels) et de
> [`11-admin-activite-parcours-unifie-creneaux.md`](11-admin-activite-parcours-unifie-creneaux.md)
> (patron de table enfant `product_id references products(id) on delete cascade`, repris à
> l'identique pour `product_room_types`). **Implémentée le 2026-08-16**, à la demande de Jérôme,
> après vérification de la V1 legacy (`src/config/properties.js`, `src/services/inventoryService.js`)
> et une passe d'alignement sur la forme réelle des données LobbyPMS (`docs/3-integrations/
> lobby_pms_api.md`) — cf. §1.

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

Aucune RPC nouvelle — `add_catalog_media`/`reorder_gallery` (spec 04) **étendues** à un 3e
`p_entity_type = 'room_type'`, même signature exacte, comportement `product`/`establishment`
strictement inchangé. Toutes les écritures restent RLS-directe — aucun des 4 critères RPC-only de
`hifago/CLAUDE.md` §3.1 ne s'applique (données définitionnelles, pas un compteur de capacité
vivant). Une chambre n'est **pas** une ligne `products` : elle n'est donc **pas** orderable via
`create_order` tel qu'il existe aujourd'hui (qui ne connaît que `order_lines.product_id`) — non
modifié par cette spec, cf. §2/§10.

### Modèle de données (delta)

| Table/colonne | Statut | Détail |
|---|---|---|
| `products.type` | contrainte étendue | `products_type_check` accepte désormais `'hotel'` |
| `products.price_cop` | contrainte étendue | `products_price_cop_required_unless_evento` exempte aussi `'hotel'` (prix null, comme `evento`) — le prix vit sur les chambres |
| `products.check_in_time`/`check_out_time` | **réutilisées telles quelles** | déjà ajoutées par la spec 12, aucune nouvelle colonne |
| `product_room_types` | **nouvelle table** | `id uuid pk`, `product_id uuid not null references products(id) on delete cascade`, `kind text not null check (kind in ('dorm','private'))`, `name jsonb not null`, `description jsonb`, `capacity int not null check (capacity > 0)`, `quantity int check (quantity is null or quantity > 0)`, `price_cop bigint not null check (price_cop > 0)`, `price_tiers jsonb`, `min_qty int`, `max_qty int check (min_qty is null or max_qty is null or min_qty <= max_qty)`, `stay_rates jsonb` (même mécanisme que `products.stay_rates`, spec 12), `sort int not null default 0`, `lobby_category_id int`, `lobby_product_id int` (dormantes), `created_at timestamptz not null default now()`. RLS : lecture héritée du produit parent, écriture admin (`is_admin(auth.uid())`) — même patron exact que `product_slot_rules` |
| `room_media` | **nouvelle table** | `id uuid pk`, `room_type_id uuid not null references product_room_types(id) on delete cascade`, `storage_path text not null`, `sort int not null default 0`, `created_at timestamptz not null default now()`. Même patron exact que `product_media`/`establishment_media` (spec 04) |

### Invariants

- Le parcours de création/édition d'un hôtel est le **même composant** `ProductForm` que
  l'activité/l'alojamiento — nom/description i18n, lieu, photos, tags, check-in/check-out :
  identiques, aucune divergence de mécanisme.
- Un hôtel n'a **pas** de prix propre (`products.price_cop` reste `null`, comme `evento`) : le prix
  vit sur chaque chambre (`product_room_types.price_cop`/`price_tiers`), avec le **même mécanisme**
  que l'alojamiento (spec 12) — réutilisé tel quel, pas dupliqué.
- Contrairement aux créneaux d'activité, `check_in_time`/`check_out_time` sont de simples colonnes
  `products` réutilisées de la spec 12 — éditables directement dans les deux modes.
- Les chambres, elles, sont une **table enfant** (comme `product_slot_rules`) : staged en création
  (rattachées au produit dans le même clic de soumission, juste après l'insert de l'hôtel), bloc à
  sauvegarde immédiate séparé (`ProductHotelRoomsBlock`) en édition — **upsert par `id` stable**,
  pas delete-all-reinsert (cf. ci-dessous, invariant ajouté après la livraison initiale).
- **Une chambre a désormais des photos** (`room_media`) : delete-all-reinsert changerait l'`id` de
  TOUTES les chambres à chaque sauvegarde, effaçant leurs photos en cascade même pour une chambre
  non modifiée. `ProductHotelRoomsBlock.handleSave()` fait donc : delete uniquement les chambres
  réellement retirées (id absent du jeu courant), update en place pour une chambre avec `id`
  (jamais touché), insert pour une chambre sans `id` (son id est alors connu immédiatement pour y
  attacher ses photos stagées). Prouvé par `admin-product-hotel.spec.ts` : ajouter/sauvegarder une
  3e chambre ne doit pas effacer la photo de la 1re.
- Une chambre sans `id` (création, ou ajoutée pendant une édition avant le premier « Guardar ») a
  des photos **stagées** (upload immédiat vers Storage, rattachement différé — même pattern que
  `StagedProductPhotos` au niveau produit). Une chambre avec `id` a une galerie **live** (ajout via
  `add_catalog_media`, réordonnancement via `reorder_gallery`, suppression RLS directe — même
  mécanique que `ProductPhotosBlock`). `HotelRoomsEditor` bascule automatiquement de l'un à l'autre
  dès que l'`id` est connu, sans recharger la page.
- Nombre de chambres **illimité** par hôtel, chacune avec un type (`dorm`/`private`) **et** un nom
  libre ES/EN pour la distinguer (confirmé par Jérôme — pas un plafond de 2 lignes fixes).
- `capacity` (personnes par chambre) et `min_qty`/`max_qty` (bornes de commande) sont deux notions
  distinctes qui peuvent diverger, même logique que `products.capacity` vs `max_qty` en spec 12.
- Prix par période d'une chambre : `StayRatesEditor` (spec 12) réutilisé tel quel, une instance par
  chambre — ajout d'un prop `testIdPrefix` (défaut `""`, zéro impact sur l'usage alojamiento
  existant) pour éviter une collision de `data-testid` entre plusieurs instances sur le même écran.

### Cas limites

- Hôtel créé sans aucune chambre → accepté (le tableau de chambres reste optionnel à la saisie),
  mais un hôtel sans chambre n'a rien de vendable — pas bloqué côté formulaire, cohérent avec la
  discipline « définition admin seulement » de cette tranche.
- Nom de chambre laissé vide → repli sur un libellé dérivé du type (« Dormitorio »/« Habitación
  privada »), même discipline que le repli `nameEs` du produit lui-même.
- Échec de l'insert d'une chambre après un insert hôtel réussi → `console.warn`, création déjà
  réussie non annulée, corrigible depuis l'édition (même discipline que photos/tags/créneaux,
  spec 08 §9/spec 11).

### Fichiers touchés

Créés : `apps/admin/lib/products/hotelRooms.ts`, `apps/admin/components/hotel-rooms-editor.tsx`,
`apps/admin/app/admin/products/[id]/edit/ProductHotelRoomsBlock.tsx`,
`apps/admin/components/price-tiers-editor.tsx` (tramos de prix extraits en composant partagé,
réutilisé par produit et par chambre), `apps/admin/lib/products/hotelRooms.test.ts`,
`apps/admin/components/hotel-rooms-editor.test.tsx`, `apps/admin/e2e/admin-product-hotel.spec.ts`,
`supabase/migrations/20260816110000_product_hotel_rooms.sql`,
`supabase/migrations/20260816120000_product_room_types_fixes.sql` (CHECK d'ordre min/max, `price_cop`
en `bigint`), `supabase/migrations/20260816130000_room_media_and_room_stay_rates.sql` (photos +
prix par période par chambre).
Modifiés : `apps/admin/components/product-form.tsx` (gating à granularité plus fine, cf. §3),
`apps/admin/app/admin/products/[id]/edit/page.tsx`, `apps/admin/components/stay-rates-editor.tsx`
(prop `testIdPrefix`).
Détail complet et traçabilité : §11.

---

## 1. Contexte et problème

Jérôme veut pouvoir ajouter un « hôtel » à un établissement, comme une activité ou un alojamiento
(spec 12) : photos, description, check-in/check-out. Mais contrairement à l'alojamiento (un seul
prix pour la maison entière), un hôtel a **plusieurs sous-produits qui sont des chambres** — pour
l'instant 2 types : dortoir (avec sa capacité) et chambre normale (avec sa capacité), chacune avec
son propre prix, même mécanisme que l'alojamiento (`price_cop` simple ou `price_tiers` +
`min_qty`/`max_qty`), posé sur la chambre plutôt que sur l'hôtel.

**Vérification V1 (« refaire pas réinventer », [[hifago_rebuild_not_reinvent]]) — terrain vierge
confirmé.** `src/config/properties.js` (mode `rooms`) et `src/services/inventoryService.js`
documentent qu'un hôtel à chambres n'a **jamais** géré son propre prix/capacité sans PMS externe
(LobbyPMS) — chaque « chambre » en mode `rooms` V1 est en réalité un produit `lodging` indépendant,
sans aucun lien parent↔enfant en base, et sa disponibilité vient entièrement du PMS.
`docs/00-modele-de-donnees.md` lignes 125-134/158-159 l'affirme déjà noir sur blanc : *« Il n'existe
aucun mécanisme pour un hôtel à plusieurs types de chambres qui gérerait lui-même ses prix et sa
disponibilité, sans PMS »* — point documenté comme « le plus structurant de tout l'audit ». La
spec 12 elle-même exclut explicitement ce cas de son périmètre (« un alojamiento est toujours un
logement loué en entier, pas un type de chambre »). Conclusion : aucun legacy à reprendre pour le
lien hôtel↔chambres — conception ex nihilo, mais réutilisation maximale des mécanismes déjà
construits (prix/tramos/bornes de la spec 08/12, check-in/check-out de la spec 12, pattern de table
enfant de `product_slot_rules`, spec 11).

**Passe d'alignement sur la forme réelle des données LobbyPMS** (demandée explicitement par
Jérôme — c'est ce PMS qui motive la décision déjà actée d'un relais réseau à IP stable, jamais
construite, `hifago/CLAUDE.md` §9) — `GET /api/v1/rooms` (`docs/3-integrations/lobby_pms_api.md`)
retourne, par catégorie de chambre : `category_id`, `name`, `type` (« privada » observé pour une
chambre privée — aucune valeur dortoir documentée), `capacity`, `quantity` (nombre de chambres
physiques de cette catégorie), `descriptions[]` (texte **multilingue**), `photos[]`, et `rooms[]`
(chambres physiques numérotées, un 3e niveau non construit ici). Alignement retenu : `quantity` et
`description` (i18n) ajoutés à `product_room_types` — utiles dès maintenant, pas seulement pour un
futur sync. Colonnes dormantes `lobby_category_id`/`lobby_product_id` ajoutées en anticipation
(miroir exact de `products.lobby_category_id`/`lobby_product_id`, déjà présentes et jamais
utilisées). Photos par chambre **livrées dans un second temps** (même journée, demande explicite de
Jérôme après un premier passage en local) — `add_catalog_media`/`reorder_gallery` étendus à un 3e
`p_entity_type = 'room_type'` (`room_media`, même patron que `product_media`/`establishment_media`),
cf. §3.

## 2. Portée

**In** :
- Nouveau type `hotel` dans le sélecteur `Tipo` de `ProductForm`, même point d'entrée que
  camp/evento/alojamiento (lien existant « + Actividad », aucun nouveau lien/écran).
- Réutilisation du parcours activité/alojamiento : nom/description i18n, lieu optionnel, photos dès
  la création, tags, check-in/check-out. **Pas** de prix/tramos/bornes/capacité au niveau de l'hôtel
  lui-même.
- Nouvelle table `product_room_types` : chambres illimitées par hôtel, chacune avec un type
  (dortoir/chambre privée), un nom/description i18n optionnels, une capacité, une quantité
  optionnelle, un prix (simple ou par tramos) et des bornes min/max de quantité — mécanisme
  entièrement réutilisé de la spec 08/12.
- Photos par chambre (`room_media`, galerie staged ou live selon que la chambre a un `id`) et prix
  par période par chambre (`stay_rates`, `StayRatesEditor` réutilisé tel quel) — cf. §3.
- Colonnes dormantes `lobby_category_id`/`lobby_product_id` sur `product_room_types`, anticipant un
  futur rattachement LobbyPMS sans redesign de table.

**Out, explicitement renvoyé à une Tranche 2** :
- Une chambre n'est **pas** orderable via `create_order` (qui ne connaît que
  `order_lines.product_id`) — nouveau type de ligne de commande référençant une chambre, ou
  mécanisme équivalent, à concevoir séparément.
- Toute consommation réelle de prix/disponibilité (calendrier de nuitées, prix par date, majoration
  de `stay_rates` appliquée au checkout) — pas construite, cohérent avec le calibrage « définition
  admin seulement » déjà appliqué aux specs 11/12.
- Le connecteur LobbyPMS lui-même (relais réseau à IP stable, appels API, synchronisation
  dispo/prix) — ressource externe réelle, arbitrage à part entière (`CLAUDE.md` §8), aucun appel
  réseau construit par cette spec.

## 3. Décisions retenues

- **Pas de colonne self-référentielle** (`parent_product_id` sur `products`, pattern absent de tout
  le schéma, vérifié par grep exhaustif) — une **nouvelle table enfant** `product_room_types`, même
  patron exact que `product_slot_rules`.
- **Le prix vit sur la chambre, pas sur l'hôtel** — `products.price_cop` exempté comme `evento`
  (`products_price_cop_required_unless_evento` étendue), chaque chambre porte son propre
  `price_cop`/`price_tiers`/`min_qty`/`max_qty`, réutilisant tel quel `PriceTier`/`priceTiers.ts`
  (spec 08) plutôt que d'inventer un second mécanisme de tramos.
- **Gating à granularité plus fine dans `ProductForm`** : `sharesActivityFields` (lieu+tags) devient
  `isActivity || isLodging || isHotel` ; nouveau `hasPriceQtyFields = isActivity || isLodging`
  (l'hôtel en est exclu) ; nouveau `hasCheckInOut = isLodging || isHotel` (extrait du bloc `isLodging`
  précédent, `capacity`/`stay_rates` restent réservés à `isLodging` seul).
- **Chambres illimitées, chacune avec type + nom libre** (confirmé par Jérôme) — pas un plafond de 2
  lignes fixes, pour permettre par exemple deux dortoirs distincts dans le même hôtel.
- **Alignement LobbyPMS partiel, pas total** — `quantity`/`description` ajoutés (utiles
  immédiatement), `lobby_category_id`/`lobby_product_id` ajoutés dormants (anticipation), mais
  **aucune** traduction du vocabulaire `kind` sur la valeur brute LobbyPMS (non documentée pour un
  dortoir) — cf. §10.
- **RLS directe** pour `product_room_types`/`room_media` — même raisonnement que specs 08/11/12
  (aucun des 4 critères RPC-only ne s'applique).
- **`add_catalog_media`/`reorder_gallery` étendus plutôt que dupliqués** — un 3e `p_entity_type`
  mécanique, même signature, comportement `product`/`establishment` inchangé. Alternative écartée :
  une 3e RPC `add_room_media` séparée aurait dupliqué le plafond de 6 photos, la logique de tri et
  l'audit `log_admin_action` déjà en place, pour une différence d'une seule table cible.
- **`ProductHotelRoomsBlock` en upsert, pas delete-all-reinsert** — nécessaire pour ne pas effacer
  en cascade les photos d'une chambre non modifiée à chaque sauvegarde (cf. §0 invariants). Point
  non anticipé dans la conception initiale de cette spec (les chambres n'avaient alors que des
  champs scalaires) — corrigé dès que les photos par chambre ont révélé le problème.

## 4. Parcours cible

1. L'admin ouvre `/admin/products/new` depuis le lien « + Actividad » d'un établissement, bascule le
   sélecteur `Tipo` sur « Hotel ».
2. Il saisit le nom (ES/EN) et la description (ES/EN, optionnelle) via `LocalizedTextField` —
   identique à l'activité/l'alojamiento.
3. Il renseigne optionnellement un lieu, des photos, des tags, et l'heure de check-in/check-out —
   identique à l'alojamiento.
4. Il ajoute une ou plusieurs chambres (« + Agregar habitación ») : type (dortoir/chambre privée),
   nom/description optionnels, capacité, quantité optionnelle, prix (simple ou par tramos), bornes
   min/max — chaque chambre est indépendante, autant que nécessaire.
5. Un seul clic sur « Crear hotel » : le produit hôtel est créé (`price_cop` reste `null`), puis
   (non-bloquant) photos/tags/chambres sont rattachés.
6. Redirection vers `/admin/establishments`. L'admin édite ensuite le même hôtel depuis
   `/admin/products/[id]/edit` — nom/description/lieu/check-in/check-out dans `ProductForm` ; les
   chambres restent un bloc à sauvegarde immédiate séparé (`ProductHotelRoomsBlock`, « Guardar
   habitaciones » → remplace tout le jeu de chambres).

## 5. Écran(s)

- **`/admin/products/new`** et **`/admin/products/[id]/edit`** — même composant `ProductForm` que
  l'activité/l'alojamiento (specs 08/11/12), section « Habitaciones » (`HotelRoomsEditor`) gated
  `!isEditing && isHotel` en création (staged, comme les créneaux — les chambres ont besoin du
  `product_id` du nouvel hôtel).
- **`HotelRoomsEditor`** (nouveau, composant UI pur pour les champs scalaires) : liste de chambres,
  chacune avec un sélecteur de type, `LocalizedTextField` nom/description, une galerie de photos
  (`RoomCard`, staged ou live selon l'`id`), `PriceTiersEditor` (extrait, partagé avec le prix
  produit), `StayRatesEditor` (prix par période, réutilisé de la spec 12), capacité, quantité,
  bornes min/max.
- **`ProductHotelRoomsBlock`** (nouveau, édition seulement, même patron que `ProductSlotRulesBlock`)
  : sauvegarde immédiate, « Guardar habitaciones » → upsert par `id` (cf. §0/§3), pas delete-all-
  reinsert.
- Blocs existants (`ProductStatusBlock`/`ProductPhotosBlock`/`ProductTagsBlock`) : inchangés,
  `ProductTagsBlock` désormais aussi rendu pour `hotel` (gating partagé étendu).

---

## 10. Décisions tranchées / points ouverts

- **⚠️ Risque latent trouvé par la revue adversariale de fin de tâche, non corrigé (touche
  `create_order`, RPC anti-survente — signalé à Jérôme plutôt que patché seul, cf.
  `AGENTS-PARALLELES.md` point 6)** : `create_order` (`supabase/migrations/20260813243000_create_order_rpc.sql`
  ligne ~200) recopie `products.price_cop` dans `order_lines.price_cop` (colonne `NOT NULL`) sans
  garde contre une valeur `NULL` — déjà vrai pour `evento` depuis le 2026-08-14
  (`products_price_cop_required_unless_evento`), et donc, structurellement, pour `hotel` aussi
  depuis cette spec. Si un hôtel publié (`set_product_sellable` n'a aucun garde-fou de type/prix)
  était ajouté au panier par son propre `product_id` (pas une chambre — `product_room_types` n'est
  référencé par aucune commande aujourd'hui), l'insert dans `order_lines` lèverait une exception
  Postgres non gérée au lieu d'un refus propre `{ok:false, reason:...}`. **Non confirmé si
  `apps/web` expose réellement un hôtel/evento comme ajoutable au panier par son `product_id`** —
  risque théorique élevé, pas une régression live vérifiée. Pré-existant (evento), pas introduit
  par cette spec — seulement rendu atteignable par un second type. Corrigé nulle part dans cette
  tâche : `create_order` est un chokepoint anti-survente critique, hors périmètre d'un patch
  unilatéral. À trancher par Jérôme : garde-fou dans `create_order` (rejeter proprement une ligne
  à `price_cop is null`), ou contrainte en amont empêchant un `evento`/`hotel` d'atteindre le
  panier par son propre id.
- **Une chambre n'est pas orderable aujourd'hui** — `create_order`/`order_lines` ne connaissent que
  `products.id`. Une future Tranche 2 devra soit ajouter une référence `room_type_id` aux lignes de
  commande, soit un autre mécanisme équivalent. Non tranché ici.
- **`stay_rates` d'une chambre purement définitionnel** — comme pour l'alojamiento (spec 12), aucune
  majoration de saison/week-end n'est appliquée à un prix réel : `create_order` ignore cette
  colonne, aucun calcul de prix par date construit. Tranche 2.
- **Vocabulaire `kind` (`dorm`/`private`) non aligné mot pour mot sur LobbyPMS** — seule la valeur
  « privada » est documentée côté API, aucune valeur dortoir confirmée. Un futur connecteur ferait
  la traduction, pas la colonne elle-même.
- **`add_catalog_media`/`reorder_gallery` étendus, aucune fonction centralisée touchée** —
  `is_admin()`/`has_capability()` inchangées ; seul un 3e `p_entity_type` mécanique a été ajouté aux
  deux RPC déjà existantes (spec 04), plus de nouvelles policies dédiées à `product_room_types`/
  `room_media`. Rayon d'effet vérifié par la suite e2e `admin-product-photos.spec.ts` (branche
  `product` inchangée) en plus du nouveau test dédié aux chambres.

## 11. Annexe — traçabilité code→règle

| Section | Fichiers sources |
|---|---|
| §1 Contexte, vérification V1 | `src/config/properties.js`, `src/services/inventoryService.js` (racine legacy) ; `docs/00-modele-de-donnees.md` lignes 125-134/158-159/161-176 |
| §1 Alignement LobbyPMS | `docs/3-integrations/lobby_pms_api.md` (endpoint `GET /api/v1/rooms`), `docs/2-reference/06-lobbypms.md` |
| §3 Table enfant `product_room_types` | `supabase/migrations/20260816091000_product_slot_rules.sql` (patron RLS/FK repris à l'identique) |
| §3 Prix par chambre | `apps/admin/lib/products/priceTiers.ts` (spec 08, réutilisé tel quel) |
| §3 `price_cop` exempté | `supabase/migrations/20260814190000_products_evento_vitrine.sql` (précédent `evento`) |
| §3 Photos par chambre | `supabase/migrations/20260815110000_gestion_images.sql` (`add_catalog_media`/`reorder_gallery`, `product_media`/`establishment_media`, patron repris pour `room_media`) ; `apps/admin/app/admin/products/[id]/edit/ProductPhotosBlock.tsx` (galerie live, mécanique reprise par chambre) |
| §3 Prix par période par chambre | `apps/admin/components/stay-rates-editor.tsx`/`apps/admin/lib/products/stayRates.ts` (spec 12, réutilisés tels quels) |
| §3 Upsert `ProductHotelRoomsBlock` | `apps/admin/lib/products/hotelRooms.ts` (`toRoomTypeRow` singulier, ajouté pour l'upsert chambre par chambre) |

## 12. Documents liés

- [`12-admin-alojamiento-house.md`](12-admin-alojamiento-house.md) — parcours `ProductForm` et
  check-in/check-out réutilisés tels quels.
- [`11-admin-activite-parcours-unifie-creneaux.md`](11-admin-activite-parcours-unifie-creneaux.md) —
  patron de table enfant `product_id references products(id) on delete cascade` repris à l'identique.
- [`08-admin-gestion-activite.md`](08-admin-gestion-activite.md) — mécanisme `price_tiers`/`min_qty`/
  `max_qty` réutilisé par chambre.
- `hifago/docs/00-modele-de-donnees.md` §2/§3 — gap « hôtel à chambres sans PMS » désormais
  partiellement comblé (prix/capacité propres), mis à jour par cette spec.
- `docs/3-integrations/lobby_pms_api.md`, `docs/2-reference/06-lobbypms.md` — référence pour une
  future Tranche 2 PMS-backed.
