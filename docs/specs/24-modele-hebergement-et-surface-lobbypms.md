---
id: specs-modele-hebergement-surface-lobbypms
titre: "Surface LobbyPMS exploitée, parcours front d'un produit lié, et cible du modèle hébergement"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: partiel
reste: >
  Lot A implémenté le 2026-08-26 ; Lot B gelé (observation préprod requise) ; T1/T2/T3 de la cible
  modèle LIVRÉS le 2026-08-27 — l'étage hôtel n'existe plus. T4 (import Lobby avancé) reste à
  faire. Impact sur les quatre cahiers relu le 2026-09-07 (relecture intégrale) et reporté dans
  leur en-tête « Écarts connus » — voir le champ `revise:` ci-dessous.
revise:
  - "docs/00-modele-de-donnees.md#1"
  - "docs/00-modele-de-donnees.md#3"
  - "docs/01-cahier-des-charges-client.md#4"
  - "docs/01-cahier-des-charges-client.md#5"
  - "docs/02-cahier-des-charges-socio.md#3d"
  - "docs/03-cahier-des-charges-admin.md#3c"
maj: 2026-08-27
resume: >
  Audit de ce que l'API LobbyPMS expose réellement face à ce que hifago en consomme, refonte du
  parcours front d'un produit lié (voir ce qu'on a choisi, importer ce que Lobby en sait), et
  décision de cible sur le modèle hébergement — supprimer l'étage « produit hôtel » au profit de
  l'établissement, une chambre devenant un produit vendable.
mots_cles: [lobbypms, pms, connecteur, hebergement, hotel, chambre, dortoir, product_room_types,
  import, photos, descriptions, catalogue, modele de donnees, hifago]
repond_a:
  - "Que peut-on réellement récupérer de LobbyPMS, et qu'en exploite-t-on ?"
  - "Que voit-on à l'écran quand on lie un produit à une catégorie ou un service LobbyPMS ?"
  - "Pourquoi une chambre PMS-backed apparaissait-elle sans photo ni description dans le catalogue ?"
  - "Faut-il garder products.type='hotel' et product_room_types ?"
---

# Surface LobbyPMS, parcours front d'un produit lié, cible du modèle hébergement

