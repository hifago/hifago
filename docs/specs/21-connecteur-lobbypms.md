---
id: specs-connecteur-lobbypms
titre: "Connecteur LobbyPMS — contrat générique multi-prestataire"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: partiel
reste: >
  Tranche 1 implémentée le 2026-08-19, disponibilité live côté client comblée le 2026-08-21 (voir
  § Implémentation en fin de document). §10 points 3-5 non tranchés (traslado↔commission,
  orders.status en échec PMS post-confirmation, chiffrement du token) — cf. docs/backlog.md.
maj: 2026-08-21
resume: >
  Porte le connecteur LobbyPMS (aujourd'hui unique voie legacy pour Casa Kayam) vers un
  contrat générique multi-prestataire dans hifago — disponibilité/prix par nuit, création de
  booking, miroir d'activité, poll automatique et file de réconciliation déjà scaffoldée.
mots_cles: [lobbypms, pms, connecteur, disponibilité, booking, réconciliation, alojamiento, casa kayam]
repond_a:
  - "Comment le connecteur LobbyPMS générique se branche-t-il sur le nouveau stack hifago ?"
  - "Quel est le contrat RPC/API pour la disponibilité, la création de booking et le miroir d'activité PMS ?"
  - "Qu'est-ce qui existe déjà (scaffolding dormant) et qu'est-ce qui reste à construire ?"
---

> **Amendement daté du 2026-08-27 — l'étage hôtel a été supprimé.** `products.type='hotel'`,
> `product_room_types`, `room_media`, `room_type_availability`, `room_type_date_rates`,
> `order_lines.room_type_id` et `set_room_type_availability` n'existent plus (T3 de la spec 24 :
> application par le commit 38c1b55, base par la migration `20260827220000`). Une chambre est
> désormais un produit `type='lodging'` à part entière. **Toute mention de `room_type`,
> `product_room_types` ou d'une « branche chambre » ci-dessous décrit un état passé** ; le mécanisme
> équivalent vit sur `products`/`product_availability`. Détail et raisons : `docs/specs/24-modele-
> hebergement-et-surface-lobbypms.md` §4, et le bandeau de `docs/specs/13-admin-hotel-habitaciones.md`.

> ⚠️ Spécifique à cette spec : les colonnes `product_room_types.lobby_category_id` /
> `lobby_product_id`, restées dormantes depuis leur création, ont disparu avec la table. Le
> lien vers Lobby vit uniquement sur `products.lobby_category_id`.

# Connecteur LobbyPMS — contrat générique multi-prestataire

> **Cible stack** : hifago. **Feature n°32** (indicatif — numérotation séquentielle partagée
> entre sessions parallèles, à reconfirmer au moment de l'implémentation, cf.
> `hifago/AGENTS-PARALLELES.md`).

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (API/RPC, modèle de données, invariants, cas limites — pour coder) | implémenté |
| 1 | Contexte et problème | implémenté |
| 2 | Portée | implémenté (Tranche 1) |
| 3 | Décisions retenues | implémenté |
| 4 | Parcours cible | implémenté (disponibilité live côté client comblée le 2026-08-21) |
| 5 | Écran(s) | implémenté |
| 6-9 | *(fusionnées dans 0)* | — |
| 10 | Décisions tranchées / points ouverts | **tranché par Jérôme le 2026-08-19 (périmètre complet, jeton en clair RPC-only, poll 15 min/lot 20) — voir § Implémentation** |
| 11 | Annexe — traçabilité code→règle | implémenté |
| 12 | Documents liés | implémenté |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Jobs planifiés (Edge Function + pg_cron/pg_net)

