---
id: specs-activite-vente-sans-date
titre: "Activité vendue sans date ni horaire — quota optionnel par jour ou par semaine"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: brouillon
maj: 2026-11-05
resume: >
  Une activité peut se vendre comme une prestation, sans calendrier, sans ouverture de date et sans
  horaire (cas réel : le mastering). Le client choisit seulement la quantité. Le produit est soit
  illimité, soit plafonné à N ventes par jour ou par semaine — décomptées sur la période de
  l'achat, à l'heure de Bogotá. Après le paiement, le partenaire contacte le client pour fixer le
  rendez-vous ; la ligne apparaît chez lui dans une liste « Por agendar », jamais dans l'agenda.
revise: ["docs/01-cahier-des-charges-client.md#2b"]
mots_cles: [activite, vente, sans date, sans calendrier, sans horaire, quota, cupo, par jour, par semaine, mastering, por agendar, create_order, sale_mode]
repond_a:
  - "Comment vendre une activité sans date ni horaire (ex. le mastering) ?"
  - "Comment limiter une activité à N ventes par jour ou par semaine sans calendrier ?"
  - "À quelle période une vente sans date est-elle décomptée ?"
  - "Où le partenaire voit-il une vente sans date à planifier ?"
---

# Activité vendue sans date ni horaire

> **Cible stack** : hifago (une migration, `create_order` et ses satellites, `apps/admin`,
> `apps/web`). Demande de Jérôme du 2026-11-05 : « Une activité Hifago, comme le mastering, ne doit
> pas dépendre d'un calendrier ni de l'ouverture d'une date » — « plutôt combien de masters par
> semaine ou par jour sont libres, pas forcément avec des dates, des horaires : pour les activités
> qui s'apparentent plus à une vente ».

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** | brouillon |
| 1 | Contexte et problème | brouillon |
| 3 | Décisions de Jérôme (2026-11-05) | tranché |
| 10 | Points ouverts | **arbitrage Jérôme requis** |
| 11 | Lots de livraison | brouillon |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Modèle de données (delta)

