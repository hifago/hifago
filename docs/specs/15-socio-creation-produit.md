---
id: specs-socio-creation-produit
titre: "Socio : proposer la création d'une nouvelle fiche produit"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
revise: ["docs/02-cahier-des-charges-socio.md#3e"]
maj: 2026-08-17
resume: >
  Un partenaire prestataire (socio, capacité operator active) peut désormais proposer la création
  d'une nouvelle fiche produit (activity/evento/camp/lodging/hotel/transport) sur un de ses
  établissements, avec parité totale des champs par rapport au parcours admin — modérée par un
  admin avant d'exister réellement, jamais une écriture directe. Jusqu'à 6 photos incluses dès la
  proposition (révision Jérôme du 2026-08-17, cf. §10).
mots_cles: [socio, partenaire, produit, activité, proposition, modération, product_proposals,
  création, hôtel, alojamiento, evento, transport, campamento]
repond_a:
  - "Comment un partenaire prestataire ajoute-t-il une nouvelle activité (ou tout autre type de
    fiche) à un de ses établissements ?"
  - "Quel est le mécanisme de modération d'une création de produit par un socio ?"
---

> **Amendement daté du 2026-08-27 — l'étage hôtel a été supprimé.** `products.type='hotel'`,
> `product_room_types`, `room_media`, `room_type_availability`, `room_type_date_rates`,
> `order_lines.room_type_id` et `set_room_type_availability` n'existent plus (T3 de la spec 24 :
> application par le commit 38c1b55, base par la migration `20260827220000`). Une chambre est
> désormais un produit `type='lodging'` à part entière. **Toute mention de `room_type`,
> `product_room_types` ou d'une « branche chambre » ci-dessous décrit un état passé** ; le mécanisme
> équivalent vit sur `products`/`product_availability`. Détail et raisons : `docs/specs/24-modele-
> hebergement-et-surface-lobbypms.md` §4, et le bandeau de `docs/specs/13-admin-hotel-habitaciones.md`.

# Socio : proposer la création d'une nouvelle fiche produit

> **Cible stack** : hifago. **Feature n°15**.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | Contrat compact | implemente |
| 1 | Contexte et problème | implemente |
| 2 | Portée | implemente |
| 3 | Décisions retenues | implemente |
| 4 | Parcours cible | implemente |
| 5 | Écran(s) | implemente |
| 10 | Décisions tranchées / points ouverts | implemente |
| 11 | Annexe — traçabilité code→règle | implemente |
| 12 | Documents liés | implemente |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Endpoints / RPC

- `submit_product_creation_proposal(p_establishment_id uuid, p_type text, p_payload jsonb) returns
  jsonb` — socio, `security definer`, `set search_path=''`. 3 garde-fous (identité, propriété
  établissement, capacité `operator` active scopée à `p_establishment_id` —
  `has_capability(uid,'operator',p_establishment_id)`). Whitelist stricte du payload par type
  (miroir `hasLocationAndTags`/`hasPriceQtyFields`/`hasCheckInOut` de `ProductForm`). Plafond 1
  pending PAR ÉTABLISSEMENT (`pending_creation_exists`) + plafond générique 10/partenaire
  (`pending_cap_exceeded`, tous kinds confondus). `grant execute ... to authenticated`.
- `moderate_product_proposal(...)` (signature inchangée) — nouvelle branche `kind='create'` :
  appelle `create_product_from_proposal(...)` en nested, backfille `product_id`+`status='approved'`.
- `create_product_from_proposal(p_partner_id, p_establishment_id, p_type, p_payload) returns uuid`
  — interne, **pas de grant execute** (appelée uniquement en nested). `sellable=false` toujours,
  slug calculé à l'approbation (suffixe `-2`/`-3`… anti-collision). Insère `products` +
  `product_tag_assignments`/`product_slot_rules` (activity)/`product_room_types` (hotel)/
  `product_media` (`payload.photos`, tous types) selon `payload`, qui arrive déjà dans la forme
  EXACTE des colonnes (calculs de prix/tramos faits côté client, jamais recalculés en SQL).
