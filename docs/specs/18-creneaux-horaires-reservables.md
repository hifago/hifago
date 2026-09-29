---
id: specs-creneaux-horaires-reservables
titre: "Créneaux horaires réellement réservables (product_slot_rules)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
revise:
  - "docs/01-cahier-des-charges-client.md#3a"
  - "docs/01-cahier-des-charges-client.md#3d"
  - "docs/01-cahier-des-charges-client.md#3e"
  - "docs/02-cahier-des-charges-socio.md#3d"
  - "docs/03-cahier-des-charges-admin.md#3g"
maj: 2026-08-18
resume: >
  Rend product_slot_rules (définition de créneaux horaires par activité, posée par la spec 11)
  réellement réservable côté client avec anti-survente — c'est la « Tranche 3 » déjà nommée mais
  jamais spécifiée par la spec 17 (§2/§10 point 12), motivée par un cas réel bloqué (jetski).
mots_cles: [creneaux, slots, product_slot_rules, anti-survente, activity, jetski, lobbypms]
repond_a:
  - "Comment un produit dont la capacité varie par heure (pas par jour) devient-il réservable ?"
  - "Pourquoi product_slot_rules existe-t-il déjà sans qu'aucune réservation ne le consomme ?"
  - "Cette spec est-elle compatible avec le futur connecteur LobbyPMS ?"
---

> **Amendement daté du 2026-08-27 — l'étage hôtel a été supprimé.** `products.type='hotel'`,
> `product_room_types`, `room_media`, `room_type_availability`, `room_type_date_rates`,
> `order_lines.room_type_id` et `set_room_type_availability` n'existent plus (T3 de la spec 24 :
> application par le commit 38c1b55, base par la migration `20260827220000`). Une chambre est
> désormais un produit `type='lodging'` à part entière. **Toute mention de `room_type`,
> `product_room_types` ou d'une « branche chambre » ci-dessous décrit un état passé** ; le mécanisme
> équivalent vit sur `products`/`product_availability`. Détail et raisons : `docs/specs/24-modele-
> hebergement-et-surface-lobbypms.md` §4, et le bandeau de `docs/specs/13-admin-hotel-habitaciones.md`.

# Créneaux horaires réellement réservables (`product_slot_rules`)

> **Cible stack** : Hifago. Correspond très exactement à la « Tranche 3 » déjà nommée et renvoyée
> par `docs/specs/17-calendrier-disponibilite-refonte.md` §2 (« créneaux réellement réservables »)
> — traitée ici comme un document séparé (numéro de fichier `18-`, distinct de la numérotation de
> tranche interne à la spec 17) pour ne pas alourdir un document déjà long. Toute référence à
> « Tranche 3 » dans la spec 17 désigne le contenu de ce document-ci.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (API/RPC, modèle de données, invariants, cas limites — pour coder) | implémenté (2026-08-18) |
| 1 | Contexte et problème | implémenté |
| 2 | Portée | implémenté |
| 3 | Décisions retenues | implémenté |
| 4 | Parcours cible | implémenté |
| 5 | Écran(s) | implémenté |
| 10 | Décisions tranchées / points ouverts | implémenté — les 2 points ouverts ont été tranchés pendant l'implémentation |
| 11 | Annexe — traçabilité code→règle | implémenté |
| 12 | Documents liés | implémenté |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Endpoints / RPC

| RPC | Signature | Sécurité | Rôle |
|---|---|---|---|
| `expand_product_slots` | `(p_product_id uuid, p_date date) returns table(slot_start_time time, capacity int, slot_duration_minutes int)` | `stable`, PAS `security definer` (ne fait que projeter des lectures déjà couvertes par policy) | Expansion pure des règles `product_slot_rules` correspondant au jour de semaine de `p_date` — chevauchement résiduel agrégé en `MIN(capacity)` (§10 point 1). Réutilisée par `get_product_slots` (lecture) ET par `create_order` (matérialisation) — jamais dupliquée. |
| `get_product_slots` | `(p_product_id uuid, p_from date, p_to date) returns table(slot_date date, slot_start_time time, capacity int, booked int, slot_duration_minutes int)` | `stable`, PAS `security definer` | Union entre créneaux « virtuels » (règles courantes) et lignes déjà matérialisées dans `product_slot_availability` — une ligne matérialisée fait toujours foi, jamais remplacée par une re-dérivation des règles. `grant execute` à `authenticated, anon`. Pas de `slot_end_time`/`remaining` en sortie (écart au brouillon initial) : l'heure de fin et le restant se calculent trivialement côté appelant (`slot_start_time + slot_duration_minutes`, `capacity - booked`), inutile de les dupliquer dans le contrat SQL. |
| `set_product_slot_capacity` | `(p_product_id uuid, p_date date, p_slot_start_time time, p_capacity int, p_note text default null) returns jsonb {ok, reason?, booked?}` | `security definer set search_path=''` | Mirror exact de `set_product_availability` (son autre mirror, `set_room_type_availability`, a été supprimé par la spec 24 T3) — garde `below_booked`, `p_note` pour l'audit admin (même 5e paramètre optionnel). Policy **admin+socio unifiée** — décision Jérôme confirmée en cours d'implémentation (2026-08-18, §10 point 8). |
| `create_order` | `(p_holder_name text, p_holder_email text default null, p_holder_phone text default null, p_marketing_consent boolean default false)` — depuis la spec 32, plus de `p_lines` : les lignes sont lues dans `cart_items` | inchangé | Ligne à créneau = `cart_items` avec `date` + `slot_start_time` (mutuellement exclusive avec `end_date`). Squelette de sécurité déjà en place, cf. `docs/05-reference-technique.md` §1/§1bis. |