| Job | Fréquence | Rôle |
|---|---|---|
| `pms_poll_bookings` | Toutes les N min (§10 — à trancher) | Pour chaque établissement PMS-backed actif : relit chaque booking connu, détecte annulation (404) et traslado, met à jour `order_lines`/déclenche réconciliation. Remplace le mécanisme d'import CSV manuel legacy (le complète, ne le supprime pas — cf. §3). |
| `pms_nightly_contract_check` | 1×/nuit, non bloquant CI | Frappe le **vrai compte Casa Kayam** (aucun sandbox LobbyPMS n'existe, cf. §10 point 1) en lecture seule (`GET /rooms`, `GET /available-rooms`), compare la forme de réponse aux fixtures enregistrées, alerte sur dérive de contrat. |

### RPC / Route Handlers

| Nom | Type | Rôle |
|---|---|---|
| `create_order` (existant, à étendre) | RPC `SECURITY DEFINER` | Pour une ligne dont le produit est PMS-backed (`isPmsBacked`, cf. ci-dessous) : **ne verrouille ni ne décrémente `product_availability`** (Lobby est source de vérité) — insère `order_lines` avec un statut provisoire, sans appel réseau dans la transaction. Skeleton anti-survente réutilisé tel quel (`hifago/docs/05-reference-technique.md`) pour les lignes NON PMS-backed de la même commande. |
| `POST /api/pms/reserve-nights` (nouveau, Route Handler `service_role`) | Séquentiel, hors transaction Postgres | Appelé juste après un `create_order` réussi contenant au moins une ligne PMS-backed. Pour chaque établissement PMS-backed de la commande (une commande peut en contenir plusieurs, cf. §3) : relit dispo fraîche Lobby → `POST /bookings` → si activité éligible (provider avec connecteur actif + `lobby_product_id` renseigné) → `POST /booking/add-product-service`. Échec à n'importe quelle étape → insert dans `pms_reconciliation_entries` (**déjà scaffoldé**, migration `20260814210000`) + `orders.status='needs_reconciliation'` (proposé, §10 point 4) — jamais un rollback de la commande déjà confirmée côté portail. |
| `test_pms_connection` (nouveau, Route Handler admin `service_role`) | Ponctuel, écran établissement | `GET /rooms?api_token=…` avec le token saisi, avant activation — ne persiste rien si l'appel échoue. |
| `resolve_reconciliation_entry` (existant, feature 22) | RPC | **Aucune modification** — déjà livré, cette spec l'alimente enfin en écritures réelles. |

### Modèle de données (delta)

| Table | Colonne | Type | Note |
|---|---|---|---|
| `establishments` | `lobby_api_token` | `text`, nullable | **Nouveau.** Un jeton par établissement, jamais un jeton global (`process.env.LOBBY_API_TOKEN` legacy). Chiffrement/masquage en lecture admin — cf. §10 point 5. |
| `establishments` | `lobby_connector_active` | `boolean not null default false` | **Nouveau.** Miroir du `providers.lobby_connector` legacy, mais par établissement plutôt que par prestataire (un prestataire peut avoir plusieurs établissements, un seul PMS-backed). |
| `establishments` | `lobby_last_synced_at` | `timestamptz`, nullable | **Nouveau.** Horodatage du dernier poll réussi — affiché à l'écran §5. |
| `products` | `lobby_category_id`, `lobby_product_id` | `int`, nullable | **Déjà là** (migration `20260813190232_catalog_core_tables.sql`), jamais exposé à l'écran ni consommé par un appel réseau — cette spec les branche. |
| `product_room_types` | `lobby_category_id`, `lobby_product_id` | `int`, nullable | **Déjà là** (migration `20260816110000_product_hotel_rooms.sql`, spec 13), **hors périmètre de cette spec** (Tranche 2 — aucun établissement hôtel PMS-backed réel aujourd'hui, cf. §2). |
| `order_lines` | `pms_booking_id` | `text`, nullable | **Nouveau.** Identifiant `booking_id` renvoyé par Lobby (`response.body.booking.booking_id` — jamais `data[].idBooking`, piège confirmé v1). Permet le poll et l'annulation ciblée. |
| `pms_reconciliation_entries` | — | — | **Déjà là** (migration `20260814210000`), table, RLS, RPC de résolution et hooks de transfert (`modify_order_line`) déjà livrés et testés (pgTAP `pms_reconciliation.test.sql`) — réutilisée telle quelle, aucune modification de schéma. |

### Invariants

- `isPmsBacked(product)` = `product.type === 'lodging' && product.lobby_category_id != null` (établissement `rooms` mode) — port 1:1 de `catalogService.isPmsBacked` v1, aucune généralisation nécessaire (déjà générique, aucun nom de prestataire en dur).
- Le miroir d'activité PMS est **générique par construction** dès cette spec (jamais `if provider.id === 'kayam'`) : toute activité d'un établissement dont `lobby_connector_active=true`, avec `lobby_product_id` renseigné, se rattache au booking de **sa propre** propriété dans la commande — lève la limitation §5 client cahier des charges (nom en dur legacy).
- Disponibilité PMS-backed toujours relue **à chaud** au moment de réserver — jamais depuis un cache, même court (cache 60 s autorisé uniquement pour l'affichage, comme v1 `nightAvailability(..., {cache:true})`).
- Un échec PMS (réseau, 4xx/5xx Lobby, contrat API divergent) **ne bloque jamais** la réservation déjà validée côté portail — traité par la file de réconciliation, jamais un rollback de commande confirmée (règle générale §3f du cahier des charges, échec fermé uniquement **avant** confirmation, jamais après).
- `rates_per_day[].price` envoyé à Lobby est le tarif **déjà net** (remise appliquée, quantité encodée) — Lobby ne multiplie jamais par occupants ni n'applique de remise propre (piège confirmé v1, §5 cahier des charges).
- Un établissement sans connecteur actif (`lobby_connector_active=false`) suit exactement le chemin `product_calendar`/`product_availability` interne existant — zéro changement de comportement pour Bania et tout établissement non-PMS.
- Toute table/fonction touchée par cette spec qui décrémente une capacité reste RPC-only (checklist `hifago/CLAUDE.md` §3) — le connecteur PMS lui-même **ne décrémente jamais** `product_availability` pour une ligne PMS-backed (Lobby est la seule source de vérité de capacité pour ces lignes).

### Cas limites

| Situation | Traitement attendu |
|---|---|
| `POST /bookings` échoue après que `create_order` a déjà confirmé la commande | `pms_reconciliation_entries` (open) + `orders.status='needs_reconciliation'` (§10.4) — jamais de rollback commande. |
| Catégorie de chambre non réservable par API (`422 INPUT_PARAMETERS`) | Erreur anticipée, pas un cas rare (§5 cahier des charges) — mappée en entrée de réconciliation, jamais une 500 générique. |
| Changement de chambre fait par le staff Lobby (traslado) | Détecté par le job de poll (`total_alojamiento=0` sur la résa d'origine + nouvelle résa sans `descuentos`) — reconstruction identique au mécanisme v1 (§10.2 — port direct, pas de redesign). |
| Annulation d'un booking avec activité déjà attachée | `422 RESTRICTED_RESERVATION` — jamais retenté automatiquement, nettoyage manuel Lobby signalé dans la fiche réconciliation (comportement v1 inchangé, limite Lobby elle-même). |
| Commande multi-établissements dont plusieurs PMS-backed (client §3e) | Chaque établissement traité **indépendamment** dans `POST /api/pms/reserve-nights` (sa propre dispo, son propre booking, ses propres activités) — jamais un "booking principal" supposé unique (généralisation explicitement demandée §5 cahier des charges, absente du code v1). |
| Job de poll tombe sur un établissement dont le token est révoqué/invalide côté Lobby (401) | Ne bloque pas les autres établissements du lot — erreur isolée par établissement, consignée, alerte si répétée (cf. supervision relais réseau, architecture cible). |
| Nightly contract-check détecte une forme de réponse divergente | Alerte non bloquante (job séparé, jamais un gate de PR) — cf. §10.1 sur l'absence de sandbox réel. |

### Fichiers touchés

- **Nouveau** : `packages/domain/src/pms/` (interface générique + implémentation LobbyPMS — disponibilité, création booking, miroir activité), `apps/admin/app/api/pms/reserve-nights/route.ts` (jamais créé — la réservation PMS passe par `create_order`, branche `isPmsBacked`), `apps/admin/app/api/pms/test-connection/route.ts`, écran établissement (bloc connecteur PMS), Edge Functions `pms_poll_bookings`/`pms_nightly_contract_check`.
- **Étendu** : `create_order` (branche `isPmsBacked`), formulaire établissement admin, formulaire produit `lodging`/`hotel` (exposition des champs `lobby_category_id`/`lobby_product_id` déjà en base).
- **Traçabilité legacy** (source de portage, jamais copiée telle quelle — port vers Postgres/TS) : `src/services/portalService.js` (`reserve`, `nightAvailability`, `getAvailability`), `src/services/catalogService.js` (`isPmsBacked`), `src/controllers/lobbyController.js` (`importFromLobby`, logique de traslado/héritage promo — **non portée**, remplacée par le poll automatique + réconciliation générique, cf. §10.3), `docs/3-integrations/lobby_pms_api.md` (legacy, dépôt parent) (référence API).

---

## 1. Contexte et problème

Casa Kayam est aujourd'hui le **seul** établissement PMS-backed du produit (`provider_id='kayam'`,
`providers.lobby_connector=1`), et l'intégration legacy fonctionne réellement en production —
**vérifié en direct pendant l'écriture de cette spec** : `GET /api/portal/availability` sur le
site en prod (`kayam-partner-portal.fly.dev`, catégorie VIDPOVO `9631`, 2026-08-25) renvoie une
réponse `200` avec dispo et prix réels lus depuis LobbyPMS (`8` places à `42000` COP), confirmant
que le token/l'IP whitelistée/le contrat API sont toujours valides à ce jour (2026-08-19).

Côté hifago, **rien n'est encore branché**, mais une part significative du travail de conception a
déjà été faite et jamais exploitée (même schéma de découverte que `00-modele-de-donnees.md` pour
le legacy) :
- `products.lobby_category_id`/`lobby_product_id` existent depuis la migration
  `20260813190232_catalog_core_tables.sql`, jamais exposés à l'écran ni lus par un appel réseau ;
- `product_room_types.lobby_category_id`/`lobby_product_id` existent depuis la migration
  `20260816110000_product_hotel_rooms.sql` (spec 13), avec le commentaire explicite « anticipe le
  rattachement LobbyPMS... pour une Tranche 2 » ;
- la **file de réconciliation PMS complète** (table `pms_reconciliation_entries`, RLS, RPC
  `resolve_reconciliation_entry`, écran admin, hooks de transfert dans `modify_order_line`) a été
  livrée sous « Feature 22 » (migration `20260814210000`) et testée (pgTAP
  `pms_reconciliation.test.sql`) — **mais rien n'y insère jamais une ligne**, faute de connecteur
  qui en produirait.

Le cahier des charges client §5 a déjà validé (2026-08-11) le contrat fonctionnel cible — un
connecteur PMS générique, LobbyPMS en étant la première implémentation — et l'architecture cible
(§ Jobs planifiés et connecteur PMS, § Environnements) a déjà tranché le pattern d'exécution
(table-file + `pg_cron`/`pg_net` + Edge Function) et un point dur d'infrastructure (IP de sortie
stable, relais réseau auto-hébergé). Cette spec raffine ces décisions déjà actées jusqu'au niveau
prêt à coder, sans les rouvrir — **et signale un fait nouveau découvert en préparant cette spec**
qui affecte directement la stratégie de test déjà validée (§10 point 1).

Le déclencheur immédiat : « connecteur LobbyPMS » figure dans le backlog ouvert de hifago depuis
plusieurs sessions (`docs/backlog.md`, avant cette spec) sans jamais avoir été raffiné en spec.

## 2. Portée

**In (Tranche 1 — parité fonctionnelle Casa Kayam, construite générique dès le départ)** :
- Disponibilité/prix par nuit lus à chaud, création de booking, pour un produit `type='lodging'`
  en mode `rooms` (le seul cas réel aujourd'hui).
- Miroir d'activité générique (toute activité d'un établissement PMS-backed avec mapping renseigné
  — lève la limitation « un seul prestataire nommé en dur » du legacy, cf. §5 cahier des charges).
- Commande multi-établissements PMS-backed traitée établissement par établissement (deuxième
  limitation levée, cf. §5 cahier des charges) — même si Casa Kayam reste aujourd'hui le seul cas
  réel pour la valider en conditions réelles.
- Poll régulier automatique (remplace/complète l'import CSV manuel — décision déjà actée §5 cahier
  des charges) qui alimente enfin `pms_reconciliation_entries`.
- Écran admin d'activation/configuration du connecteur par établissement (jeton, test de
  connexion) et exposition des champs `lobby_category_id`/`lobby_product_id` déjà en base dans le
  formulaire produit.
- Stratégie de test : fixtures Nock/MSW (déjà décidées) + job nocturne non bloquant contre le
  **compte réel Casa Kayam** faute d'alternative (§10 point 1).

**Out (renvoyé explicitement)** :
- Hôtel à chambres multiples PMS-backed (`product_room_types`, spec 13 Tranche 2) — colonnes
  dormantes déjà posées, mais aucun établissement hôtel réel n'a de PMS aujourd'hui ; brancher
  cette voie sans un cas réel pour la valider serait spéculatif.
- Un deuxième PMS réellement différent de LobbyPMS — le contrat générique est **conçu** pour, mais
  rien à implémenter/tester tant qu'aucun établissement n'en a un.
- Synchronisation iCal pour un établissement sans PMS (canaux externes type Booking.com/Airbnb) —
  explicitement listé comme « cible future importante, pas à implémenter dans ce premier
  périmètre » par le cahier des charges lui-même.
- Provisioning effectif du relais réseau (Hetzner CX22 ou équivalent) — décision d'architecture
  déjà actée, mais c'est une tâche d'infrastructure (achat/durcissement/supervision d'une machine),
  pas du code applicatif ; **prérequis bloquant pour tout déploiement préprod/prod réel de cette
  spec**, sans impact sur le développement local (fixtures, 401 attendu en local comme aujourd'hui).
- Reprise à l'identique de la logique de traslado/héritage de promo par CSV (`findHostelPromoCode`,
  fenêtres de dates ±1 jour) : le **mécanisme de détection** (traslado = `total_alojamiento=0` +
  nouvelle résa) est repris, mais son branchement à la commission/l'attribution partenaire legacy
  ne s'applique pas telle quelle au nouveau moteur de commission hifago (17/10/7, ledger) — à
  raffiner séparément si un cas réel se présente (§10 point 3).

## 3. Décisions retenues

- **Connecteur optionnel par établissement, contrat générique** (§5 cahier des charges, validé
  2026-08-11) — pas une dépendance globale du portail, pas un lien en dur à LobbyPMS dans le reste
  du code.
- **Pattern d'exécution des jobs** (architecture cible, § Jobs planifiés) : table Postgres
  faisant office de file (`pms_reconciliation_entries`, déjà livrée) + `pg_cron`/`pg_net` +
  Edge Function, `SELECT ... FOR UPDATE SKIP LOCKED` pour le traitement par lot — jamais Fly ni un
  service tiers de jobs.
- **Relais réseau minimal auto-hébergé** pour l'IP de sortie stable exigée par LobbyPMS
  (architecture cible, § Environnements) — reverse-proxy authentifié, une instance par
  environnement (préprod/prod), supervision santé obligatoire dès le premier périmètre.
- **Stratégie de test** (architecture cible, § Tests et CI/CD) : fixtures enregistrées (Nock/MSW)
  pour les PR, job nocturne séparé non bloquant contre « le vrai sandbox LobbyPMS » — **decision
  reprise ici avec une correction factuelle, cf. §10 point 1**.
- **Skeleton anti-survente** (`hifago/docs/05-reference-technique.md`) réutilisé tel quel pour
  toute ligne non PMS-backed de la même commande — aucune réinvention.
- **Schéma dormant déjà posé, réutilisé sans modification** : `products.lobby_category_id`/
  `lobby_product_id`, `pms_reconciliation_entries` + `resolve_reconciliation_entry` + hooks de
  transfert dans `modify_order_line` (feature 22).
- **Précédent legacy confirmant le modèle cible** : `providers.lobby_api_token TEXT` existe déjà
  dans le schéma SQLite v1 (`001_init.sql`) mais n'a jamais été branché — Casa Kayam utilise
  toujours la variable d'environnement globale `LOBBY_API_TOKEN` « au pilote » (commentaire du
  code source). Confirme que « un jeton par établissement plutôt qu'un jeton global » est la bonne
  cible (cohérent avec `00-modele-de-donnees.md`), pas une invention de cette spec.

## 4. Parcours cible

1. **Activation (admin)** — sur la fiche d'un établissement, l'admin ouvre le bloc « Connecteur
   PMS », saisit le jeton LobbyPMS, clique « Tester la connexion » (`GET /rooms`, sans persister si
   échec), puis active `lobby_connector_active`.
2. **Mapping produit (admin/socio, selon qui gère le catalogue de cet établissement)** — le champ
   `lobby_category_id` (déjà en base) devient éditable dans le formulaire du produit `lodging`
   correspondant ; `lobby_product_id` pour une activité destinée à être reflétée.
3. **Poll automatique** — toutes les N minutes (§10.6), pour chaque établissement actif : relit
   chaque booking connu (`order_lines.pms_booking_id` non nul, fenêtre glissante), détecte
   annulation (404) et traslado, met à jour l'état, alimente `pms_reconciliation_entries` en cas
   d'anomalie. Complète (ne remplace pas) l'import manuel existant, comme déjà décidé §5 cahier des
   charges.
4. **Réservation client** — parcours checkout inchangé côté client. Côté serveur :
   `create_order` insère les `order_lines` (transaction Postgres unique, comme aujourd'hui) —
   pour une ligne PMS-backed, aucun verrou/décrément `product_availability` (Lobby fait foi).
   Immédiatement après confirmation, `POST /api/pms/reserve-nights` : relecture fraîche dispo →
   `POST /bookings` par établissement PMS-backed concerné → miroir d'activité si éligible.
5. **Échec PMS à une étape** — la commande reste confirmée côté portail ; une entrée
   `pms_reconciliation_entries` (`status='open'`) est créée, `orders.status` reflète le besoin
   d'attention (§10.4) ; l'admin la résout depuis l'écran déjà livré (feature 22).
6. **Contrôle de dérive de contrat** — job nocturne séparé, non bloquant, contre le compte réel
   Casa Kayam (lecture seule) : compare la forme des réponses aux fixtures enregistrées, alerte si
   divergence (comportement Lobby déjà documenté comme non garanti par sa propre doc officielle).

## 5. Écran(s)

- **Fiche établissement (admin)** — nouveau bloc « Connecteur PMS » : toggle actif/inactif, champ
  jeton (masqué à l'affichage, jamais renvoyé en clair après saisie), bouton « Tester la
  connexion », dernière synchronisation réussie (`lobby_last_synced_at`).
- **Formulaire produit `lodging`/futur `hotel`** — exposition des champs `lobby_category_id`
  (et `lobby_product_id` pour une activité) déjà en base mais « non exposés à l'écran » à ce jour.
- **File de réconciliation PMS (admin)** — **déjà livrée** (feature 22), aucune modification
  d'écran nécessaire ; cette spec la fait enfin recevoir de vraies entrées.

## 6. Modèle de données

Voir §0 pour le delta compact. Justification des trois nouvelles colonnes `establishments` : un
jeton par **établissement** (pas par prestataire, contrairement au `providers.lobby_api_token`
legacy) — nécessaire parce qu'un prestataire hifago peut posséder plusieurs établissements dont un
seul PMS-backed (`02-cahier-des-charges-socio.md`), alors qu'en v1 « prestataire » et
« établissement » étaient confondus. `order_lines.pms_booking_id` : nécessaire pour que le job de
poll et une éventuelle annulation ciblent le bon booking sans recalculer une correspondance à
chaque fois (le legacy s'appuie sur l'import CSV complet à chaque fois, plus coûteux).

## 7. Contrat API/RPC

Voir §0. Le point notable est l'**absence** de RPC Postgres unique pour l'appel Lobby lui-même :
contrairement à l'invariant anti-survente (une seule fonction RPC, un aller-retour), un appel
HTTP sortant vers un tiers ne peut pas vivre dans une transaction `plpgsql` bloquante de façon
fiable — le pattern retenu (Route Handler `service_role`, séquentiel, **après** la confirmation
`create_order`) est le même que celui déjà utilisé pour Mercado Pago (`create_payment_intent` RPC
→ `POST /api/payments/create` → redirection, spec 19) : cohérent avec un précédent déjà validé sur
ce projet, pas une invention.

## 8. Règles et invariants

Voir §0. Point notable additionnel : la règle **« échec fermé partout »** (`hifago/CLAUDE.md` §4.4)
s'applique **avant** la confirmation de la commande (ex. dispo insuffisante détectée à la relecture
fraîche → `409`, jamais une réservation), mais **pas après** — une fois `create_order` confirmé,
un échec PMS ne défait jamais la réservation déjà accordée au client (règle générale §3f du cahier
des charges : statut d'intégration séparé du statut métier). Les deux règles semblent en tension
si on les lit isolément ; elles ne le sont pas : l'échec fermé protège contre la survente
**avant** l'engagement, la réconciliation protège l'expérience client **après**.

### 8.1 Réordonnancement du 2026-08-29 — Lobby est réservé AVANT confirmation

**Le code violait ce §8 en silence.** La séquence de `CheckoutForm.tsx` était `create_order` (qui
CONFIRME) → `void reserve-nights` → `void startPayment` : la réservation PMS partait *après* la
confirmation, sans être attendue, et le paiement démarrait sans elle. « Échec fermé uniquement
avant confirmation » était donc inapplicable — il n'existait aucun instant, sur ce chemin, entre la
lecture de Lobby et l'engagement.

**Le fait qui a tranché** (§11.2 de la spec 24) : deux catégories du compte réel (`49823`, `18013`)
refusent `POST /bookings` en **422** tout en affichant une disponibilité **non nulle**, et C1 est
**réfuté** — `available-rooms` les cote exactement comme les autres, aucune charge utile ne dit
« réservable ». Aucune lecture préalable ne peut donc prédire le refus : **seul l'appel d'écriture
le révèle**. Conséquence observée : le client payait ses 17 %, hifago confirmait, et le partenaire
ne recevait rien — sans même une annulation à compenser, puisque rien n'avait été créé.

**Séquence en vigueur** : `create_order` → `await reserve-nights` → confirmation affichée →
`startPayment`. Sur refus d'une **nuit**, `release_order_after_pms_refusal` (migration
`20260829100000`) défait la commande : lignes en `cancelled_by_provider`, places non-PMS **rendues**,
blocages de camp retirés, ledger neutralisé, et les bookings frères déjà créés partent en file
d'annulation via le trigger existant. Rien n'est encaissé, le panier est conservé.

**Trois asymétries à ne pas confondre :**

1. **Une nuit refusée défait la commande ; une activité refusée ne la défait pas.** La nuit est
   réelle chez le partenaire — l'annuler parce qu'un extra a échoué coûterait au client son
   logement. L'activité garde donc l'ancien chemin (`pms_reconciliation_entries`).
2. **Cette fonction rend les places, alors que `cancel_order` refuse de le faire.** Ce n'est pas une
   incohérence : `cancel_order` garde la place consommée **exprès** (cahier des charges client
   §7/A3, « en compensation du créneau bloqué pour rien »). Ici personne n'a rien immobilisé — la
   réservation n'a jamais existé, il n'y a aucune compensation à devoir.
3. **`create_order` n'est pas modifiée.** Elle reste la barrière anti-survente du chemin **non-PMS**
   (verrou `for update` + décrément), que les lignes PMS-backed sautent depuis `20260819130000`.
   Réordonner le PMS ne devait pas déplacer une ligne de ce chemin-là.

**Reste vrai après ce lot** : la réconciliation garde son rôle pour les échecs qui surviennent
*après* un encaissement réussi (`pms-poll-bookings`, annulations) et pour le seul cas où le
relâchement lui-même échoue — là, une commande reste pendante et un humain est nécessaire ; le
filet est `expire_stale_payment_orders` (30 min).

## 9. Cas limites

Voir §0.

## 10. Décisions tranchées / points ouverts

**Point 1 — Aucun sandbox LobbyPMS ne semble exister (fait nouveau, corrige une prémisse de
l'architecture cible déjà validée).** `hifago/docs/04-architecture-cible.md` (§ Tests et CI/CD)
prévoit un job nocturne qui « frappe le vrai sandbox LobbyPMS ». Recherche menée pour cette spec
(documentation officielle LobbyPMS, support Lobby) : **aucune mention d'un environnement
sandbox/test séparé de la production** — chaque établissement a un unique token lié à son compte
réel ; LobbyPMS propose un **essai gratuit de 15 jours** pour un nouvel hôtel/hostel (compte
commercial de démonstration, pas un bac à sable API pérenne), et un « Connectivity Agreement » à
demander au support Lobby pour un développeur multi-propriétés — rien qui ressemble à un sandbox
API self-service. **Signalé, pas corrigé silencieusement** (règle du projet) : à valider avec
Jérôme — soit (a) le job nocturne frappe le compte réel Casa Kayam en **lecture seule** (probes
`GET /rooms`/`GET /available-rooms`, jamais d'écriture), ce qui est déjà ce que fait le code v1 en
diagnostic, soit (b) Jérôme contacte le support LobbyPMS pour clarifier l'existence d'un vrai
environnement de test avant d'écrire ce job. Cette spec part de l'hypothèse (a) par défaut mais ne
la tranche pas définitivement.

**Point 2 — Tester des écritures réelles (`POST /bookings`, `add-product-service`) nécessite de
toucher le compte réel Casa Kayam, jamais un compte de test.** Conséquence directe du point 1 :
valider en conditions réelles la création de booking, le rattachement d'activité et l'annulation
ne peut se faire que sur le compte réel (comme le legacy l'a déjà fait, ex. booking `20873561`
« TESTLIVE » documenté dans `lobby_pms_implementation.md`). Chaque session de test manuel doit
suivre le même protocole que le legacy — créer un booking identifiable (ex. note contenant
`TESTLIVE`), l'annuler immédiatement si aucun produit n'y a été attaché, **jamais automatisé en
CI**, jamais sans accord explicite de Jérôme au moment de le faire (cohérent avec
`hifago/CLAUDE.md` §8.3 : toute ressource cloud réelle nécessite une confirmation à chaque fois).

**Point 3 — Traslado et héritage de code promo par CSV, non repris tel quel.** Le mécanisme de
**détection** du traslado (`total_alojamiento=0` + nouvelle résa sans `descuentos`) est repris
(cf. §0 cas limites), mais son branchement à l'attribution de commission par correspondance de
`descuentos[].descripcion` ne correspond plus au modèle hifago (code partenaire déjà attribué à la
commande dès sa création, pas reconstruit après coup depuis Lobby). Comment un traslado affecte-t-il
une commande hifago déjà commissionnée ? Pas tranché ici — à creuser avec Jérôme si/quand un vrai
traslado se produit en prod sur hifago (aucun antécédent aujourd'hui, hifago n'étant pas encore en
prod).

**Point 4 — Valeur exacte de `orders.status` en cas d'échec PMS post-confirmation, non
confirmée.** Proposé par défaut : `'needs_reconciliation'` (`orders.status` est un `text` libre,
sans `CHECK`, contrairement à `order_lines.status` — aucune migration de contrainte nécessaire).
Mais `orders.status` est un champ potentiellement déjà lu ailleurs (moteur de commission, écran
socio) — **à confirmer qu'aucun consommateur existant ne suppose une liste fermée de valeurs**
avant de l'introduire.

**Point 5 — Stockage du jeton `establishments.lobby_api_token`.** Proposé : colonne `text`
classique avec RLS restreignant la lecture à l'admin (jamais au socio, même propriétaire de
l'établissement — un jeton PMS n'est pas une donnée socio). Chiffrement applicatif (pgsodium/Vault
Supabase) au lieu d'un texte clair en base : **pas tranché ici**, dépend du niveau d'exigence de
sécurité que Jérôme souhaite pour ce secret précis (à mettre en regard de `providers.lobby_api_token`
qui était déjà en clair côté SQLite legacy — même niveau ou amélioration délibérée ?).

**Point 6 — Fréquence du poll et taille de lot.** Explicitement listé comme hors périmètre à
trancher sans Jérôme par `hifago/CLAUDE.md` §10 (« fréquence du cron PMS et taille de lot ») —
non tranché par cette spec, à fixer au moment du chiffrage/implémentation.

## 11. Annexe — traçabilité code→règle

| Section | Fichiers sources (legacy) | Fichiers sources (hifago, déjà existants) |
|---|---|---|
| Disponibilité à chaud, cache 60 s affichage only | `src/services/portalService.js` (`nightAvailability`, `getAvailability`) | — (à créer, `packages/domain/src/pms/`) |
| Création booking, parsing `body.booking.booking_id` | `src/services/portalService.js` (`reserve`) | — |
| Miroir activité, condition d'éligibilité générique | `src/services/portalService.js` (`reserve`, bloc activités) — condition en dur `provider.id==='kayam'` à généraliser | — |
| `isPmsBacked` | `src/services/catalogService.js` | — (port direct, déjà générique) |
| File de réconciliation, résolution admin | `src/controllers/orderService.markMirrorFailed` (concept, pas le code) | `supabase/migrations/20260814210000_pms_reconciliation_entries.sql`, `apps/admin/e2e/admin-reconciliation.spec.ts` (**déjà livré**) |
| Mapping produit dormant | — | `supabase/migrations/20260813190232_catalog_core_tables.sql`, `20260816110000_product_hotel_rooms.sql` |
| Transfert d'entrée de réconciliation lors d'une modification de commande | — | `supabase/migrations/20260817200000_modify_order_line_rpc.sql` et suivants (**déjà livré**) |
| Jeton par établissement (précédent conceptuel jamais branché) | `src/services/migrations/001_init.sql` (`providers.lobby_api_token`), `src/services/catalogService.js` (upsert provider) | — |
| Debug/probes sûres | `.claude/skills/lobby-debug/SKILL.md` (racine du dépôt) | à adapter en skill hifago si besoin, hors périmètre code |
| Référence API complète | `docs/3-integrations/lobby_pms_api.md`, `docs/2-reference/06-lobbypms.md` (racine du dépôt) | — |

## 12. Documents liés

- `hifago/docs/01-cahier-des-charges-client.md` §5 (contrat fonctionnel validé, source d'autorité
  pour toute règle métier de cette spec).
- `hifago/docs/04-architecture-cible.md` § Jobs planifiés et connecteur PMS, § Environnements
  (relais réseau), § Tests et CI/CD (stratégie de test, corrigée §10.1).
- `hifago/docs/00-modele-de-donnees.md` (découverte du schéma dormant legacy, dont
  `providers.lobby_api_token`).
- `hifago/docs/specs/13-admin-hotel-habitaciones.md` (alignement partiel `product_room_types` sur
  la forme LobbyPMS, Tranche 2 hors périmètre ici).
- `hifago/docs/specs/17-calendrier-disponibilite-refonte.md`,
  `hifago/docs/specs/18-creneaux-horaires-reservables.md` (mentions « conçu compatible avec le
  futur connecteur LobbyPMS »).
- `hifago/docs/specs/19-paiement-mercadopago-acompte-ledger.md` (précédent RPC→Route Handler→appel
  externe séquentiel, réutilisé §7).
- Racine du dépôt (legacy, source de portage) : `docs/3-integrations/lobby_pms_api.md`,
  `docs/3-integrations/lobby_pms_implementation.md`, `docs/2-reference/06-lobbypms.md`,
  `.claude/skills/lobby-debug/SKILL.md`.

## 14. Amendements (2026-08-26)

Deux évolutions postérieures rendent le §0 partiellement daté — signalées ici plutôt que réécrites
en place, même discipline que le §13 amendé le 2026-08-21 :

1. **Le miroir ne concerne plus seulement une « activité ».** `lobby_product_id` s'applique désormais
   à `activity` **et** `transport` (tous deux « service » côté Lobby, une date unique + une quantité,
   compatibles avec `add-product-service`). `evento` et `camp` restent strictement exclus, pour une
   raison structurelle et non par oubli : un evento vitrine ne produit jamais d'`order_line`, et un
   camp se réserve par date + `duration_days` alors qu'`add-product-service` ne transporte ni date ni
   durée. Migration `20260826110000`, route `reserve-nights` l.121-126.

2. **Un service vendu sans nuit n'est plus traité comme un échec.** Le §0 prévoyait qu'une activité
   éligible se rattache « au booking de sa propre propriété dans la commande » ; quand la commande
   n'en contient aucune, `reserve-nights` insérait une entrée `pms_reconciliation_entries` par ligne
   et par vente — dont le trigger `notify_all_admins` (`20260824060000`) envoie un e-mail à **chaque
   admin**, sans dédup. Or Lobby refuse structurellement la vente d'un service isolé
   (`422 "The booking doesnt exits"`) et il a été décidé de ne jamais inventer de booking coquille :
   ce n'est pas un incident réparable, c'est une limite connue. Désormais distingué du cas où des
   nuits existaient mais dont tous les bookings ont échoué — celui-là reste une vraie entrée de
   réconciliation.

Le reste du contrat §0 est inchangé. Détail complet et suite du chantier :
[`24-modele-hebergement-et-surface-lobbypms.md`](24-modele-hebergement-et-surface-lobbypms.md).


## 13. Implémentation (2026-08-19) — Tranche 1 livrée

Tous les points §10 tranchés par Jérôme le 2026-08-19 : périmètre complet (schéma, `create_order`,
réservation de nuits, miroir d'activité, poll automatique, réconciliation, UI admin, tests) ;
`establishments.lobby_api_token` en colonne texte classique (RPC-only, illisible même par l'admin
via PostgREST — cf. §6 modèle de données ci-dessus, raison mécanique documentée dans le plan
d'implémentation) ; poll toutes les 15 min, lot de 20. Plan détaillé et traçabilité complète :
`hifago/docs/journal/2026-08.md` (entrée 2026-08-19, connecteur LobbyPMS).

**Tout vérifié en local et vert au moment de livrer** : pgTAP (691 tests, dont 2 nouveaux fichiers
dédiés PMS), Vitest (`packages/domain/src/pms/*`, y compris `lobbyClient.ts` contre un vrai `fetch`
via serveur de fixtures local), 2 e2e Playwright admin, 1 test d'intégration bout-en-bout de
l'Edge Function `pms-poll-bookings` (`tests/pms-integration/`, contre la stack Supabase locale
réelle — confirme empiriquement que `host.docker.internal` résout bien le serveur de fixtures
depuis le conteneur Edge Runtime local).

**Gap comblé le 2026-08-21** : le contrat §0 promettait « disponibilité/prix par nuit toujours
relus à chaud au moment de réserver » comme invariant, mais jusqu'ici seule l'écriture (`POST
/api/pms/reserve-nights`, appelé APRÈS `create_order`) consultait réellement Lobby — aucune route
ne lisait la disponibilité Lobby pour l'affichage client (calendrier de sélection des dates sur la
fiche produit). Un établissement PMS-backed n'avait donc aucun moyen d'afficher ses dates
réellement disponibles au client avant réservation. Comblé par `GET /api/pms/night-availability`
(`apps/web/app/api/pms/night-availability/route.ts`) : Route Handler public (fiche produit visible
par un visiteur anonyme, même niveau d'exposition que `product_availability` déjà public), appelé
**depuis le client** (`LodgingReservationForm.tsx`, un fetch au montage + à chaque changement de
mois du calendrier — jamais depuis `page.tsx`/Server Component, pour ne jamais bloquer le rendu SSR
sur des appels Lobby). Ne lit QUE `available_rooms` (jamais `plans[].prices[]` — Lobby n'est jamais
la source du prix côté hifago, cf. `buildEvenRatesPerDay.ts`) ; `product_date_rates`/`price_tiers`
restent la seule source de prix, y compris pour un produit PMS-backed. Nouveaux modules domaine :
`getNightAvailabilityWindow.ts` (port de `mapChunked`, lots de 6, chaque nuit dans son propre
`try/catch` — un échec isolé OMET cette nuit du résultat, jamais une valeur fabriquée ;
`hasUnavailableNightInRange` traite déjà toute nuit absente comme indisponible, fail-closed
gratuit), `parseLobbyNightCatalog.ts` (remplace `parseLobbyNightAvailability.ts`, supprimé le 2026-08-28 avec le filtre `category_id`), `nightAvailabilityCache.ts` (cache TTL 60s en mémoire,
best-effort, non partagé entre instances Vercel — cohérent avec l'invariant « cache 60s autorisé
pour l'affichage », jamais pour l'écriture). `createLobbyBooking`/`reserve-nights` restent inchangés
: la protection anti-survente réelle reste `POST /bookings`, toujours juge final côté Lobby au
moment de réserver. Tests : Vitest (les 3 nouveaux modules domaine, serveur `node:http` de
fixtures), 1 e2e Playwright chemin heureux + dégradation
(`apps/web/e2e/reserve-lodging-pms-availability.spec.ts`, établissement PMS-backed dédié, mock
`page.route()` — jamais le vrai LobbyPMS). Détail complet : `hifago/docs/journal/2026-08.md`
(2026-08-21).

**Hors périmètre de ce comblement, resté ouvert** : rate-limiting de la route publique (aucune
infra de ce type n'existe ailleurs dans le repo) ; préchargement du mois adjacent au mois visible ;
cache partagé entre instances serverless concurrentes. Aucun de ces trois points n'affecte
l'anti-survente (toujours assurée par `reserve-nights`), seulement l'expérience d'affichage.

**Deux bugs trouvés en FAISANT TOURNER les tests, pas en écrivant le code** (même discipline que
les sessions précédentes, cf. `docs/journal/2026-08.md`) :
1. **Régression introduite par cette spec, corrigée dans la foulée** : le `REVOKE SELECT` +
   `GRANT SELECT` par colonne sur `establishments` (pour cacher `lobby_api_token`) cassait
   `update_establishment` (`security invoker`, préexistant), qui faisait `select *` — un `select *`
   exige SELECT sur TOUTES les colonnes. Révélé par `admin-establishment-edit.spec.ts` (403/42501).
   Corrigé (migration `20260819150000`) en remplaçant le `select *` par une liste explicite des 6
   colonnes réellement utilisées — jamais en rouvrant le grant sur `lobby_api_token`.
2. **Bug PRÉ-EXISTANT, sans lien avec cette spec, trouvé en vérifiant** : `productTypeGating`/
   `availabilityScreenFor` vivaient dans un fichier `"use client"`
   (`useProductTypeFieldsState.ts`) ; `apps/admin/app/admin/products/[id]/edit/page.tsx` (Server
   Component) les important, cassait 500 sur TOUT produit édité (confirmé présent dans le commit
   HEAD avant toute modification de cette session, `git show HEAD:...`). Corrigé (extraction vers
   `apps/admin/lib/products/productTypeGating.ts`, sans "use client") car bloquant pour vérifier ce
   trajet — décision prise en mode autonome (auto-mode), à faire valider par Jérôme a posteriori.

**Non couvert par cette Tranche 1, pré-existant, non touché** : flakiness déjà documentée
(`hifago/CLAUDE.md` §11 point 10) sur 2-4 fichiers pgTAP (`admin_audit_log`, `catalog_rls`,
`product_availability_rpc`, `set_product_availability_socio` — assertions `count(*) from
audit_log` non scopées, cassent avec le volume de données accumulé) ; login TOTP admin qui peut
échouer quand plusieurs specs e2e admin tournent en parallèle sur le même compte partagé (workers
Playwright > 1) — contourné en lançant en séquentiel (`--workers=1`) pour cette vérification, jamais
corrigé (hors périmètre).