- `withdraw_product_proposal` (déjà existante) fonctionne telle quelle sur `kind='create'`.
- Squelette de sécurité réutilisé : `hifago/docs/05-reference-technique.md` §1 — **hors
  périmètre anti-survente** (aucun compteur de capacité/calendrier touché), calibrage RPC
  bas-volume comme `create_establishment`.

### Modèle de données (delta)

- `product_proposals` — **modifié** : `product_id` devient nullable ; colonnes ajoutées
  `establishment_id uuid references establishments(id)` (requis pour `kind='create'`, connu dès
  la soumission — l'établissement cible existe déjà, contrairement à
  `establishment_proposals.establishment_id`) et `type text` (6 valeurs) ; CHECK `kind` étendu à
  `'create'` ; nouvelle contrainte `product_proposals_scope` (symétrique de
  `establishment_proposals_scope`).
- `products`/`product_tag_assignments`/`product_slot_rules`/`product_room_types`/`product_media` —
  réutilisées telles quelles (schéma inchangé), simple nouveau chemin d'écriture (RPC au lieu
  d'insert direct admin).
- Migrations : `supabase/migrations/20260817130000_product_creation_proposal.sql` (mécanisme de
  base) puis `20260817140000_product_creation_proposal_photos.sql` (révision photos, même jour).

### Invariants

- Un socio n'a et n'aura jamais de droit d'écriture directe sur `products` (RLS admin-only,
  jamais étendue) — toute création passe par proposition modérée.
- `sellable=false` systématique à la création, quel que soit le chemin (admin-direct ou proposition
  approuvée) — publier reste un geste admin séparé (`set_product_sellable`).
- Jusqu'à 6 photos dans la proposition de création (plafond identique à `submit_photos_proposal`),
  uploadées immédiatement vers Storage (même Route Handler qu'admin-direct) — seul `storage_path`
  traverse le payload, rattaché à `product_media` à l'approbation. Jamais éditables depuis l'écran
  de modération (aperçu lecture seule) : toujours reprises de la soumission ORIGINALE du socio,
  jamais d'un `p_corrected_payload` qui ne les porterait pas.
- `type` n'est jamais corrigible à la modération (immuable dès la soumission socio, même
  invariant que établissement/type immuables après création admin-direct).
- Sélection de tags côté socio limitée aux tags existants (`TagsMultiSelect allowCreate={false}`)
  — `catalog_tags` reste en écriture admin-only.

### Cas limites

- Établissement inexistant ou d'un autre partenaire → `establishment_not_found` (même réponse
  dans les deux cas, jamais de fuite d'existence).
- Capacité `operator` absente/suspendue sur cet établissement précis → `capability_suspended`.
- Création déjà pending sur cet établissement → `pending_creation_exists`.
- 10 propositions pending déjà atteintes (tous kinds confondus) → `pending_cap_exceeded`.
- Collision de slug à l'approbation (nom corrigé par l'admin) → suffixe `-2`/`-3`… plutôt que
  d'échouer la transaction de modération.
- Admin corrige le payload avant d'approuver → objet complet remplace le payload soumis (pas un
  merge champ par champ, trop riche/typé par type pour un coalesce fiable).

### Fichiers touchés

- `supabase/migrations/20260817130000_product_creation_proposal.sql` +
  `20260817140000_product_creation_proposal_photos.sql` (nouveaux).
- `apps/admin/lib/products/useProductTypeFieldsState.ts` (nouveau — hook + `productTypeGating`).
- `apps/admin/lib/products/productCreationPayload.ts` (nouveau — `buildProductCreationPayload`).
- `apps/admin/lib/products/{slotRules,hotelRooms}.ts` (étendus — `slotRulesFromColumn`/
  `roomTypesFromColumn`, sens inverse pour hydrater la modération).