### Modèle de données (delta)

| Table | Statut | Détail |
|---|---|---|
| `product_slot_availability` | **nouvelle table** | `id uuid pk default gen_random_uuid()`, `product_id uuid not null references products(id) on delete cascade`, `slot_date date not null`, `slot_start_time time not null`, `slot_duration_minutes int not null` (snapshot, jamais re-dérivé), `capacity int not null`, `booked int not null default 0`, `unique(product_id, slot_date, slot_start_time)`. RPC-only (`revoke insert/update/delete from authenticated, anon`), lecture publique inconditionnelle (`for select using(true)`, mirror `product_availability_select_public`). PK uuid+unique, **pas** une PK composite — convention des tables de capacité *vivante* (`product_availability`, `room_type_availability`), distincte de la PK composite réservée aux tables de config RLS-directe (`product_calendar`). |
| `order_lines` | colonne ajoutée | `slot_start_time time` (nullable) — même patron que `end_date` (Tranche 2 de la spec 17). |
| `product_slot_rules` | **réutilisée telle quelle** | Aucune modification de schéma — déjà posée par la spec 11 (`20260816091000_product_slot_rules.sql`). Seule sa validation applicative (`slotRules.ts`) gagne un contrôle de non-chevauchement (cf. Invariants). |
| `products.default_capacity`, `product_availability` | **réutilisées, avec une garde nouvelle** | Un produit portant au moins une règle `product_slot_rules` ne peut plus emprunter la branche date-unique générique — garde serveur dans `create_order` Phase 1 (cf. Invariants). |
| `products.lobby_product_id`/`lobby_category_id` | **réutilisées telles quelles** | Colonnes déjà existantes et dormantes (`20260813190232_catalog_core_tables.sql`) — une activité à créneaux les réutilise sans champ Lobby-spécifique nouveau, cf. §10 point 7. |
| `pms_reconciliation_entries` | **réutilisée telle quelle** | Déjà générique par `order_line_id` (`20260814210000_pms_reconciliation_entries.sql`) — aucune modification nécessaire pour une ligne à créneau. |

### Invariants

- Un `slot_start_time` matérialisé dans `product_slot_availability` fait toujours foi tel quel, jamais re-dérivé ni masqué par un changement ultérieur de `product_slot_rules`.
- Un jour fermé (`product_calendar`/`calendar_default_open`) ferme tous ses créneaux — les deux granularités (jour, créneau) se cumulent, ne s'excluent jamais.
- Un produit portant au moins une règle `product_slot_rules` ne peut **jamais** être réservé via la branche date-unique générique (`default_capacity`/`product_availability`) — refus serveur `slot_required` en Phase 1 de `create_order`. Garde-fou serveur, jamais seulement une garde UI.
- Deux règles `product_slot_rules` du même produit partageant au moins un jour de semaine commun ne peuvent pas se chevaucher, même partiellement — validé à l'écriture (`validateSlotRules`), pas seulement à la lecture.
- `slot_start_time`/`slot_end_time` transitent partout comme chaînes `"HH:MM"` opaques (type Postgres `time without time zone` côté serveur) — jamais combinées en un objet `Date` JS unique avec la date (un tel objet serait interprété dans le fuseau du navigateur visiteur, pas celui de Bogota).
- La matérialisation d'une ligne `product_slot_availability` par défaut (`ON CONFLICT DO NOTHING`) précède toujours son verrouillage `FOR UPDATE` dans `create_order`, jamais l'inverse — même discipline que `products.default_capacity`.
- `slot_start_time` ne franchit jamais la frontière vers LobbyPMS — aucun paramètre temporel n'existe côté API Lobby pour une activité (cf. §10 point 7).

### Cas limites

