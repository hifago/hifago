---
id: specs-activite-prix-par-heure-ou-par-activite
titre: "Activité : prix par personne, par heure ou par activité complète — personnes min/max"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-10-25
resume: >
  Une activité choisit son mode de prix : par personne (l'existant), par heure ou par activité
  complète, et annonce un nombre de personnes min/max (simple mention). À l'heure, le client choisit
  la date, l'heure de début et le nombre d'heures sur des horaires d'une heure : 3 h à partir de
  10 h consomment une place sur les créneaux 10 h, 11 h et 12 h — aucun chevauchement possible,
  vérifié sous verrou dans create_order. La fiche, le panier, Mis reservas et l'agenda du
  prestataire disent « por hora », « 10:00–13:00 · 3 horas ».
mots_cles: [activite, prix, par heure, por hora, par personne, activite complete, personas, min max, creneaux, horaires, slot, wakeboard, bateau, pricing_unit, create_order]
repond_a:
  - "Comment un prestataire facture-t-il une activité à l'heure ?"
  - "Que compte le cupo d'une activité à l'heure ou à l'activité complète ?"
  - "Comment une réservation de 3 heures bloque-t-elle les créneaux sans chevauchement ?"
  - "Où sont le nombre minimum et maximum de personnes d'une activité ?"
---

# Activité : prix par personne, par heure ou par activité complète

> **Cible stack** : hifago (`apps/web`, `apps/admin`, une migration). Demande de Jérôme du
> 2026-10-25, cas réel : un bateau de wakeboard à 420 000 COP de l'heure, 1 à 10 personnes.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** | implemente |
| 1 | Contexte et décisions de Jérôme | implemente |
| 10 | Décisions tranchées / points ouverts | implemente |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Modèle de données (delta)

| Élément | Statut | Détail |
|---|---|---|
| `products.pricing_unit` | **ajoutée** | `text not null default 'per_person'`, `check in ('per_person','per_hour','per_activity')`, `check (pricing_unit = 'per_person' or type = 'activity')`. Le déclencheur `products_pricing_unit_follows_type` la remet à `per_person` quand le type quitte `activity`. |
| `products.min_persons`, `products.max_persons` | **ajoutées** | `int`, nullables, `≥ 1`, `min_persons ≤ max_persons`. **Informatives** (décision de Jérôme) : jamais saisies par le client, jamais vérifiées par `create_order`. |
| `order_lines.pricing_unit` | **ajoutée** | `text` nullable, même `check` de valeurs. Instantané posé par `create_order` / `create_manual_order_line` pour une ligne d'activité (`null` pour tout autre type et pour les lignes antérieures). C'est lui, jamais le produit, que lisent la libération et l'affichage d'une ligne. |
| `products.qty_unit` | **supprimée** | Colonne morte depuis le schéma d'origine (jamais lue). Les 6 activités héritées marquées `hours` sont listées au journal du 2026-10-25 : elles passent `per_person`, leur facturation ne change pas. |

### Ce que compte la quantité d'une ligne

| `pricing_unit` | `qty` = | Prix | Capacité consommée |
|---|---|---|---|
| `per_person` | personnes | `prix (ou tramo) × qty` | `qty` places sur la date ou sur le créneau — inchangé |
| `per_hour` | heures | `prix (ou tramo) × qty` | **1 place sur chacun des `qty` créneaux horaires** `start`, `start+1h`, … |
| `per_activity` | activités (la fiche envoie 1) | `prix × qty` | `qty` places sur la date ou le créneau — inchangé |

`public.order_line_slot_units(start time, qty int, pricing_unit text) returns table(slot_start_time
time, units int)` — `immutable`, fermée à la Data API — est la SEULE définition de cette table de
consommation. `create_order`, `cart_lines_availability`, `create_manual_order_line`,
`release_order_line_capacity` et `lock_order_capacity_rows` l'appellent toutes. Pour `per_hour`,
elle ne rend jamais une heure qui franchirait minuit : `count(*) < qty` signifie « plage hors de la
journée ».

### Invariants

1. Une activité `per_hour` se réserve **toujours** sur un créneau : sans `slot_start_time`, refus
   `slot_required` (même sans aucune règle d'horaire). Les `qty` créneaux couverts doivent tous
   exister ce jour-là avec `slot_duration_minutes = 60`, sinon `slot_not_found` ; chacun doit avoir
   une place libre en comptant les autres lignes du panier qui le couvrent, sinon `full`.
2. Dans `create_order`, les créneaux consommés sont matérialisés, verrouillés (`for update`, triés
   par produit, date, heure) puis vérifiés et écrits d'après le `pricing_unit` relu en Phase 1
   (tableau par ligne), jamais relu dans le produit entre deux phases.
3. Libération (annulation, expiration, refus PMS…) : `release_order_line_capacity` rend `units`
   sur chaque créneau consommé, d'après `order_lines.pricing_unit`.
4. `pricing_unit` est gelé tant que le produit porte une ligne `reserved`
   (`products_capacity_flags_frozen`, message `capacity_flags_frozen_while_reserved`).
5. Une activité `per_hour` n'a que des règles d'horaire de 60 minutes : déclencheur sur
   `product_slot_rules` et contrôle au passage d'un produit à `per_hour`, message
   `per_hour_requires_hourly_slots`.
6. Toute activité existante reste `per_person` et sa fiche affiche désormais « por persona »
   (décision de Jérôme) — c'est ce que `create_order` facture déjà.

### Écrans

- **Admin et partenaire** (`ProductTypeFields`, activité) : « Modo de precio » (Por persona / Por
  hora / Por actividad completa), libellés du prix et du minimum selon le mode (« Horas mínimas por
  reserva » à l'heure ; aucun maximum par réservation, migration 20261025120000), « Personas mínimas /
  máximas » pour l'heure et l'activité complète. À l'heure : tramos possibles (comptés en heures), « Cupo diario » masqué — les heures
  vendables sont les horaires (créneaux de 60 min, capacité = nombre de bateaux ou d'équipes),
  exigés à la création. Activité complète : prix simple, sans tramos ni bornes de quantité ; le
  cupo compte des activités par jour (ou par créneau).
- **Vitrine** : suffixe du prix « por persona / por hora / por actividad completa » ; puce « De 1 a
  10 personas » ; à l'heure, choix de l'heure de début (seulement celles d'où tient le minimum
  d'heures) puis du nombre d'heures (borné par les heures libres consécutives) ;
  activité complète : pas de champ quantité (1). Une activité `per_hour` sans horaires n'a pas de
  formulaire de réservation.
- **Panier, paiement, Mis reservas, résultat de commande, agenda et détail prestataire** : une ligne
  `per_hour` s'affiche « 10:00–13:00 · 3 horas » ; l'agenda pose un bloc de `qty` heures.

### Tests

- pgTAP `activity_pricing_unit.test.sql` : consommation, refus (`slot_required`, `slot_not_found`
  hors journée / créneau absent / 30 min, `full` par chevauchement en base et dans le panier), prix,
  instantané, libération à l'annulation, gel, règles de 60 min, parité `cart_lines_availability`,
  propositions partenaire.
- Concurrence `create_order_per_hour.concurrency.mjs` : N acheteurs, plages qui se chevauchent sur
  un bateau de capacité 1 — jamais deux réservations sur la même heure.

---

## 1. Contexte et décisions de Jérôme

« Lorsqu'on charge une activité dans le portail partenaire, il faudrait que tu mettes, si on charge
pour l'heure, l'activité entière ou par personne […] il faut qu'il y ait le nombre minimum de
personnes et le nombre maximum de personnes autorisées […] le client peut réserver 1 heure,
2 heures […] le cupo diario por defecto serait le nombre d'heures maximum qui peut être réservé. »

Trois questions posées le 2026-10-25, réponses :

1. **Le client saisit-il le nombre de personnes ?** Non, simple mention sur la fiche.
2. **À l'heure, le client choisit-il une heure de début ?** Oui : heure fixe, sans chevauchement.
   D'où le modèle « créneaux d'une heure » : le cupo diario de la demande devient le nombre de
   créneaux horaires ouverts dans la journée, et la capacité d'un créneau le nombre de bateaux.
3. **Les activités existantes ?** Elles affichent « por persona », ce qu'elles facturent déjà.

Avant ce lot, toute activité valait `prix × quantité` et la quantité décomptait le cupo du jour (ou
du créneau) : rien ne disait si elle comptait des personnes ou des heures.

## 10. Décisions tranchées / points ouverts

- **Créneaux existants plutôt qu'une nouvelle capacité** : réutiliser `product_slot_availability`
  (verrous, grille de fermeture admin/partenaire, agenda, libération centralisée) plutôt qu'une
  table d'intervalles. Coût : une ligne à l'heure touche `qty` lignes de capacité au lieu d'une.
- **Horaires d'une heure exactement** pour le mode à l'heure : une heure de prix = un créneau. Des
  créneaux de 30 minutes facturés à l'heure ne sont pas pris en charge.
- **Construit par-dessus 20261025100000 et 20261025120000** (deux sessions parallèles du même jour) :
  les trois migrations partent ensemble, dans l'ordre, au même `/push-db`.
- **Proposition d'édition sans mode** : la whitelist pose `pricing_unit` à null quand l'écran ne
  l'envoie pas ; l'approbation garde alors le mode actuel (jamais un retour à « por persona »).
- **Modifier une ligne à créneau** reste hors périmètre (`modify_order_line` la refuse déjà).
- **Les cartes du catalogue** n'affichent toujours pas l'unité du prix (seule la fiche le fait) —
  inchangé, à trancher si Jérôme le souhaite.
- **Les 6 activités héritées « hours »** (cours, heures de studio) affichent « por persona » jusqu'à
  ce qu'on les passe « Por hora » avec des horaires d'une heure.