- `apps/admin/components/product-type-fields/` (nouveau — extrait de `product-form.tsx` ; découpé en sous-composants par type le 2026-09-17).
- `apps/admin/components/product-form.tsx` (étendu — prop `variant: "admin" | "socio-proposal"`).
- `apps/admin/components/tags-multiselect.tsx` (étendu — prop `allowCreate`).
- `apps/admin/components/hotel-rooms-editor.tsx` (supprimé par la spec 24 T3 — était étendu d'une prop `hidePhotos`).
- `apps/admin/app/partner/(app)/products/{layout.tsx,page.tsx}` (étendus), `new/page.tsx` +
  `PendingProductCreationsList.tsx` (nouveaux).
- `apps/admin/app/admin/proposals/page.tsx` (fallback `displayName`), `[id]/page.tsx` (branche
  `kind='create'`), `[id]/ModerateProductCreationProposalForm.tsx` (nouveau).

---

## 1. Contexte et problème

Le socio pouvait déjà éditer une fiche produit déjà créée par l'admin (`product_proposals`,
kind `content`/`photos`, feature 15 initiale du 2026-08-13) ou gérer son calendrier de
disponibilité, mais aucun chemin n'existait pour proposer une fiche entièrement nouvelle — écart
confirmé par exploration directe du code (`product_proposals.product_id` `NOT NULL` empêchant
structurellement toute création, aucune route `partner/(app)/products/new`). Le cahier des charges
socio §3e décrit déjà ce besoin (« proposer une fiche classique... activité, tour, transport »),
statut brouillon (cible validée section par section, jamais codée).

Le patron à répliquer existait déjà pour les établissements (`establishment_proposals`, livré le
2026-08-15, kind `create`/`edit`/`photos`, FK nullable jusqu'à approbation) — architecture reprise
ici pour `product_proposals`, jamais réinventée.

## 2. Portée

**In** : proposition de création (mécanisme + écran socio + modération admin) pour les 6 types de
produit (`activity`/`evento`/`camp`/`lodging`/`hotel`/`transport`), parité totale des champs avec
`ProductForm` (y compris `HotelRoomsEditor`/`StayRatesEditor` pour hôtel/logement), jusqu'à 6
photos du produit incluses dès la proposition (révision Jérôme, cf. §10).

**Out** : photos PAR CHAMBRE d'un hôtel dans la proposition de création (`HotelRoomsEditor` garde
son bloc photo masqué côté socio, cf. §10) ; création de tag à la volée côté socio ; type `'tour'`
(legacy, jamais exposé dans aucun formulaire, admin ou socio) ; camp/
transport n'étaient pas dans la demande initiale mais ont été inclus par décision explicite de
Jérôme (même mécanisme générique, aucun coût supplémentaire réel).

## 3. Décisions retenues

Décisions actées par Jérôme au cadrage (2026-08-17, ne pas rouvrir) :
1. Les 6 types de produit sont couverts dès ce lot — révise la règle du cahier des charges socio
   §3e (« jamais un hébergement directement ») pour la **création** uniquement (cf. révision
   explicite en §10 et dans `docs/02-cahier-des-charges-socio.md`).
2. Parité totale des champs dès la création, y compris les sous-structures hôtel/logement.
3. **Révisé le 2026-08-17, même jour** : décision initiale "aucune photo dans la proposition,
   différées après approbation" retournée par Jérôme — jusqu'à 6 photos du produit incluses dès la
   proposition (conforme au cahier des charges socio §3e "jusqu'à 6 photos"), uploadées immédiatement
   vers Storage comme l'admin-direct, rattachées à `product_media` à l'approbation. Restent hors
   périmètre : les photos PAR CHAMBRE d'un hôtel (`HotelRoomsEditor`), jamais couvertes par aucun
   mécanisme socio avant cette spec — extension possible mais non demandée, cf. §10.
4. Tags : sélection parmi l'existant seulement côté socio.
5. Écran de modération admin : composant partagé (`ProductTypeFields`) plutôt qu'un formulaire de
   modération dupliqué — zéro divergence possible entre le formulaire socio et l'écran de
   modération pour un même type.

## 4. Parcours cible

1. Le socio, sur `/partner/products`, clique « Proponer una nueva ficha » (visible seulement s'il
   a au moins un établissement avec capacité `operator` active).