| Situation | Traitement attendu |
|---|---|
| `slot_start_time` fourni par le client ne correspond à aucun créneau réellement généré par `expand_product_slots` | Rien n'est matérialisé → verrouillage ne trouve rien → `slot_not_found` en Phase 3, jamais une confiance aveugle dans une valeur cliente. |
| Deux règles `product_slot_rules` généreraient exactement le même `start_time` pour un même jour (donnée existante avant que la validation stricte ne soit en place) | `expand_product_slots` retient `MIN(capacity)` — défense en profondeur en lecture, la vraie fermeture est la validation à l'écriture. |
| Plage de règle non divisible par la durée de créneau (ex. 9h-17h / 90 min) | Reliquat tronqué — reprend exactement la sémantique déjà décidée et déjà implémentée côté preview admin (`generateSlotPreview`, `slotRules.ts`), pas rouverte ici. |
| L'admin remplace le jeu de règles d'un produit alors que des réservations existent sur d'anciens créneaux qui n'existent plus dans le nouveau jeu | La ligne `product_slot_availability` déjà matérialisée reste intacte (aucun lien de suppression en cascade vers elle) et continue d'apparaître dans `get_product_slots` (union explicite avec les lignes déjà matérialisées) — jamais silencieusement perdue de l'écran admin tout en restant facturée. |
| Réservation d'un créneau sans hébergement dans la même commande, une fois le futur connecteur LobbyPMS branché | Tombe dans le même cas déjà géré par le legacy pour toute activité standalone (pas de vente d'activité seule dans Lobby) — hérité tel quel, pas un gap introduit ici, cf. §10 point 7. |
| Modification d'une réservation déjà prise sur un créneau (déplacer date/heure/qty) | **Hors périmètre** — `modify_order_line` refuse explicitement une ligne à `slot_start_time` non nul, même traitement que le camp aujourd'hui (« annuler puis recréer manuellement »). |

### Fichiers touchés (état réel après implémentation, 2026-08-18 ; chemins mis à jour le 2026-09-28)