| Élément | Statut | Détail |
|---|---|---|
| `products.sale_mode` | **à ajouter** | `text not null default 'scheduled'`, `check in ('scheduled','sale')`, `check (sale_mode = 'scheduled' or type = 'activity')`. Même déclencheur de repli que `pricing_unit` (spec 43) quand le type quitte `activity`. |
| `products.sale_quota_period` | **à ajouter** | `text` nullable, `check in ('day','week')`. `null` = illimité. |
| `products.sale_quota` | **à ajouter** | `int` nullable, `≥ 1`. `check ((sale_quota is null) = (sale_quota_period is null))` et `check (sale_mode = 'sale' or sale_quota_period is null)`. |
| `products` en `sale` | **contrainte** | Aucune ligne `product_slot_rules` (garde dans `replace_product_slot_rules` et à la bascule de mode) ; `pricing_unit` ∈ {`per_person`,`per_activity`} — `per_hour` sans horaire n'a pas de sens (spec 43 : déjà « vitrina »). |
| `product_sale_quota_usage` | **à créer** | `(product_id uuid, period_start date, booked int not null default 0 check (booked >= 0))`, PK `(product_id, period_start)`. **RPC-only** (`CLAUDE.md` §3.1 : compteur de capacité) : RLS activée, aucune policy, `revoke all` pour `anon`/`authenticated`. Pas de colonne `capacity` : le plafond est lu sur `products.sale_quota` au moment de la vente (un quota baissé n'annule rien de déjà vendu). |
| `order_lines.date` | **devient nullable** | `null` uniquement pour une ligne de vente. `check ((date is null) = (sale_mode = 'sale'))` sur l'instantané ci-dessous. |
| `order_lines.sale_mode` | **à ajouter** | `text` nullable, instantané posé par `create_order` / `create_manual_order_line` (comme `pricing_unit`, spec 43). C'est lui, jamais le produit, que lisent la libération, l'affichage et l'agenda. |
| `order_lines.sale_period_start` | **à ajouter** | `date` nullable : début de la période où la vente a été décomptée (`null` si illimité ou `scheduled`). Sert à libérer le bon compteur à l'annulation. |

### Période d'une vente (seule définition)

`public.sale_period_start(p_period text, p_at timestamptz) returns date` — `stable`, fermée à la
Data API. `day` → la date civile à `America/Bogota` ; `week` → le **lundi** (ISO 8601) de la semaine
civile à `America/Bogota`. Côté TS, `packages/domain/src/time/bogotaDates.ts` en porte le miroir
pour l'affichage, testé contre la même table de cas (`CLAUDE.md` §11.20).

### `create_order` — branche « vente » (squelette `docs/05-reference-technique.md`, via `/hifago-rpc-critique`)

1. Ligne d'un produit `sale_mode = 'sale'` : `date`, `end_date`, `slot_start_time` doivent être
   **absents** → sinon `reason = 'sale_line_has_date'`. Inversement, une ligne sans date d'un produit
   `scheduled` reste refusée comme aujourd'hui.
2. Quota `null` → aucun compteur, aucun verrou (A13 tient pour l'illimité).
3. Quota posé → `insert … on conflict do nothing` sur `(product_id, period_start)`, puis
   `select … for update` de cette ligne, **dans l'ordre global des verrous** (après
   `product_availability`/créneaux, par `product_id` croissant) ; `booked + qty > sale_quota` →
   `reason = 'sale_quota_exhausted'` ; sinon `booked = booked + qty` et la ligne porte
   `sale_period_start`.
4. Prix, acompte, plafond `product_qty_cap`, remises de groupe : inchangés.
5. Test de concurrence à barrière (`/hifago-test concurrence`) : quota 1, 20 tentatives
   simultanées, exactement 1 succès. Plus un cas « veille de lundi 23:59 / lundi 00:00 Bogotá ».

### Satellites qui lisent `order_lines.date` (tous à adapter — liste fermée par grep au lot 1)

`cart_lines_availability` (branche vente : reste du quota de la période courante) ·
`cancel_order_line` et libération (décrément de `product_sale_quota_usage` sur
`sale_period_start`, jamais la période courante) · `create_manual_order_line` (walk-in socio) ·
`modify_order_line*` · notifications et e-mails (`'del ' || to_char(date…)` → « por agendar ») ·
agenda socio (spec 20 : une ligne sans date n'entre jamais dans la grille) · Mis reservas ·
export/jobs. Tout `ol.date >= v_today` qui filtre les lignes « à venir » doit garder les ventes non
servies (`date is null`).

### Écrans

| Où | Comportement |
|---|---|
| Admin / proposition partenaire | Pour une activité : choix « Con horarios » / « Venta sin fecha ». En vente : horaires masqués et **non exigés** (exception à la règle du 2026-11-04 `slot_rules_required`), quota « Sin límite / N por día / N por semana ». |
| Fiche vitrine | Nouveau `ModoReserva = "venta"` (`resolverModoReserva`, avant `vitrina` si pas d'URL externe) : prix, quantité, « Añadir al carrito ». Aucun calendrier. Quota : « Quedan N esta semana / hoy », épuisé → bouton désactivé, « Disponible de nuevo el lunes / mañana ». |
| Panier, Mis reservas, e-mails | « Fecha por acordar con el prestador » au lieu d'une date. |
| Socio | Liste « Por agendar » (ventes payées, non annulées) avec le contact du client — hors agenda. |
| Recherche | Visible même avec des dates saisies (cahier §2a, déjà la règle). |

### Cas limites

- Vente à 23:59 le dimanche → décomptée sur la semaine qui finit ; l'annulation libère CETTE semaine, même passée (sans effet sur la vente courante).
- Quota baissé sous `booked` → plus de vente sur la période, rien d'annulé.
- Produit repassé `scheduled` avec des ventes non servies → ses lignes gardent leur instantané `sale`.
- `mockData/activities/mastering.json` : `sale_mode = 'sale'`, `external_booking_url` retiré, quota à fixer par Jérôme.

---

## 1. Contexte et problème

Le cahier (§2b, « Ce qu'exige une ligne de prestation ») prévoit un **produit sans date** et la
lacune A13 dit « sans date, rien à décompter ». Rien de cela n'a été construit dans le nouveau
stack :

- `order_lines.date` est `not null` depuis `20260813194515` ; `create_order` lit `(v_line->>'date')::date`
  pour toute ligne.
- `resolverModoReserva` (`apps/web/lib/catalog/producto.ts`) retombe sur `"date"` pour une activité
  sans horaire : elle exige alors une date **ouverte** (`calendar_default_open` / `product_calendar`).
- Depuis le 2026-11-04 (`20261104120000_horaires_obligatoires_et_proposables`), une activité **naît
  avec au moins un horaire** (`slot_rules_required`).

Le mastering ne se réserve donc qu'en inventant des dates et des horaires, ou reste une vitrine
(bouton contact seul, journal du 2026-09-14).

## 3. Décisions de Jérôme (2026-11-05)

| Question | Choix |
|---|---|
| Limite de quantité | **Au choix par produit** : illimité, N par jour ou N par semaine. |
| Période décomptée | **Celle de l'achat** (jour ou semaine civile à Bogotá) — le client ne choisit rien. |
| Après la vente | **Le partenaire contacte le client** ; la vente apparaît dans « Por agendar », hors agenda. |

Révise A13 : un produit sans date **peut** désormais décompter un cupo — celui de sa période d'achat.

## 10. Points ouverts — arbitrage Jérôme requis

1. **Annulation d'une vente sans date** : la politique actuelle se calcule en heures avant la date
   du service. Sans date : annulable sans frais tant que le partenaire n'a pas fixé le rendez-vous ?
   ou règle fixe (ex. N jours après l'achat) ?
2. **Le partenaire enregistre-t-il le rendez-vous convenu dans Hifago** (la ligne quitte « Por
   agendar » et entre dans l'agenda) ? Proposé : oui, en lot 3, sans effet sur le quota.
3. **Afficher le reste du quota au client** (« Quedan 2 esta semana ») ou seulement
   disponible/épuisé ?
4. Semaine = lundi → dimanche (ISO) : à confirmer.

## 11. Lots de livraison

1. **Base** (`/hifago-migration` puis `/hifago-rpc-critique`) : colonnes, compteur, `sale_period_start`,
   branche de `create_order`, satellites, pgTAP + test de concurrence.
2. **Admin et partenaire** : formulaire, propositions, modération, liste « Por agendar ».
3. **Vitrine** : fiche, panier, Mis reservas, e-mails ; mockData du mastering. Rendu réel vérifié.