> **Cible stack** : hifago. Fait suite à [`21-connecteur-lobbypms.md`](21-connecteur-lobbypms.md)
> (le connecteur lui-même) et à [`13-admin-hotel-habitaciones.md`](13-admin-hotel-habitaciones.md)
> (l'étage hôtel→chambres que ce document propose de retirer).
>
> Ce document a été passé à un **challenge adversarial** (6 dimensions, réfutation croisée de chaque
> finding) avant d'être écrit. Plusieurs affirmations de sa première version ont été prises en défaut
> et corrigées ; elles sont signalées ⚠️ pour que personne ne les redécouvre.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (la frontière, ce qui est lu, ce qui ne l'est pas) | implémenté |
| 1 | Contexte et problème | implémenté |
| 2 | Ce que LobbyPMS expose vs ce qu'on exploite | implémenté |
| 3 | Parcours front d'un produit lié | implémenté (Lot A) |
| 4 | Cible du modèle hébergement | **retenue sous conditions, non implémentée** |
| 10 | Décisions tranchées / points ouverts | tranché le 2026-08-26 |
| 11 | À vérifier en conditions réelles (préprod) | **ouvert** |
| 12 | Documents liés | implémenté |

---

## 0. Contrat compact (pour coder — lire seul)

### La frontière, une fois pour toutes

> **Lobby fait foi sur la DISPONIBILITÉ** — relue à chaud, jamais copiée en base.
> **Sur tout le reste (nom, description, photos, capacité, prix), hifago fait foi** ; Lobby ne fait
> que **proposer** une valeur au moment où on établit le lien.

Pourquoi l'import plutôt que le miroir permanent : la fiche publique est rendue en SSR avec i18n et
SEO, elle ne peut pas dépendre d'un appel Lobby au rendu — c'est déjà la raison pour laquelle
`GET /api/pms/night-availability` est appelé depuis le client et jamais depuis `page.tsx`. Un miroir
pur afficherait une fiche vide dès que Lobby est injoignable, contre la règle « échec fermé »
(`hifago/CLAUDE.md` §4.4), et ne se plierait pas au contenu multilingue par colonnes JSONB avec repli
obligatoire (§5.1).

### Lecture des réponses Lobby

Tout parseur d'une réponse Lobby vit dans `packages/domain/src/pms/`, **jamais dans un Route
Handler**, et suit le patron de `parseLobbyNightCatalog.ts` : aucun champ supposé présent, champ
absent = champ omis (jamais une valeur fabriquée), jamais d'exception. Raison non théorique : la doc
officielle de Lobby s'est **déjà révélée fausse** sur `POST /bookings`, dont la vraie réponse est
`{"booking":{"booking_id":…}}` et non le `{"data":[{"idBooking":…}]}` imprimé.

| Module | Rôle |
|---|---|
| `parseLobbyRooms.ts` | `GET /api/v1/rooms` → catégories (`type`, `capacity`, `quantity`, `descriptions[]`, `photos[]`, `rooms[]`) + `parseLobbyPageMeta` pour arrêter la pagination à la dernière page réelle |
| `parseLobbyServices.ts` | `GET /api/v1/products` → services (`value` **indicatif**, `infinite_inventory`, `stock`) |
| `buildLobbyBookingNote.ts` | note du booking — seul champ libre, Lobby n'ayant aucun champ email/téléphone |
| `fetchLobbyPhoto.ts` | récupération **bornée** d'une photo Lobby (liste blanche d'hôtes, refus des redirections, plafond sur les octets **reçus**, timeout) + `remainingPhotoSlots` |

### Invariants

- **Le prix ne vient jamais de Lobby.** `value`/`plans[].prices[]` ne sont affichés qu'à titre
  indicatif. `product_date_rates`/`price_tiers` restent la seule source du prix de vente.
- **Un `type='hotel'` n'est jamais PMS-backed** (`isPmsBacked` = `lodging` + `lobby_category_id`).
- **Une langue de contenu hors `es`/`en` n'est jamais écrite** — l'éditeur (`LocalizedTextField`) est
  fermé à ces deux langues et `activeLang` s'initialise à `es` : une clé `pt` importée serait publiée
  par repli, invisible dans l'éditeur et non supprimable. Le parseur la signale à l'écran au lieu de
  l'écrire.
- **Lobby compte en UNITÉS, hifago en CUPOS — toute lecture de disponibilité doit convertir.**
  `available_rooms` (`/api/v2/available-rooms`) renvoie un nombre de chambres/tentes/lits-unités
  libres. `product_availability.capacity`, `order_lines.qty`, `min_qty`/`max_qty` et `price_tiers`
  comptent, eux, des cupos — et le garde-fou `capacity_exceeds_physical`
  (`set_product_availability`, migration 20260827250000) dit lesquels : un dortoir se vend au LIT
  (`unit_count × capacity`), une privée ou une maison entière à l'UNITÉ (`unit_count`),
  `lodging_kind` NULL suivant le dortoir (borne haute). `cuposPerUnit`
  (`packages/domain/src/products/lodgingCupos.ts`) REPREND ce vocabulaire, et
  `GET /api/pms/night-availability` l'applique **après** son cache — ce qui est mis en cache est la
  réponse brute de Lobby, partageable par deux produits pointant la même catégorie. Corrigé le
  2026-08-28, après avoir sous-vendu GLAMPING (`capacity=2`, `unit_count=3` : Lobby répond 3,
  l'écran refusait 4 cupos).
  > ⚠️ **Rectificatif du 2026-08-28 (revue).** La première version de cet invariant affirmait que
  > « les deux formules doivent rester identiques, sinon l'écran promet une nuit que la base
  > refusera ». C'est **faux**, et il ne faut pas raisonner dessus : les deux ne s'appliquent
  > jamais au même produit. `cuposPerUnit` ne sert que les PMS-backed, et c'est exactement pour eux
  > que `create_order` saute verrou et décrément de `product_availability` — le garde-fou SQL ne
  > les voit donc jamais (cf. l'invariant suivant, qui le dit déjà). Ce qui est partagé est un
  > vocabulaire, pas une contrainte de cohérence. Le garde-fou réel contre la divergence n'est pas
  > cette phrase : c'est l'exhaustivité du `switch` de `cuposPerUnit`, qui casse la compilation si
  > `LODGING_KINDS` s'agrandit. Au passage, les deux replis par défaut étaient **opposés**
  > (SQL `else → unit_count` ; TS `défaut → capacity`) — alignés sur `1` depuis.
- **Un logement PMS-backed n'a pas de calendrier de cupos interne.** `create_order` saute
  explicitement verrou et décrément de `product_availability` pour ces lignes : proposer l'écran de
  cupos serait proposer un calendrier inerte.
- **Le plafond de 6 photos ne borne pas le travail sortant.** Il vit *dans* `add_catalog_media`,
  donc ne se déclenche qu'après téléchargement, décodage et écriture Storage. Toute liste d'URLs
  à importer se coupe **avant le premier fetch** (`remainingPhotoSlots`), et un objet déjà écrit
  dans Storage est retiré si la RPC refuse — aucun call site du dépôt ne faisait ce nettoyage.
- **Un service Lobby ne se vend jamais seul.** `add-product-service` exige un booking porteur
  (`422 "The booking doesnt exits"`), et il a été décidé de ne jamais inventer de booking coquille.
  Ce n'est pas un incident — donc pas une entrée de réconciliation.

---

## 1. Contexte et problème

Le connecteur (spec 21) était livré et la refonte du parcours partenaire↔Lobby en cours. Il en
manquait la moitié : **on savait masquer les champs que Lobby fournit, on n'était jamais allé les
chercher.**

Conséquence concrète, visible par le client : la carte du catalogue public tire son image de
`product_media` et son extrait de `products.description`
(`apps/web/app/[locale]/page.tsx`). Une chambre liée à Lobby n'ayant ni l'une ni l'autre — bloc
photos retiré côté admin, description masquée, et rien qui lise `photos[]`/`descriptions[]` chez
Lobby — apparaissait comme **un nom nu, sans photo ni description**, alors que Lobby détenait déjà
tout ça pour la catégorie.

Côté écran de liaison, choisir une catégorie ne renvoyait **aucun retour visuel** : ni le nom une
fois le formulaire rouvert (seul l'`id` est stocké, et le sélecteur retombait en mode « saisie
manuelle » qui affiche l'entier brut), ni ce que Lobby sait de cette chambre.

## 2. Ce que LobbyPMS expose vs ce qu'on exploite

| Endpoint | Ce que Lobby renvoie | Exploité |
|---|---|---|
| `GET /api/v1/rooms` | `category_id`, `name`, `type`, `capacity`, `quantity`, `descriptions[]` multilingues, `photos[]`, `rooms[]` | **oui, intégralement** depuis le 2026-08-26 (avant : `{id, name}`) |
| `GET /api/v1/products` | `service_id`, `name`, `value`, `infinite_inventory`, `stock` | **oui** (avant : `{id, name}`) |
| `GET /api/v2/available-rooms` | `available_rooms`, `plans[].prices[]`, `restrictions{min_stay,max_stay,lead_days}` | `available_rooms` seul — `restrictions` **non lu** (Lot B) |
| `GET /api/v1/bookings/{id}` | `checkout_realizado`, `total_alojamiento`, `tarifas_por_dia[]`, `descuentos[]`, `ingresos[]`, `cliente`, `grupo[]` | poll + détection de traslado |
| `POST /bookings` · `add-product-service` | écriture | oui |
| `POST /cancel-booking/{id}` | annulation | **non — aucun call site** (Lot B, à re-spécifier) |
| `/rate-plans` · `/channels` · `/documents` · `/customer/{type}` · `/block` · `/occupancy` · `/daily-occupancy` · `/rooms/status` | plans tarifaires, canaux, pièces d'identité, création client, blocage de chambres, occupation + `ADR`/`currency` | **rien** |

**Trois faits qui cadrent toute décision produit :**

1. **Lobby n'a pas de créneaux horaires.** Granularité maximale = la nuit ; un « service » n'a ni
   date ni durée dans `add-product-service`. Les créneaux mañana/tarde sont 100 % internes — c'est
   déjà la raison documentée de l'exclusion de `camp` du sélecteur.
2. **Lobby n'a pas d'objet « hôtel ».** Un jeton = une propriété, et en dessous directement des
   catégories de chambres. **La granularité vendable de Lobby est la catégorie de chambre** — d'où
   la section 4.
3. **Le prix Lobby est quasi dégénéré.** Sondé en live le 2026-07-06 : les trois dortoirs Casa Kayam
   n'exposent un tarif qu'à `people=1`. La règle « Lobby n'est jamais la source du prix » n'est pas
   un choix d'architecture abstrait, c'est une nécessité.

## 3. Parcours front d'un produit lié (Lot A, implémenté)

| Écran | Avant | Maintenant |
|---|---|---|
| Sélection (admin et socio) | une liste `{id, name}`, aucun retour après le choix | carte de prévisualisation : nom, badge Dormitorio/Privada, capacité, nombre de chambres, description, vignettes, numéros de chambres — **chaque champ facultatif**, avec un message explicite si Lobby ne renseigne rien. Bouton « Usar estos datos » qui préremplit nom (si vide), description, capacité **et importe les photos** |

### 3.1 L'import des photos a deux modes, parce que le produit n'existe pas toujours

Retour Jérôme du 2026-08-26 : *« à la proposition il faut les lier les images et autres infos
captées par Lobby »*. Les textes (nom, description, capacité) sont de simples champs de formulaire —
« Usar estos datos » les recopie, et le payload de proposition les transporte déjà : **vérifié sur
une proposition réelle**, `capacity: 2` et `description{es,en}` étaient bien présents.

Les photos, elles, ne se recopient pas : il faut les **télécharger chez Lobby, les décoder et les
réécrire dans Storage**, ce qu'un formulaire navigateur ne sait pas faire. D'où deux modes sur
`POST /api/pms/import-room-photos` :

| Mode | Corps | Qui | Effet |
|---|---|---|---|
| Rattachement | `{productId}` | **admin seul** | écrit dans `product_media` via `add_catalog_media` (produit existant) |
| Mise en attente | `{establishmentId, categoryId, alreadyStaged}` | admin **ou socio propriétaire** | n'écrit **aucune ligne DB** : dépose les fichiers dans Storage et renvoie leurs `storage_path`, rangés dans les photos en attente → voyagent dans `payload.photos[]` → rattachées à l'approbation par `create_product_from_proposal` |

Le mode 2 n'est pas admin-only alors que « Desvincular »/« Actualizar » le sont (arbitrage B) :
ces deux gestes **modifient un lien dont dépendent des réservations**, alors qu'importer les photos
de sa propre catégorie dans sa propre proposition ne touche aucun lien et **n'expose rien de neuf** —
le socio voit déjà ces mêmes URLs dans la carte de prévisualisation. La garde reste « admin **ou**
propriétaire de l'établissement », jamais « authentifié ». Un corps portant `productId` tombe
toujours dans le mode 1 : impossible d'emprunter la garde la plus faible en envoyant les deux.

**Vérifié en préprod le 2026-08-26** sur GLAMPING : 6 photos importées en 5,9 s (plafonnées depuis
les 8 de Lobby par `remainingPhotoSlots`), fichier réellement servi (`image/webp`, ~100 Ko) ;
`alreadyStaged: 6` → `gallery_full`, rien d'importé ; socio étranger → `403 not_authorized` ; socio
sur le mode rattachement → `403` ; `categoryId` en chaîne → `400 invalid_body`.
| Édition admin | ID numérique brut (`lobbyLinkMode` initialisé à `"manual"`) | le **nom**, résolu contre la liste réelle (`"picker"`). `"manual"` reste l'échappatoire admin |
| Édition socio | ⚠️ **le bloc n'était jamais monté** — `EditProposalForm` ne passait pas `establishmentLobbyConnected` | le socio voit le lien et ce que Lobby en sait, en **lecture seule** |
| Description / photos / capacité d'une chambre liée | masquées et vides | éditables et préremplies |
| Photos d'une chambre liée | aucune, ni locale ni importée | bouton « Importar fotos de LobbyPMS » — récupération bornée, pipeline `sharp` existant, nettoyage Storage si l'attachement échoue |
| Modération d'une proposition | description **entièrement cachée** : l'admin validait à l'aveugle | visible |
| Cupos d'un logement PMS-backed | lien vers un calendrier structurellement vide | « La disponibilidad se gestiona en LobbyPMS » |
| Listes socio | rien ne signalait un produit lié | badge « LobbyPMS » |

⚠️ **Diagnostic corrigé par le challenge** : la première version de cet audit attribuait le trou
socio au fait que l'option `"manual"` est absente de la liste du socio. C'est faux —
`allowManualLobbyEntry` n'est faux qu'en **création** socio, où aucun id ne préexiste. La vraie cause
est la prop manquante dans `EditProposalForm`.

**Autres corrections du même lot**, trouvées en auditant :

- **Salve d'e-mails admin.** Un service Lobby vendu sans nuit produisait une entrée
  `pms_reconciliation_entries` **par ligne et par vente**, dont le trigger `notify_all_admins`
  envoie un e-mail à chaque admin, sans dédup — pour une situation que personne ne peut résoudre
  (Lobby refuse la vente de service isolée). Distingué d'un vrai échec de booking, qui lui reste
  une entrée de réconciliation.
- **Note du booking enrichie** (promo, WhatsApp, mail, source) — cf. §10 décision C.
- **Pagination** : le sélecteur déclenchait jusqu'à 20 requêtes Lobby par ouverture ; il s'arrête
  désormais à la dernière page annoncée par `meta.total_pages`.
- **Serveur de fixtures** : `/api/v1/products` et `/cancel-booking/{id}` manquaient — le sélecteur de
  services n'était donc **ni testable ni exerçable en local**.
- **Vigie nocturne** : `pms-nightly-contract-check` signale désormais la disparition des champs dont
  l'écran dépend (`type`, `capacity`, `descriptions[]`, `photos[]`) et les langues non éditables.

## 4. Cible du modèle hébergement — retenue sous conditions

**Décision de Jérôme (2026-08-26)** : l'hôtel devient l'**établissement**, et dortoir / chambre
privée deviennent des **produits vendables** au même niveau qu'une activité. L'étage
`products.type='hotel'` + `product_room_types` disparaît.

**Pourquoi.** Cet étage n'existe ni chez Lobby (propriété → catégories, sans intermédiaire) ni dans
le legacy : `src/config/properties.js` dit en toutes lettres que les `products.type='lodging'` sont
« des TYPES DE COUCHAGE à l'intérieur d'une propriété », rattachés par `provider_id`, sans table
intermédiaire — et c'est le modèle **en production** aujourd'hui. Il duplique par ailleurs
intégralement la branche produit : compteur de capacité, prix par date, médias, `price_tiers`,
`stay_rates`, branche `room_type_id` dans `create_order`, écran de dispo, formulaire client dédié —
~30 fichiers, 8 migrations, tests dédiés. Et `product_room_types.lobby_category_id` est dormante
depuis le 2026-08-16 : en l'état, **un hôtel à chambres ne peut jamais être adossé à un PMS.**

**Conditions à trancher en spec avant d'implémenter** (⚠️ toutes remontées par le challenge) :

- **T1 — prérequis, pas un détail.** Aucune page publique établissement n'existe dans `apps/web`
  (seule route produit : `/[locale]/products/[slug]`). La page produit « hôtel » est aujourd'hui le
  seul écran qui présente le lieu et regroupe ses chambres : il faut la remplacer avant de la retirer.

**T1 LIVRÉ le 2026-08-27** (migrations `20260827200000` / `20260827210000`) :
`/[locale]/establishments/[slug]` existe, présente le lieu (nom, description, adresse, photos,
horaires) et **regroupe ses produits** — logements d'un côté, activités de l'autre. La fiche produit
y renvoie par le nom de l'établissement. `establishments` gagne `slug` (dérivé du nom par trigger,
jamais saisi : le changer casserait une URL déjà partagée), `check_in_time`/`check_out_time` — qui
sont une propriété du LIEU, pas de chaque chambre — et `mode` (`rooms` | `whole_house`), repris de
la v1 où **Bania Travel** se loue déjà entier. `mode` intitule la liste : « Habitaciones » vs
« Alojamiento completo », et `null` (un établissement qui ne vend que des activités) retombe sur un
intitulé neutre plutôt que d'inventer une nature d'hébergement.

⚠️ **Ce que T1 ne couvre PAS**, et qu'il ne faut pas croire fait : les **tags/équipements**
d'établissement — il n'existe aucune table d'affectation (`product_tag_assignments` n'a pas
d'équivalent côté établissement), c'est une tranche à part entière. Et `products.check_in_time`
subsiste : les deux niveaux coexistent, seul celui de l'établissement est publié. La déduplication
appartient à T3, avec le retrait de l'étage `hotel`.
**Première étape livrée le 2026-08-26** : `type='hotel'` est **fermé à la création** — l'option a
été retirée du sélecteur `Tipo` (`product-form.tsx`), qui n'est de toute façon rendu qu'en création.
Déclencheur : l'option apparaissait sur l'écran « créer une activité » alors qu'un hôtel n'est pas
une activité, et surtout un produit `hotel` **ne peut pas être adossé à LobbyPMS**
(`isPmsBacked` = `lodging` + `lobby_category_id`) — le proposer menait donc à un produit qu'on ne
pouvait ensuite pas connecter. Les hôtels existants restent éditables, `product_room_types` et la
branche `room_type` de `create_order` étaient alors **intactes** — T3 les a supprimées depuis, voir
plus bas.

- **T2 — les colonnes sont à créer, pas « déjà présentes ».** `products.unit` est contraint à
  **deux** valeurs (`per_person`, `per_two`) ; `per_house` vient de la v1 et n'existe pas ici. Et
  `products` n'a **aucune** colonne `quantity` (elle vit sur `product_room_types`), donc le garde-fou
  `capacity_exceeds_physical` est à porter.

**Colonnes livrées les 2026-08-26/27** — le constat ci-dessus n'est plus à jour sur ce point précis,
et **seulement** sur ce point :

  - `products.unit_count` (`20260826190000` puis renommée par `20260827100000`) — nombre d'unités du
    type. Renommée depuis `quantity` **parce que `product_room_types.quantity` porte la sémantique
    inverse** (un plafond dur de réservation, lu par `create_order`) : même mot, deux rôles de
    sécurité opposés, dans deux champs éditables côte à côte.
  - `products.lodging_kind` (`20260827120000`) — `dorm | private | whole_house`. **Trois** valeurs :
    `whole_house` n'est pas théorique, la v1 en production porte `mode:'whole_house'` sur Bania
    Travel. Préremplie depuis LobbyPMS pour `dorm`/`private` uniquement — le vocabulaire de Lobby
    n'a que `privada`/`compartida`, donc `whole_house` est **toujours** un choix manuel, et l'écran
    le dit. Descriptive : aucune RPC de commande ne la lit.
  - `products.unit` **étendue à `per_house`** par la même migration, puis rendue **ÉCRIVABLE** par
    `20260827140000` (**C4 fermé le 2026-08-27**) : elle n'était écrite par rien sauf `seed.sql`.
    Aucune conversion automatique depuis Lobby — leurs prix sont par niveau d'occupation, modèle que
    hifago n'a pas ; `proposeLodgingUnit` ne propose que les cas non ambigus et se tait ailleurs. Le
    repli legacy `NULL ⇒ per_person` n'est **pas** porté (il ferait apparaître « por persona » sur
    toutes les fiches existantes d'un coup, y compris là où c'est faux).

  Restent à faire sur T2 : le garde-fou `capacity_exceeds_physical`, et le **`mode` au niveau
  établissement** — la v1 porte `whole_house` sur la *propriété*, pas sur le produit, parce que ça
  répond à une autre question : « cet établissement a-t-il des chambres à choisir, ou se loue-t-il
  entier ? ». T1 en aura besoin : afficher une liste de chambres pour Bania Travel n'aurait aucun
  sens. `lodging_kind` ne le remplace pas.
- **T2 bis — la sémantique de réservation change.** La branche `room_type` de `create_order` ne
  vérifiait **ni** `price_missing` **ni** `date_closed`, contrairement à la branche `lodging` :
  fusionner les deux n'était pas neutre. **Point clos sans migration de données** : il n'existait
  aucun produit `hotel` à fusionner, ni en préprod ni en production. La branche a donc été
  supprimée, pas fusionnée — la sémantique survivante est celle de `lodging`, la plus stricte des
  deux.
- **T3 — effet catalogue.** Après fusion, un hôtel à 12 types produirait **12 cartes** dans le
  catalogue public. **Réglé avant T3** (commit 265749a) : le catalogue regroupe les logements d'un
  même établissement en une seule carte dès qu'il y en a au moins deux, et cette carte renvoie vers
  la page établissement. La condition existait déjà pour les logements ordinaires — T3 ne l'a pas
  créée, il l'a rendue visible.

**T3 LIVRÉ le 2026-08-27, en deux étapes.**

*Étape 1 — l'application* (commit 38c1b55, 36 fichiers, −2 395 lignes). Suppression de l'éditeur de
chambres, de la grille disponibilité chambres×dates, des deux routes `room-availability`, du
formulaire de réservation d'hôtel et de quatre specs e2e ; `ProductType` retombe à cinq valeurs,
`CartLine` perd `roomTypeId`, le filtre du catalogue perd `hotel`.

*Étape 2 — la base* (migration `20260827220000`). Disparaissent : `product_room_types`, `room_media`,
`room_type_availability`, `room_type_date_rates`, `order_lines.room_type_id`,
`set_room_type_availability`, la valeur `'hotel'` de `products.type` et de `product_proposals.type`,
et les branches chambre de **onze** fonctions Postgres. `resolve_date_price` perd son premier
paramètre `p_room_type_id` (changement de signature : ancienne version droppée explicitement).

Les onze fonctions ont été extraites vivantes par `pg_get_functiondef` puis transformées par
remplacements exacts vérifiés en nombre d'occurrences — jamais retapées de mémoire. C'était la
condition posée par le journal du 2026-08-24 pour toucher `create_order` (647 lignes) et
`modify_order_line`.

**Ce que T3 étape 2 ne fait pas** : `products.check_in_time`/`check_out_time` subsistent à côté de
ceux de l'établissement. Les fusionner est une décision de modèle, pas un nettoyage — la
déduplication annoncée plus haut « appartient à T3 » reste donc ouverte.

**Couverture de test conservée, pas perdue.** Deux fichiers ont été *portés* plutôt que supprimés,
parce qu'ils couvraient la réservation par PLAGE DE NUITS — que rien d'autre ne couvre, la branche
alojamiento partageant exactement le même verrouillage nuit par nuit :
`room_type_and_date_range_booking.test.sql` → `date_range_booking.test.sql`, et
`create_order_room_range.concurrency.mjs` → `create_order_date_range.concurrency.mjs` (15 runs
concurrents propres).

## 10. Décisions tranchées / points ouverts

**A — Photos et description d'une chambre PMS-backed → import à la liaison** (2026-08-26). On copie
`descriptions[]`/`photos[]` au moment de choisir la catégorie ; les champs redeviennent éditables.
Complète — sans la contredire — la décision du même jour de « ne pas dupliquer ce que Lobby
fournit » : c'est la moitié « alors afficher ce que Lobby a » qui manquait. **Jamais une moitié sans
l'autre** : rétablir un bloc photos sous une phrase disant « se gestionan allí, no aquí » serait pire
que les deux états cohérents. L'import effectif des fichiers photo est livré
(`POST /api/pms/import-room-photos`, admin-only).

**B — « Desvincular » / « Actualizar » → admin-only** (2026-08-26). Aucune extension de la whitelist
`submit_product_proposal` (`20260817150000`), donc aucune migration et aucune frontière de confiance
déplacée. Évite aussi qu'un socio rompe un lien dont dépendent des réservations en cours.

**C — Note du booking → enrichie pour tous les établissements PMS-backed** (2026-08-26). Lobby n'a
aucun champ email ni téléphone sur une réservation : la note est le seul véhicule, comme en v1.
⚠️ Le challenge a soulevé un conflit avec l'invariant « PII minimale » de `20260817180000` —
**vérification faite, cet invariant avait déjà été levé par Jérôme le 2026-08-19**
(`20260819180000_order_lines_holder_contact_operator.sql` : « Le prestataire a désormais besoin de
contacter son client »). Le partenaire voit déjà ces coordonnées dans ses réservations : les envoyer
à son propre compte Lobby ne lui apprend rien de nouveau. La pièce d'identité (`DOC` de la v1) reste
délibérément exclue.

**Points ouverts, non tranchés ici** : valeur exacte de `orders.status` en cas d'échec PMS
post-confirmation ; traslado ↔ commission hifago ; chiffrement du jeton (spec 21 §10 points 3-5).

## 11. Forme réelle observée en préprod (2026-08-26)

**Observé, plus supposé.** Sonde exécutée le 2026-08-26 sur `hifago-admin-env-staging`, compte réel
« casa kayam test lobby », via `GET /api/pms/lobby-rooms` et `/lobby-services` avec une session
admin. Ce qui suit remplace la liste d'inconnues qui occupait cette section.

### 11.1 `GET /api/v1/rooms` — forme brute confirmée

La doc disait vrai cette fois : **aucun écart** entre la forme documentée et la charge réelle.
`parseLobbyRooms.ts` n'a eu besoin d'aucune correction.

```json
{"data":[{"category_id":29376,"name":"GLAMPING","type":"privada","capacity":2,"quantity":3,
  "descriptions":[{"description":"…","lang":"es"},{"…","lang":"en"},{"…","lang":"pt"},{"…","lang":"fr"}],
  "photos":[{"photo_id":60107,"url":"https://app.lobbypms.com/permanent/uploads/….jpg"}],
  "rooms":[{"id":718411,"name":"EMBERA","type":"privada"}]}]}
```

Couverture réelle sur les 6 catégories du compte : **6/6** portent `type`, `capacity` et `quantity` ;
**4/6** portent `descriptions[]` et `photos[]`.

| `category_id` | Nom | `type` | `capacity` | `quantity` | Descriptions | Photos | `rooms[]` |
|---|---|---|---|---|---|---|---|
| 29376 | GLAMPING | `privada` | 2 | 3 | es, en, pt, fr | 8 | EMBERA, KUNA, ZENU |
| 49823 | CAMPER Van | `privada` | 4 | 2 | — | 0 | Habitación 1–2 |
| 9631 | VIDPOVO | `compartida` | 1 | 8 | es, en, pt, fr | 4 | Cama 1–8 |
| 36572 | GUSTO | `compartida` | 1 | 6 | es, en, pt, fr | 6 | Cama 1–6 |
| 9629 | AUDO | `compartida` | 1 | 4 | es, en, pt, fr | 4 | Cama 1–4 |
| 18013 | STAFF | `compartida` | 1 | 12 | — | 0 | Cortesía, Jérôme & Loren, Staff 1–7, Cuenta por pagar ×3 |

### 11.2 Ce que ça tranche

> **Conséquence retenue le 2026-10-23 (spec 21 §8.2).** Que 49823 et 18013 soient annoncées libres
> puis refusées en 422 avait fait écrire chez Lobby AVANT le paiement (2026-08-29). Ce choix laissait
> un booking vivant sur tout paiement refusé. Gabriel a tranché : le booking se crée APRÈS l'acompte,
> et le risque devient un 422 APRÈS paiement — la commande payée va alors dans la file « à traiter »
> (reloger ou rembourser à la main, aucun remboursement automatique). Le fait ci-dessous (C1 réfuté)
> reste vrai ; seul le moment où on le découvre change.

- **`capacity` × `quantity` a une sémantique nette**, et elle valide la section 4 : `capacity` =
  occupants **d'une unité**, `quantity` = **nombre d'unités**. Un dortoir est `capacity: 1` (une
  personne par lit) × `quantity: 8` (huit lits) ; une privée est `capacity: 2` × `quantity: 3`
  (trois chambres). C'est exactement le couple `lodging_kind` + `quantity` de **T2** — Lobby modélise
  déjà « chambre = produit vendable », sans étage hôtel intermédiaire.
- **`type` est en espagnol** : `privada` / `compartida`. `normalizeLobbyRoomKind` les mappe
  correctement vers `private` / `dorm`.
- **Codes `lang` réels : `es`, `en`, `pt`, `fr`** (inconnue n°3 close). L'éditeur hifago étant fermé
  à `es`/`en`, `pt` et `fr` sont **ignorés à l'import** et signalés à l'écran
  (`unsupportedLangs: ["fr","pt"]`). Comportement voulu, pas une perte silencieuse.
- **`photos[].url` pointe sur `app.lobbypms.com/permanent/uploads/…`** — l'hôte est bien celui que
  `fetchLobbyPhoto.ts` autorise. Aucune redirection observée.
- **C1 reste ouvert, mais avec un indice.** Parmi les catégories présentes, les quatre réservables
  par API (9631, 36572, 9629, 29376) portent **toutes** description + photos ; les deux qui
  refusent en `422` (49823, 18013) n'en portent **aucune**. 17998 et 51636 n'apparaissent plus du
  tout dans la liste. **Corrélation, pas attribut** : rien dans la charge utile ne dit
  « réservable ». Filtrer sur « a des photos » serait un proxy fragile — le sélecteur continue
  d'**informer sans filtrer**.

### 11.3 `GET /api/v1/products` (services) — et la conclusion qui compte

14 services renvoyés, tous de la forme `{service_id, name, value, infinite_inventory: true,
stock: null}`. **Un service Lobby ne porte ni photo, ni capacité, ni quantité, ni description** :
ces champs n'existent pas sur cette ressource. Aucun compte, si bien rempli soit-il, n'en fournira.

> ⚠️ **Piège de parcours, constaté en vrai.** Lier une **activité** à un **service** ne peut rien
> rapatrier d'autre qu'un nom, un prix indicatif et un stock. Photos, capacité et nombre d'unités
> ne viennent que de `GET /rooms`, donc **uniquement pour un Alojamiento lié via
> `lobby_category_id`**. L'écran doit le dire, sinon l'utilisateur conclut à un import cassé alors
> que la ressource n'a simplement pas ces champs.

### 11.4 Sur le relais Vultr

L'environnement Vercel `staging` ne définit **pas** `LOBBY_RELAY_SECRET`, et
`LOBBY_API_BASE_URL = https://api.lobbypms.com` (l'API directe). La préprod appelle donc Lobby
**sans passer par le relais**, et ça fonctionne. La contrainte réelle n'est pas l'IP : c'est que
**seule la base préprod porte un vrai jeton** (`lobby_api_token` de 60 caractères, contre 15 pour le
jeton factice du seed). À rectifier dans les notes qui affirment le contraire.

### 11.5 Restant à observer

- Valeurs réelles de `restrictions{min_stay, lead_days}` sur `/api/v2/available-rooms` — tous les
  exemples documentés sont à `0` (Lot B, C5).
- Forme de `GET /rate-plans`, documentée nulle part.
- L'attribut qui sépare réellement une catégorie réservable par API (C1) — cf. 11.2.

## 12. Documents liés

- [`21-connecteur-lobbypms.md`](21-connecteur-lobbypms.md) — le connecteur, ses invariants, la file
  de réconciliation.
- [`13-admin-hotel-habitaciones.md`](13-admin-hotel-habitaciones.md) — l'étage hôtel→chambres que la
  section 4 propose de retirer.
- [`14-admin-transporte.md`](14-admin-transporte.md) — amendée le 2026-08-26 (le transport est
  désormais rattachable à un service Lobby).
- `hifago/docs/00-modele-de-donnees.md` §1/§2 — le gap « hôtel à chambres sans PMS ».
- Racine du dépôt : `docs/3-integrations/lobby_pms_api.md`, `docs/2-reference/06-lobbypms.md`,
  `src/config/properties.js` (le modèle legacy en production).
