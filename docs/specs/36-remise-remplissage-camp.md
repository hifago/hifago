---
id: specs-remise-remplissage-camp
titre: "Remise par seuil de remplissage cumulé (camps)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-09-14
revise: ["docs/01-cahier-des-charges-client.md#remise-optionnelle-par-quantite-nombre-de-personnes", "docs/00-modele-de-donnees.md#255"]
resume: >
  Un camp peut porter une réduction déclenchée par le remplissage CUMULÉ d'une session (toutes les
  réservations séparées d'un même départ), pas la quantité d'une seule ligne — mécanisme distinct de
  `price_tiers` (spec 08). Seuil de personnes et pourcentage librement configurables par camp
  (`products.group_discount_threshold_qty`/`group_discount_pct`), appliqués dans `create_order` sans
  requête supplémentaire. Camp uniquement (seul type avec un remplissage cumulé fiable aujourd'hui) ;
  aucun remboursement rétroactif de l'acompte déjà capturé ; vitrine en texte statique, jamais un
  compteur de remplissage public en temps réel.
mots_cles: [camp, remise, descuento, group_discount, remplissage, product_availability, create_order, price_tiers]
repond_a:
  - "Comment configurer une réduction de groupe sur un camp ?"
  - "Le seuil porte-t-il sur une seule réservation ou sur le remplissage total du camp ?"
  - "Que se passe-t-il pour l'acompte déjà payé quand le seuil est franchi plus tard ?"
  - "Pourquoi ce mécanisme est-il différent de price_tiers ?"
---

# Remise par seuil de remplissage cumulé (camps)

> **Cible stack** : hifago, `supabase/` + `apps/admin` + `apps/web`. Demande de Jérôme le
> 2026-09-14 : « sur un camp, en fonction du nombre de personnes qui viennent, tu peux avoir une
> réduction — un camp de 20 places, si plus de 16 personnes viennent, -20% ». Cadrée dans la même
> session (deux tours d'`AskUserQuestion`) avant tout code — voir §3 pour le détail de chaque
> décision.
>
> **✅ ENTIÈREMENT LIVRÉE le 2026-09-14** — migration, RPC, parité admin/socio, UI admin + vitrine,
> tests pgTAP + concurrence + unitaires, mock data. Vérifiée en local : suite pgTAP complète (995
> tests), concurrence camp (3 scénarios × 5 runs propres), rendu réel de la fiche vitrine du camp
> mock (`campamento-1`, `docs/journal/2026-09.md`).

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** | ✅ livré 2026-09-14 |
| 1 | Contexte et problème | ✅ 2026-09-14 |
| 2 | Portée | ✅ 2026-09-14 |
| 3 | Décisions retenues (entretien) | ✅ 2026-09-14 |
| 4 | Parcours cible | ✅ 2026-09-14 |
| 5 | Écran(s) | ✅ 2026-09-14 |
| 6-9 | Modèle de données / RPC / invariants / cas limites (fusionnées dans 0) | ✅ 2026-09-14 |
| 10 | Décisions tranchées / points ouverts | ✅ 2026-09-14 |
| 11 | Annexe — traçabilité | ✅ 2026-09-14 |
| 12 | Documents liés | ✅ 2026-09-14 |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Modèle de données (delta)

| Table | Colonne | Type | Note |
|---|---|---|---|
| `products` | `group_discount_threshold_qty` | `int`, nullable | seuil de remplissage (nb de personnes) |
| `products` | `group_discount_pct` | `numeric(5,4)`, nullable | fraction (0.20 = 20%), même convention que `acompte_pct` |

CHECK : `products_group_discount_threshold_positive` (≥1), `products_group_discount_pct_range`
(0 < pct < 1), `products_group_discount_pair` (les deux ensemble ou aucun), `products_group_discount_camp_only`
(`type <> 'camp' ⇒ les deux null`). Pas de CHECK `threshold ≤ default_capacity` — souvent null pour
un camp (cupos posés par départ via `product_availability`) ; validation souple côté formulaire.
Écriture RLS directe (`products_write_admin`), pas de RPC dédiée — même précédent que `price_tiers`.
Migration : `supabase/migrations/20260914130000_camp_group_discount_threshold.sql`.

### RPC modifiée

`create_order(p_holder_name text, p_holder_email text, p_holder_phone text, p_marketing_consent boolean)`
— signature **inchangée**, `create or replace`. Fichier vivant :
`supabase/migrations/20260910160000_create_order_lit_panier_et_attribution.sql` (dernière
définition ; les numéros de ligne ci-dessous datent du 2026-09-14, à re-vérifier par grep si le
fichier a encore bougé) :
1. Lecture (Phase 1, boucle produit par ligne) : `group_discount_threshold_qty`/`group_discount_pct`
   ajoutés au même `select` que `price_tiers`, stockés dans `v_products_group_discount_threshold_qty[]`/
   `v_products_group_discount_pct[]`.
2. Capture (Phase 3, branche générique camp/activité/transport) : `v_camp_fill_before_qty[v_line_idx] := v_booked`
   juste après la lecture de `product_availability.booked` déjà faite sous verrou pour la vérif de
   capacité — **aucune requête supplémentaire**.
3. Application (Phase 4, même branche) : si `v_line_type = 'camp'` et seuil configuré et
   `v_camp_fill_before_qty[v_line_idx] + v_line_qty >= seuil`, alors
   `v_total_cop := round(prix_unitaire * qty * (1 - pct))`, sinon prix plein. `price_cop` (unitaire,
   stocké sur `order_lines`) reste inchangé — seul `total_cop` porte la remise ; `acompte_cop` en
   hérite automatiquement (`round(total_cop * acompte_pct)`, formule inchangée).

Parité proposition socio (4 RPC, migration `20260914140000_camp_group_discount_proposal_parity.sql`,
signatures toutes inchangées) : `submit_product_creation_proposal` (whitelist camp),
`create_product_from_proposal` (colonnes insert), `submit_product_proposal` (nouveau bloc whitelist
camp, absent jusqu'ici au-delà de `default_capacity`), `moderate_product_proposal` (branche édition
— écriture **gardée** par `v_final_payload ? 'clé'`, jamais inconditionnelle, même raisonnement que
`external_booking_url`/`price_label`).

### Invariants

- Le seuil compare le remplissage **après** la ligne courante (`fill_avant + qty >= seuil`), pas
  avant — la réservation qui fait elle-même franchir le seuil en bénéficie.
- Aucun recalcul rétroactif de l'acompte des lignes déjà commitées avant le franchissement.
- `group_discount_*` structurellement `null` pour tout type ≠ `camp` (CHECK en base, pas seulement
  côté UI).
- Le calcul reste dans le même verrou/aller-retour réseau que la vérification de capacité
  (`product_availability`, `FOR UPDATE`) — jamais une requête séparée.
- Vitrine : texte statique dérivé de la config produit, jamais un compteur de remplissage public en
  temps réel, jamais un prix recalculé côté client (le prix engageant reste révélé par `create_order`
  au checkout).

### Cas limites

- Camp sans `group_discount_threshold_qty`/`pct` configurés → comportement inchangé (`total_cop = price_cop * qty`).
- Une réservation qui atteint exactement le seuil (`fill_avant + qty == seuil`) → remisée (`>=`, pas `>`).
- Un groupe qui réserve d'un coup assez de places pour dépasser le seuil en une seule ligne (`fill_avant = 0`) → remisé lui-même (grâce à la comparaison « après »).
- Proposition socio `pending` créée avant cette migration, approuvée après → n'efface pas un
  `group_discount` déjà posé sur le produit (écriture gardée par `?` dans `moderate_product_proposal`).
- Seuil supérieur à `default_capacity`/à la capacité réelle du départ → accepté en base (pas de
  CHECK croisé), avertissement seulement côté formulaire admin.

### Fichiers touchés

- `supabase/migrations/20260914130000_camp_group_discount_threshold.sql` (schéma + `create_order`)
- `supabase/migrations/20260914140000_camp_group_discount_proposal_parity.sql` (4 RPC de proposition)
- `supabase/tests/database/create_order.test.sql` (cas 22a/b/c)
- `tests/concurrency/create_order_camp.concurrency.mjs` (scénario 3)
- `apps/admin/lib/products/groupDiscount.ts` (+ `.test.ts`), `productTypeGating.ts`,
  `useProductTypeFieldsState.ts`, `productCreationPayload.ts`
- `apps/admin/components/product-type-fields/`, `product-form.tsx`, `availability-calendar.tsx`
  (+ `.css`)
- `apps/admin/app/admin/products/[id]/availability/page.tsx`
- `apps/web/lib/catalog/tipos.ts`, `producto.ts`
- `apps/web/app/[locale]/(vitrine)/productos/[slug]/FichaProducto.tsx`, `ReservationForm.tsx`
- `apps/web/messages/{es,en}/ProductPage.json` (clé `groupDiscount`)
- `mockData/camps/campamento1.json`, `supabase/scripts/seed-mock-data.mjs`

## 1. Contexte et problème

Le cahier des charges client décrit depuis le 2026-08-11/13 une « remise optionnelle par
quantité/nombre de personnes » sur les produits hors nuits (activité, transport, camp, evento),
seuil et pourcentage tous deux libres, configurable par l'admin **et** le prestataire propriétaire
(`docs/01-cahier-des-charges-client.md`). Ce mécanisme n'avait **jamais été construit** pour aucun
type de produit (`docs/00-modele-de-donnees.md` le documentait explicitement comme un écart). Ce
qui existait déjà — `price_tiers` (spec 08, `implemente`) — résout un problème différent : un tarif
dégressif par **quantité d'une seule ligne de commande**, jamais le remplissage cumulé de plusieurs
réservations séparées.

Jérôme a demandé ce mécanisme le 2026-09-14, avec l'exemple concret d'un camp de 20 places où le
tarif baisse de 20% à partir de 16 inscrits — un cas typiquement porté par plusieurs familles/
individus qui réservent séparément, pas par un seul acheteur qui commande 16 places d'un coup.

## 2. Portée

**In** : type `camp` uniquement. Seuil + pourcentage configurables par camp (admin et prestataire).
Application dans `create_order` sur le remplissage cumulé (`product_availability.booked`).
Information statique côté vitrine. Visibilité admin du franchissement sur le calendrier de cupos.

**Out** (chantiers distincts, non traités ici) :
- Extension à activité/transport/evento — le cahier des charges les vise, mais aucun n'a aujourd'hui
  de notion de remplissage cumulé par session comme `product_availability` pour un camp ; définir ce
  que serait une « session cumulée » pour ces types est un travail à part.
- Affichage public du remplissage en temps réel (décision explicite, §3).
- Tout ajustement/remboursement automatique de l'acompte déjà capturé (décision explicite, §3).
- Édition du seuil/pourcentage après création d'un camp existant — même limitation que
  `duration_days` (« gap préexistant, jamais éditable aujourd'hui », `apps/admin/components/product-form.tsx`),
  pas une régression introduite ici.

## 3. Décisions retenues (entretien)

Trois questions posées par `AskUserQuestion`, réponse recommandée retenue à chaque fois :

1. **Ligne qui franchit le seuil** — bénéficie de la remise sur sa propre part (comparaison sur le
   remplissage *après* cette ligne, `fill_avant + qty >= seuil`). Sans ça, un groupe qui réserve
   d'un coup assez de places pour franchir le seuil ne recevrait jamais la remise lui-même.
2. **Acompte déjà payé** — aucun remboursement rétroactif en ligne pour les réservations
   antérieures au franchissement. Seul le solde réglé à l'arrivée (mécanisme d'acompte existant,
   spec 19 : Mercado Pago ne capture que 17/10/7% du prix, le reste se règle hors plateforme,
   en espèces, directement avec l'établissement) reflète le remplissage final constaté — ajusté
   manuellement par l'établissement, jamais par une automatisation.
3. **Remplissage public** — texte statique de la règle uniquement (« à partir de N personnes,
   -X% »), jamais un compteur de remplissage en temps réel : évite d'exposer un signal commercial
   sensible (taux de remplissage réel, visible aussi par la concurrence).

Confirmé aussi : le pourcentage ET le seuil sont tous deux **librement configurables par camp**
(pas de valeur fixe imposée par le code) — conforme à la décision déjà actée dans le cahier des
charges.

## 4. Parcours cible

1. L'admin (ou le prestataire propriétaire, via proposition modérée) configure, sur un camp, un
   seuil de personnes et un pourcentage de remise — les deux ensemble, ou aucun des deux.
2. Des visiteurs réservent séparément des places sur une même date de départ. Chaque réservation
   verrouille `product_availability` (déjà le comportement existant) ; `create_order` compare le
   remplissage résultant au seuil configuré.
3. Tant que le remplissage cumulé (avant + cette ligne) reste sous le seuil, chaque ligne paie le
   prix plein. Dès qu'une ligne fait atteindre ou dépasser le seuil, **cette ligne et toutes les
   suivantes** sur ce départ paient le prix remisé — les lignes déjà commitées avant ne sont jamais
   recalculées.
4. À l'arrivée, l'établissement voit sur son calendrier de cupos si le seuil est atteint (badge
   dédié) et ajuste le solde encaissé en espèces en conséquence, pour tous les participants du
   départ — hors plateforme, comme le reste du solde aujourd'hui.

## 5. Écran(s)

**Formulaire produit camp** (`apps/admin/components/product-type-fields.tsx`, admin direct et
proposition socio via le même composant) : deux champs optionnels côte à côte, juste après le cupo
par défaut — « Descuento por grupo — a partir de (personas) » et « Porcentaje de descuento » (saisi
en entier lisible 1-99, converti en fraction pour la colonne). Texte d'aide explicite : dépend du
total de personnes inscrites sur la salida, pas de la quantité d'une seule réserva. Les deux se
remplissent ensemble ou restent vides (`validateGroupDiscount`).

**Calendrier de cupos** (`AvailabilityCalendar`, `/admin/products/[id]/availability`) : le badge
d'un jour `configured` dont `booked >= group_discount_threshold_qty` affiche « N/capacité ·
Descuento activo » (texte, pas seulement une couleur) avec un contour distinct.

**Fiche produit camp** (vitrine, `ReservationForm.tsx`) : phrase statique sous le calendrier de
réservation, dérivée de la config du produit — « A partir de N personas anotadas en esta salida, el
precio baja un X%. » (clé `ProductPage.groupDiscount`, ES/EN). Aucun chiffre de remplissage réel,
aucun recalcul de prix côté client.

## 10. Décisions tranchées / points ouverts

Tranchées : voir §3. Aucun point laissé ouvert dans ce lot — les trois questions structurantes ont
toutes été arbitrées avant le code. Point à surveiller, signalé mais non bloquant : le seuil et le
pourcentage restent création-only pour un camp existant (hérite de la limitation déjà en place sur
`duration_days`) — si Jérôme veut pouvoir les ajuster après coup sans recréer le produit, c'est une
extension distincte de `product-form.tsx` (édition des champs camp-only), pas couverte ici.

## 11. Annexe — traçabilité code→règle

| Règle | Fichier(s) |
|---|---|
| Seuil/pct sur `products`, camp only | `20260914130000_camp_group_discount_threshold.sql` |
| Calcul dans `create_order` | idem, fonction `create_order` |
| Parité proposition socio | `20260914140000_camp_group_discount_proposal_parity.sql` |
| Validation formulaire | `apps/admin/lib/products/groupDiscount.ts` |
| Gating par type | `apps/admin/lib/products/productTypeGating.ts` (`hasGroupDiscount`) |
| Payload de création | `apps/admin/lib/products/productCreationPayload.ts` |
| Champs du formulaire | `apps/admin/components/product-type-fields.tsx` |
| Badge calendrier admin | `apps/admin/components/availability-calendar.tsx` (+ `.css`) |
| Texte vitrine | `apps/web/app/[locale]/(vitrine)/productos/[slug]/ReservationForm.tsx`, messages `ProductPage.groupDiscount` |
| Tests fonctionnels | `supabase/tests/database/create_order.test.sql` cas 22a/b/c |
| Test de concurrence | `tests/concurrency/create_order_camp.concurrency.mjs` scénario 3 |
| Test unitaire validation | `apps/admin/lib/products/groupDiscount.test.ts` |
| Donnée de démonstration | `mockData/camps/campamento1.json` (seuil 16, -20%, capacité 20) |

## 12. Documents liés

- `docs/01-cahier-des-charges-client.md` — décision d'origine (2026-08-11/13), révisée par cette spec.
- `docs/00-modele-de-donnees.md` — corrigé après livraison (le mécanisme n'est plus « jamais construit »
  pour le cas camp).
- `docs/specs/08-admin-gestion-activite.md` — `price_tiers`, mécanisme complémentaire et distinct.
- `docs/specs/19-paiement-mercadopago-acompte-ledger.md` — mécanisme d'acompte/solde réutilisé tel
  quel (aucune modification ici).
- `docs/05-reference-technique.md` §1 — squelette anti-survente suivi pour la modification de
  `create_order`.