2. `/partner/products/new` : même formulaire que l'admin (`ProductForm`, gating par type
   identique), établissement limité à ceux du partenaire avec capacité active, type au choix parmi
   les 6, jusqu'à 6 photos du produit (upload immédiat vers Storage). Soumission →
   `submit_product_creation_proposal`.
3. La proposition apparaît en attente sur `/partner/products` (`PendingProductCreationsList`,
   retirable) et sur `/admin/proposals` (libellé « Creación »).
4. L'admin ouvre le détail, voit un aperçu lecture seule des photos proposées, corrige si besoin
   les autres champs (`ProductTypeFields`), approuve ou rejette (motif obligatoire).
5. Approbation → `products` réel créé (`sellable=false`) avec ses photos rattachées
   (`product_media`), `product_id` backfillé sur la proposition, produit visible dans
   `/admin/establishments/[id]` et `/partner/products`.
6. L'admin publie séparément quand la fiche est prête (`set_product_sellable`) ; le socio peut
   ensuite proposer des photos supplémentaires si besoin (mécanisme déjà existant,
   `submit_photos_proposal`, plafond 6 partagé avec celles de la création).

## 5. Écran(s)

- **`/partner/products`** : lien de création + liste des créations pending (retirables).
- **`/partner/products/new`** : `ProductForm` en `variant="socio-proposal"` — bloc photos du
  produit inclus (`StagedProductPhotos`, identique à l'admin-direct), `HotelRoomsEditor` sans son
  bloc photo par chambre, `TagsMultiSelect` sans création à la volée.
- **`/admin/proposals`** : ligne « Creación » avec nom proposé (payload, produit pas encore créé).
- **`/admin/proposals/[id]`** : `ModerateProductCreationProposalForm` — nom/description, aperçu
  lecture seule des photos proposées, `ProductTypeFields` pré-remplis depuis le payload,
  Aprobar/Rechazar.

## 10. Décisions tranchées / points ouverts

- **Tranché** : `type` devient une vraie colonne de `product_proposals` (pas un champ noyé dans
  `payload`) — cohérent avec `kind`, simplifie la RPC de modération et l'affichage admin.
- **Tranché** : le plafond « 1 pending » est PAR ÉTABLISSEMENT (pas par partenaire, contrairement
  à `submit_establishment_creation_proposal`) — un socio multi-établissements peut légitimement
  proposer une fiche sur chacun en parallèle.
- **Point ouvert** : `ProposalsTable.tsx` n'affiche pas le type de produit (`activity`/`hotel`/…)
  distinctement de `kind` (« Creación ») — amélioration UX raisonnable mais non requise, laissée à
  une future itération si Jérôme la juge utile en pratique.
- **Point ouvert** : `docs/specs/10-listes-standardisees-admin-socio.md` (brouillon, non livrée)
  prévoit déjà une future page `/partner/products/[id]` en lecture seule — `PendingProductCreationsList`
  de cette spec est un premier pas minimal, à unifier avec cette future liste standardisée si/quand
  elle est construite, pas dupliqué indéfiniment.
- **Révisé le 2026-08-17 (même jour, deuxième passage)** : décision 3 initiale ("aucune photo à la
  création") retournée par Jérôme — jusqu'à 6 photos du produit incluses dès la proposition,
  seconde migration `20260817140000_product_creation_proposal_photos.sql` (whitelist + plafond côté
  `submit_product_creation_proposal`, rattachement `product_media` côté `create_product_from_proposal`,
  préservation des photos originales — jamais via `p_corrected_payload` — côté
  `moderate_product_proposal`). Écran de modération volontairement en lecture seule pour les photos
  (aucune UI d'édition/suppression) : cohérent avec "rien n'est publié directement, mais ce qui est
  proposé doit rester visible tel quel à l'approbation" (cahier socio §3e, propriété n°1/3).
- **Point ouvert (nouveau)** : les photos PAR CHAMBRE d'un hôtel (`HotelRoomsEditor`, room-level,
  distinctes des photos du produit ci-dessus) restent hors périmètre côté socio — jamais demandées
  explicitement, ajouteraient une réconciliation non triviale au moment de la correction admin
  (tableau `room_types` entier remplacé par la correction, pas un merge par chambre). À rouvrir
  seulement si Jérôme le demande explicitement.
- **Extension (2026-08-17, retour direct de Jérôme le même jour)** : « Proponer edición — activitad
  le formulaire n'est pas du tout bon ». `EditProposalForm.tsx`/`ModerateProposalForm.tsx`
  (mécanisme d'ÉDITION préexistant, `submit_product_proposal`/`moderate_product_proposal` branche
  `content` — distinct du mécanisme de CRÉATION documenté par cette spec) étaient restés figés à
  leur état d'origine (2026-08-13) : name-es/name-en séparés (jamais migré vers
  `LocalizedTextField`, spec 11) et une `category` fixe déjà abandonnée par `ProductForm`
  admin-direct depuis la spec 08 (tags). Ramenés à parité avec `ProductForm` en mode édition —
  address/lat/lon/price_tiers/min_qty/max_qty/check_in_time/check_out_time/capacity/stay_rates,
  réutilisant `ProductTypeFields`/`useProductTypeFieldsState` — via une 3ᵉ migration
  (`20260817150000_product_edit_proposal_full_parity.sql`) : whitelist de
  `submit_product_proposal` étendue par type (même patron que la création), branche `content` de
  `moderate_product_proposal` réécrite en "objet complet remplace" (comme les branches
  `create`/`photos`) plutôt qu'un coalesce champ par champ — `category` n'est plus écrit du tout
  (colonne DB laissée intacte, simplement plus jamais lue/écrite par ce mécanisme). Portée
  volontairement alignée sur le bloc `if (isEditing && product)` de `ProductForm.handleSubmit` :
  jamais tags/photos/slot_rules/room_types, délégués côté admin à des blocs séparés à sauvegarde
  immédiate, absents de ce même submit là aussi. `apps/admin/lib/products/categories.ts`
  (`PRODUCT_CATEGORIES`/`NO_PRODUCT_CATEGORY`) supprimé — plus aucun consommateur après cette
  extension.

## 11. Annexe — traçabilité code→règle

| Section | Fichiers |
|---|---|
| RPC | `supabase/migrations/20260817130000_product_creation_proposal.sql`, `20260817140000_product_creation_proposal_photos.sql`, `20260817150000_product_edit_proposal_full_parity.sql` |
| Édition socio (extension) | `apps/admin/app/partner/(app)/products/[id]/edit/EditProposalForm.tsx`, `apps/admin/lib/products/productEditPayload.ts` |
| Modération édition (extension) | `apps/admin/app/admin/proposals/[id]/ModerateProposalForm.tsx` |
| Formulaire socio | `apps/admin/app/partner/(app)/products/new/page.tsx`, `apps/admin/components/product-form.tsx` |
| Gating par type partagé | `apps/admin/lib/products/useProductTypeFieldsState.ts`, `apps/admin/components/product-type-fields.tsx` |
| Payload | `apps/admin/lib/products/productCreationPayload.ts` |
| Modération admin | `apps/admin/app/admin/proposals/[id]/ModerateProductCreationProposalForm.tsx`, `apps/admin/app/admin/proposals/[id]/page.tsx` |
| Liste pending socio | `apps/admin/app/partner/(app)/products/PendingProductCreationsList.tsx` |

## 12. Documents liés

- `docs/specs/06-gestion-etablissement.md` — patron proposition create/edit/photos, transposé ici.
- `docs/specs/08-admin-gestion-activite.md`, `docs/specs/11-admin-activite-parcours-unifie-creneaux.md`
  — modèle de données cible activité (tags, price_tiers, gating).
- `docs/specs/12-admin-alojamiento-house.md`, `docs/specs/13-admin-hotel-habitaciones.md` —
  sous-structures logement/hôtel reprises telles quelles.
- `docs/02-cahier-des-charges-socio.md` §3e — révisé par cette spec (règle « jamais un hébergement
  directement » ne s'applique plus à la création).