- `supabase/migrations/20260818100000_slot_availability_reservable.sql` : table `product_slot_availability`, colonne `order_lines.slot_start_time`, `expand_product_slots`, `get_product_slots`, `set_product_slot_capacity`, `create_order` étendu (4e branche + garde de non-coexistence Phase 1 + matérialisation/verrouillage Phase 2), `modify_order_line` étendu (refus explicite d'une ligne à créneau, §2 Portée-Out).
- `apps/admin/lib/products/slotRules.ts` (+ `slotRules.test.ts`) : `validateSlotRules` étendu (non-chevauchement par jour commun, comparaison pairwise sur des règles partageant au moins un jour) — partagé par `apps/admin/app/admin/products/[id]/edit/ProductSlotRulesBlock.tsx` (édition admin) ET `product-form.tsx` (création admin **et** proposition socio, cf. §10 point 9), aucun changement séparé requis côté socio.
- `apps/admin/components/slot-availability-grid.tsx` (nouveau) + `apps/admin/app/admin/products/[id]/slot-availability/page.tsx` + `apps/admin/app/partner/(app)/products/[id]/slot-availability/page.tsx` (nouveaux, mirrors de l'ancienne paire `room-availability`, supprimée par la spec 24 T3).
- Lien conditionnel : `apps/admin/app/admin/products/[id]/edit/page.tsx` (3e lien, gated sur `isActivity && slotRulesRaw.length > 0`, réutilise une donnée déjà chargée) ; côté socio, le lien vit sur `apps/admin/app/partner/(app)/establishment/EstablishmentActivities.tsx` (l'ancien `ProductsGrid.tsx` a été supprimé).
- `apps/web/app/[locale]/(vitrine)/productos/[slug]/SlotReservationForm.tsx` (nouveau) + branche `isSlotBased` dans le `page.tsx` voisin (gate + fetch `get_product_slots` sur `[aujourd'hui, +180j]`, insérée avant le fallback `ReservationForm` générique).
- `apps/web/lib/cart/CartContext.tsx` (`slotStartTime` optionnel), `apps/web/app/[locale]/(tunnel)/pago/CheckoutForm.tsx` (affichage ligne panier, `slot_required`/`unsupported_slot_combination` ajoutés aux raisons connues ; le mapping `p_lines` a disparu avec la spec 32).
- `apps/web/messages/{es,en}/ProductPage.json` et `apps/web/messages/{es,en}/CheckoutPage.json` : `selectSlotDate`/`selectSlotTime`, `errors.slot_required`/`unsupported_slot_combination`.
- `supabase/tests/database/product_slot_availability.test.sql` (nouveau, 17 assertions) ; `create_order.test.sql` (cas 21a-21g, 11 assertions) ; `modify_order_line.test.sql` (cas 14, 2 assertions) ; `tests/concurrency/create_order_slot.concurrency.mjs` (nouveau, N=20/capacité=5/5 runs).

---

## 1. Contexte et problème

Un produit jetski (`type='activity'`) créé par Jérôme côté socio est resté invendable après sa
création : sa vraie capacité varie par créneau horaire (9h-17h, créneaux d'1h, capacité 10 chacun),
pas par jour. Jérôme avait pourtant configuré, de bonne foi, une règle `product_slot_rules` à la
création — table posée par la spec 11 (2026-08-16) — en croyant que c'était le mécanisme de cupo.
Investigation menée en session (journal `2026-08.md`, 2026-08-18) : cette table est **purement
définitionnelle**, confirmée par grep exhaustif des migrations — `create_order` et
`modify_order_line` ne la lisent jamais, aucun écran client n'en affiche le contenu. La spec 11
l'annonçait déjà explicitement (§2 « Out ») : « Tranche 1 : définition admin seulement ; la
réservation cliente anti-survente est renvoyée à une Tranche 2 ». La spec 17 a repris ce même
chantier sous le nom « Tranche 3 » (§2/§10 point 12) sans jamais le spécifier — seulement une
direction narrative, « à spiker avant validation ».

Face à ce constat, deux options ont été posées à Jérôme le 2026-08-18 : approximer la capacité du
jetski par un cupo journalier (`products.default_capacity`, tout juste livré) en attendant, ou
laisser le produit invendable jusqu'à ce que les créneaux soient réellement réservables. **Jérôme a
explicitement choisi d'attendre** — le jetski reste aujourd'hui sans `default_capacity` configuré,
première demande concrète (pas seulement théorique) motivant de prioriser cette Tranche 3.

**Ce que fait le seul précédent existant (v1 legacy, racine du dépôt, hors hifago/)** : une
granularité **binaire** matin/après-midi (`products.schedule='slot'`, `order_lines.slot ∈
{'am','pm'}`), jamais plus fine. Capacité comptée séparément par créneau — « 3 places de paddle =
3 le matin ET 3 l'après-midi » (décision Jérôme du 2026-07-30, `src/services/inventoryService.js`).
Anti-survente assurée par l'atomicité mono-thread de SQLite (`db.transaction`), un mécanisme non
transposable tel quel à Postgres/Supabase (connexions multiples concurrentes). Le commentaire de
tête de `20260816091000_product_slot_rules.sql` confirme lui-même : « comparé à l'app legacy —
zéro précédent même partiel pour une granularité plus fine qu'am/pm — terrain vierge, pas une
reprise ».

**Ce que fait v2 hifago aujourd'hui** :
- `product_slot_rules` : `weekdays smallint[]` (ISO 1=lundi..7=dimanche), `start_time`, `end_time`,
  `slot_duration_minutes`, `capacity` — une règle par plage récurrente, plusieurs règles possibles
  par produit. RLS-directe (écriture admin seule), écrite par `ProductSlotRulesBlock.tsx` (remplace
  tout le jeu de règles à chaque sauvegarde) et par le pipeline de proposition socio à la création
  uniquement — un socio ne peut jamais éditer les créneaux d'un produit déjà publié. Noms de
  colonnes délibérément pré-alignés sur une future table de capacité vivante (même commentaire de
  tête) : c'est très exactement le signal de conception que cette spec vient honorer.
- `products.schedule` existe encore (`CHECK IN ('slot','date','none')`, défaut `'date'`) mais sa
  valeur `'slot'` est confirmée **inatteignable côté UI** et jamais lue par la logique métier —
  décision déjà fermée par spec 17 §10 : `product_slot_rules` est l'unique mécanisme retenu, la
  coexistence avec le legacy `schedule='slot'` n'est **pas** un point à rouvrir ici.
- `create_order` (dernière migration : `20260818090000_product_default_capacity.sql`) : structure
  en 4 phases, complétée cette semaine d'une phase de **matérialisation avant verrouillage** —
  `insert ... on conflict (product_id, date) do nothing` d'une ligne `product_availability` par
  défaut (`capacity=products.default_capacity, booked=0`), strictement avant la boucle `FOR UPDATE`
  qui suit (l'unicité de clé + `ON CONFLICT DO NOTHING` ferme la fenêtre de concurrence entre deux
  premières réservations simultanées d'un jour jamais configuré). **C'est le patron exact que cette
  spec généralise** : au lieu de dériver un défaut depuis une colonne produit unique, il se dérive
  depuis `product_slot_rules` via `expand_product_slots` (§0).
- Client (`apps/web/.../products/[slug]/*`) : aucune notion d'heure nulle part aujourd'hui, quel
  que soit le type de produit — seulement une date (`ReservationForm.tsx`, `HotelReservationForm.tsx`,
  `LodgingReservationForm.tsx`, tous vérifiés).
- Admin (`availability-calendar.tsx`) : calendrier FullCalendar mensuel, un badge par jour, un
  modal par date au clic — pas conçu pour afficher plusieurs créneaux dans une seule cellule.

**Cahiers des charges** (`01/02/03-cahier-des-charges-*.md`) : ne promettent aujourd'hui que le
mécanisme legacy binaire matin/après-midi — ils n'ont jamais été mis à jour pour refléter
`product_slot_rules`. Seuls le modèle de données technique (`00-modele-de-donnees.md` §3) et les
specs 11/17 mentionnent la granularité fine. Aucune tranche de la spec 17 (qui a pourtant construit
des mécanismes tout aussi éloignés des cahiers — chambres d'hôtel par type, alojamiento par nuits)
n'a jamais réécrit un cahier des charges en cours de route ; cette spec suit le même précédent
(§10 point 6).

## 2. Portée

**In (Tranche 1, cette spec, prête à coder)** :
- Table `product_slot_availability`, fonctions `expand_product_slots`/`get_product_slots`,
  RPC `set_product_slot_capacity`.
- `create_order` étendu d'une 4e forme de ligne panier (créneau), avec sa garde de non-coexistence
  avec la branche date-unique générique.
- Validation admin étendue (non-chevauchement de règles).
- Écran admin de grille créneaux×dates, écran client de sélection d'un créneau.
- Test de concurrence dédié + pgTAP.
- Débloque concrètement le produit jetski réel.

**Out, nommé et renvoyé** :
- `modify_order_line` polymorphe pour une ligne à créneau — refus explicite nommé, même traitement
  que le camp aujourd'hui.
- Vue admin riche type planning/timeline (drag-drop) — la grille TanStack Table suffit au besoin
  réellement exprimé, même arbitrage que spec 17 §3bis contre le coût de licence récurrent d'un
  composant payant (`@fullcalendar/resource-timeline`).
- Mise à jour des 3 cahiers des charges — référencés, pas réécrits (§10 point 6).
- Tranche 4 de la spec 17 (ressource partagée généralisée) — sans rapport direct.
- Connecteur LobbyPMS réel pour hifago — pas construit ici, seulement rendu compatible (§10 point 7).

## 3. Décisions retenues

Décisions déjà actées ailleurs, à ne pas rouvrir :

- **`product_slot_rules` est l'unique mécanisme de créneau retenu**, `schedule='slot'`/
  `closed_slot` legacy mort — spec 17 §10 : « suppression des colonnes mortes, `product_slot_rules`
  retenu comme unique mécanisme de créneau futur (Tranche 3) — décidé une seule fois ici, pas
  re-posé en Tranche 3 ».
- **Réservation cliente et anti-survente explicitement renvoyées ici** — spec 11 §2 : « Réservation
  réelle d'un créneau précis par un client : nouvelle dimension de capacité anti-survente dans
  `create_order` (verrouillage `SELECT...FOR UPDATE` par `(product_id, slot_date,
  slot_start_time)`), sa suite de tests de concurrence dédiée, et l'UI cliente de sélection d'un
  créneau. »
- **Cupos par créneau, pas par jour** — même principe produit que la décision legacy du 2026-07-30
  (« la capacité vaut pour CHAQUE créneau »), transposé à une granularité fine au lieu du binaire
  am/pm.
- **Sparse/override par date, jamais une ligne pré-générée** (`00-modele-de-donnees.md` §1) — même
  patron déjà repris pour `product_calendar`/`product_date_rates`/`room_type_date_rates`, appliqué
  ici à `product_slot_availability`.
- **Squelette de verrouillage anti-survente** (`05-reference-technique.md` §1/§1bis) : dates/clés
  verrouillées dans un ordre déterministe (`order by ... for update`), test de concurrence
  obligatoire avant de considérer un pattern acquis.
- **Une place vendue ne se reprend jamais d'un clic** (cahiers des charges client/socio §3d) — un
  changement de règles n'affecte jamais une réservation déjà matérialisée.

## 4. Parcours cible

**Client** : sur la fiche produit d'une activité à créneaux, `SlotReservationForm.tsx` remplace
`ReservationForm.tsx` générique (nouvel écran, pas un mode ajouté — même précédent que
`LodgingReservationForm.tsx`, spec 17 §10 point 11). Le visiteur choisit une date
(`react-day-picker` `mode="single"` inchangé, jours désactivés calculés depuis les `weekdays` des
règles), puis une plage horaire parmi des chips affichant l'heure et les places restantes (« Quedan
N lugares », badge déjà existant réutilisé). Le stepper de quantité se reclampe sur le `remaining`
du créneau choisi, exactement comme il se reclampe déjà sur la capacité restante d'une date en
mode générique. Le panier retient `slotStartTime` en plus de `date`/`qty`.

**Socio/admin (définition)** : inchangé — `ProductSlotRulesBlock.tsx` reste l'écran de définition
des horaires récurrents, désormais réellement branché en aval.

**Admin (opérationnel)** : depuis la fiche produit d'une activité à créneaux, un lien conditionnel
ouvre une grille créneaux×dates (lignes = heures, colonnes = dates) affichant cupos/booked par
cellule, éditable pour fermer/réduire un créneau précis un jour donné — même geste que la grille
chambres×dates de la spec 17, transposé à l'axe créneau plutôt que chambre.

## 5. Écran(s)

**`SlotReservationForm.tsx` (client, nouveau)** — calendrier de date (jours désactivés hors
`weekdays` des règles) ; sélecteur de créneau (chips horaires, place restante affichée, créneau
plein désactivé) ; stepper quantité reclampé ; ajout au panier.

**`slot-availability-grid.tsx` (admin/socio, nouveau)** — TanStack Table + `SimpleTable`, lignes =
créneaux (`slot_start_time`), colonnes = dates, cellule = capacité éditable via
`set_product_slot_capacity`, alimentée par `get_product_slots` (donc affiche aussi un créneau déjà
réservé même orphelin d'une règle supprimée). Même dérogation reflow mobile déjà validée et
tranchée par spec 17 §10 pour la grille chambres×dates, reprise à l'identique (lignes=créneaux au
lieu de lignes=chambres).

`ProductSlotRulesBlock.tsx` (définition des horaires) et `availability-calendar.tsx` (calendrier
mensuel jour-entier) restent **inchangés** — le premier continue de définir les règles, le second
reste le seul contrôle d'ouverture/fermeture d'une date entière, applicable identiquement à un
produit à créneaux.

---

## 10. Décisions tranchées / points ouverts

**Tranchées ici** :

1. **Chevauchement exact de `start_time` entre deux règles** (résiduel après validation stricte à
   l'écriture) : `expand_product_slots` retient `MIN(capacity)` en lecture — défense en profondeur
   seulement, la vraie fermeture est la validation applicative à l'écriture (point 3 ci-dessous).
2. **Reliquat non divisible** (ex. 9h-17h / créneaux de 90 min) : tronqué, reprend exactement la
   sémantique déjà décidée et déjà implémentée côté preview admin (`generateSlotPreview`,
   `slotRules.ts`) — pas rouverte ici.
3. **Non-chevauchement de règles, validé à l'écriture** : `validateSlotRules` (`slotRules.ts`)
   gagne un vrai contrôle — règles du même produit partageant au moins un jour de semaine commun,
   triées par `start_time`, rejetées si `sorted[i].start_time < sorted[i-1].end_time`. Reprend
   l'algorithme déjà existant pour le non-chevauchement de `price_tiers` (`priceTiers.ts`), pas une
   réinvention. **Vérifié en session de planification** : aucun produit existant ne porte
   aujourd'hui plus d'une règle `product_slot_rules` — cette validation ne bloquera rétroactivement
   aucune donnée déjà en base.
4. **Une ligne `product_slot_availability` déjà matérialisée n'est jamais re-dérivée ni masquée**
   par un changement ultérieur de `product_slot_rules` (`ProductSlotRulesBlock.handleSave` remplace
   tout le jeu de règles à chaque sauvegarde, sans toucher aux lignes déjà matérialisées, aucune
   cascade ne les lie). `get_product_slots` unionne explicitement créneaux virtuels (règles
   courantes) et lignes déjà matérialisées, pour qu'une réservation déjà prise sur un créneau retiré
   du jeu de règles reste visible et comptée côté admin, jamais silencieusement perdue.
5. **Non-coexistence stricte `product_slot_rules`/`default_capacity` sur un même produit** — sans
   cette garde, une ligne panier construite sans `slot_start_time` pour un produit à créneaux
   emprunterait la branche date-unique générique et contournerait entièrement sa vraie capacité par
   créneau (un jetski à 10 places/heure « vendu » en gros sur toute la journée). Garde serveur dans
   `create_order` Phase 1 (`slot_required` si le produit porte au moins une règle
   `product_slot_rules` et que la ligne n'a ni `slot_start_time`, ni `room_type_id`, ni `end_date`)
   — même patron que `room_type_required` pour `hotel`, jamais seulement une garde UI (recommandé en
   complément : masquer le champ « Cupo diario por defecto » dans `product-type-fields.tsx` dès
   qu'au moins une règle de créneau existe pour le produit, pour éviter la confusion à la saisie —
   pas la vraie barrière, juste un confort).
6. **Cahiers des charges hors périmètre de cette spec** — référencés (`docs/journal/`), pas réécrits, même
   précédent que toutes les tranches de la spec 17 (qui ont pourtant construit des mécanismes tout
   aussi éloignés des cahiers sans jamais les modifier en cours de route).
7. **Compatibilité avec le futur connecteur LobbyPMS (prévu juste après ce chantier — contrainte
   posée explicitement par Jérôme, vérifiée avant d'être intégrée ici, pas supposée)** :
   - LobbyPMS n'a **aucune** notion d'heure/créneau pour une activité — vérifié à deux niveaux, pas
     seulement sur un résumé. (a) Contrat exact de `POST /api/v1/booking/add-product-service` (le
     seul appel qui « reflète » une activité Casa Kayam côté PMS), `docs/3-integrations/
     lobby_pms_api.md` lignes 629-641 : paramètres `api_token`, `booking_id`, `items[].product_id`,
     `items[].cant` (quantité), `items[].inventory_center_id` — aucun champ date/heure. Confirmé par
     un test réel documenté dans `docs/3-integrations/lobby_pms_implementation.md` (ligne 1058) :
     « that endpoint takes only `{product_id, cant}` — no price field » (a fortiori aucun champ
     temporel). (b) Tous les autres champs temporels de toute l'API Lobby (`fecha_ingreso`/
     `fecha_salida` d'une réservation, le `time` de `POST /block` = minutes de blocage d'une
     chambre) sont des concepts de **chambre**, jamais d'activité — grep exhaustif de
     `lobby_pms_api.md` sur `time`/`hour`/`schedule`/`check_in`/`check_out`, zéro occurrence hors
     contexte chambre. Ce n'est pas une omission incidentale : Lobby n'a même **aucune catégorie
     "day use"/capacité-0/prix-0** (`lobby_pms_implementation.md` ligne 1033, « no clean zero-night
     shell ») — son modèle de données est structurellement centré chambre/nuitée, une activité n'y
     existe que comme une ligne de charge greffée sur une réservation de chambre. `slot_start_time`
     reste donc strictement interne à hifago — rien à convertir ni à pousser vers Lobby, aucune
     adaptation prévue pour ce futur connecteur, et ce n'est pas près de changer vu la structure du
     PMS lui-même.
   - **Une activité ne peut jamais être vendue seule dans Lobby** (`422 The booking doesnt exits` si
     aucune réservation de chambre n'existe déjà dans la même commande — piège empirique confirmé
     n°6 du même document). Le legacy gère déjà ce cas par un statut de commande dédié
     (`reparacion`, exception `mirror_failed`), jamais bloquant pour la vente côté catalogue
     lui-même. Un jetski réservé seul (sans hébergement dans la même commande) tombera
     **identiquement** dans ce même cas une fois le futur connecteur hifago branché — ce n'est pas
     un trou introduit par les créneaux, c'est un comportement déjà hérité de toute activité
     standalone, documenté ici pour que personne ne le redécouvre comme une surprise au moment de
     brancher Lobby.
   - `products.lobby_product_id`/`lobby_category_id` (colonnes dormantes, déjà existantes,
     `20260813190232_catalog_core_tables.sql`) sont réutilisées telles quelles par une activité à
     créneaux — aucune colonne Lobby-spécifique nouvelle à ajouter pour ce chantier.
   - `pms_reconciliation_entries` (déjà en place côté hifago, `20260814210000_
     pms_reconciliation_entries.sql`, RPC-only, générique par `order_line_id`, actuellement jamais
     peuplée faute de connecteur réel) fonctionne sans changement pour une ligne à créneau. Seule
     obligation à respecter **quand** `modify_order_line` sera un jour étendu pour une ligne à
     créneau (hors périmètre de cette Tranche 1, cf. §2) : reprendre le même transfert de
     `pms_reconciliation_entries` vers la nouvelle ligne déjà en place sur les 3 branches existantes
     de `modify_order_line` — sinon un déplacement de créneau orphelinerait une entrée de
     réconciliation en attente une fois le connecteur réel branché.

**Points ouverts au moment de la planification, tranchés pendant l'implémentation (2026-08-18)** :

8. **Droit d'édition de la capacité par créneau côté socio** — posé explicitement à Jérôme en cours
   d'implémentation (question ciblée, pas une supposition) : **régime admin+socio unifié**, même
   arbitrage que `set_product_availability`/`set_room_type_availability` (le socio gère déjà ses
   cupos quotidiens partout ailleurs). `product_slot_rules` (la définition des horaires elle-même)
   reste strictement admin-only après publication — décision déjà en place, non rouverte. Seule la
   *capacité par jour* d'un créneau donné suit désormais ce régime unifié, implémenté tel quel dans
   `set_product_slot_capacity` (garde identité/propriété/capacité operator, mêmes 3 garde-fous que
   `set_room_type_availability`).
9. **Parité de la validation de non-chevauchement côté pipeline de proposition socio** — vérifiée
   par lecture du code, pas supposée : `apps/admin/components/product-form.tsx` (le formulaire
   partagé, importé aussi bien par `apps/admin/app/admin/products/new/page.tsx` que par
   `apps/admin/app/partner/(app)/products/new/page.tsx`) appelle le **même** `validateSlotRules`
   pour les deux parcours — la parité est automatique, pas un gap à combler séparément. Comme pour
   tout le reste de `validateSlotRules` (non-chevauchement de `price_tiers` compris, précédent
   direct), cette validation reste strictement côté app (aucun `CHECK` SQL équivalent) : un appel
   direct à l'API REST en contournant le formulaire pourrait en théorie insérer des règles qui se
   chevauchent — risque déjà accepté pour `price_tiers` avant cette spec, pas un gap nouveau introduit
   ici.

---

## 11. Annexe — traçabilité code→règle

| Section | Fichiers sources |
|---|---|
| §1 v1 legacy | `src/services/inventoryService.js` (`isPerSlot`, `assertCanReserve`, `getAvailability`), `src/services/migrations/{002_order_line_slot,003_calendar_closed_slot,008_internal_catalog_booking}.sql`, `docs/4-pilotage/journal/2026-07.md` (entrée 2026-07-30), `docs/2-reference/{03-app-admin,04-app-reservar,05-data-model,08-known-gaps}.md` |
| §1 v2 hifago état actuel | `supabase/migrations/20260816091000_product_slot_rules.sql` (commentaire de tête), `apps/admin/components/ProductSlotRulesBlock.tsx`, `apps/admin/lib/products/slotRules.ts`, `supabase/migrations/20260818090000_product_default_capacity.sql` (patron de matérialisation à généraliser) |
| §3 décisions déjà actées | `docs/specs/11-admin-activite-parcours-unifie-creneaux.md` §2/§10, `docs/specs/17-calendrier-disponibilite-refonte.md` §2/§10 point 12, `hifago/docs/00-modele-de-donnees.md` §1/§3, `hifago/docs/05-reference-technique.md` §1/§1bis |
| §0 patron RPC critique | `supabase/migrations/20260818090000_product_default_capacity.sql` (`create_order` Phase 2 matérialisation+verrouillage), `tests/concurrency/create_order_default_capacity.concurrency.mjs` (gabarit du futur test de concurrence) |
| §10 point 3 non-chevauchement | `apps/admin/lib/products/priceTiers.ts` (algorithme de référence, non-chevauchement de `price_tiers`) |
| §10 point 7 LobbyPMS | `docs/3-integrations/lobby_pms_api.md` lignes 629-641 (`add-product-service`, contrat exact), `docs/3-integrations/lobby_pms_implementation.md` lignes 1027-1036/1058 (aucune catégorie day-use, test réel du contrat), `docs/2-reference/06-lobbypms.md` (racine du dépôt, hors hifago/, résumé d'orientation), `supabase/migrations/20260814210000_pms_reconciliation_entries.sql`, `supabase/migrations/20260813190232_catalog_core_tables.sql` (`lobby_product_id`/`lobby_category_id`) |
| §5 précédent UI | `apps/admin/components/room-availability-grid.tsx` (grille TanStack Table + `SimpleTable`, dérogation reflow mobile), `apps/web/app/[locale]/products/[slug]/LodgingReservationForm.tsx` (précédent « nouvel écran, pas un mode ajouté ») |
| §10 point 8 (socio) | `supabase/migrations/20260817210000_room_type_availability_and_date_rates.sql` (`set_room_type_availability`), `supabase/migrations/20260813244500_set_product_availability_socio.sql` — mirror admin+socio suivi à l'identique par `set_product_slot_capacity` |
| §10 point 9 (parité socio) | `apps/admin/components/product-form.tsx` (appel `validateSlotRules`), `apps/admin/app/admin/products/new/page.tsx`, `apps/admin/app/partner/(app)/products/new/page.tsx` (les deux importent le même composant) |

## 12. Documents liés

- `docs/specs/11-admin-activite-parcours-unifie-creneaux.md` — définition de `product_slot_rules`,
  origine de cette Tranche.
- `docs/specs/17-calendrier-disponibilite-refonte.md` — nomme cette Tranche comme « Tranche 3 »
  (§2), documente le cas réel bloqué (§10 point 12) qui la motive.
- `docs/00-modele-de-donnees.md` §1 (sparse/override), §3 (créneaux horaires récurrents).
- `docs/05-reference-technique.md` §1/§1bis (squelette anti-survente).
- `docs/01-cahier-des-charges-client.md` §3a/§3d/§3e, `docs/02-cahier-des-charges-socio.md` §3d,
  `docs/03-cahier-des-charges-admin.md` §3g — vision produit existante (mécanisme binaire am/pm
  legacy), référencée mais non réécrite par cette spec (§10 point 6).
- `docs/2-reference/06-lobbypms.md` (racine du dépôt, hors hifago/) — surface API et pièges
  empiriques du connecteur legacy, seule référence réelle pour la compatibilité §10 point 7.
