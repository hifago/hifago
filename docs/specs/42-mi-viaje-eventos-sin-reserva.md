---
id: specs-mi-viaje-eventos-sin-reserva
titre: "Mi viaje — ajouter un evento non réservable, sans réservation"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-10-19
resume: >
  Un evento qu'on ne réserve pas en ligne (vitrine, lien externe ou rien) peut être ajouté à
  « Mi viaje » à une date de son calendrier, sans réservation ni paiement. Il y apparaît dans
  l'ordre des dates avec les réservations du panier, disparaît une fois sa date passée, et ne
  touche jamais create_order. Une table à part (trip_events), RLS directe.
mots_cles: [mi viaje, evento, sin reserva, trip_events, panier, agenda, cul-de-sac, spec 30]
repond_a:
  - "Comment un evento non réservable s'ajoute-t-il à Mi viaje ?"
  - "Pourquoi les eventos de Mi viaje ne sont-ils pas dans cart_items ?"
  - "Que devient un evento de Mi viaje après sa date, ou si l'admin change ses dates ?"
---

# Mi viaje — ajouter un evento non réservable, sans réservation

> **Cible stack** : hifago (`apps/web` + une migration).

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** | implemente |
| 1 | Contexte et problème | implemente |
| 2 | Portée | implemente |
| 3 | Décisions retenues | implemente |
| 4 | Parcours cible | implemente |
| 5 | Écrans | implemente |
| 10 | Décisions tranchées / points ouverts | implemente |
| 12 | Documents liés | implemente |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Modèle de données (delta)

`public.trip_events` — **créée**, RLS directe (§3.2 : données propres, aucun compteur).

| Colonne | Type | Contrainte |
|---|---|---|
| `id` | uuid | pk, `gen_random_uuid()` |
| `account_id` | uuid not null | FK `partner_accounts(id)` **on delete cascade** |
| `product_id` | uuid not null | FK `products(id)` **on delete cascade** |
| `date` | date not null | une occurrence de l'evento (vérifiée à la lecture, pas à l'écriture) |
| `created_at` | timestamptz not null | `now()` |

- `unique (account_id, product_id, date)` — sert aussi l'accès par `account_id`.
- Grants : `select, insert, delete` à `authenticated` (anonymes compris). Aucun `update`.
- Policies : `select`/`delete` → `account_id = (select auth.uid())` ; `insert` → idem **et**
  `exists (select 1 from public.products p where p.id = product_id and p.type = 'evento' and not
  p.online_bookable)` (sous la RLS de `products` : un evento non publié est refusé).

### RPC

| Fonction | Retour | Posture |
|---|---|---|
| `trip_events_status()` | `table (id uuid, on_occurrence boolean)` | `sql stable`, invoker, `search_path = ''`, `execute` à `authenticated` |

`on_occurrence` = `exists (select 1 from public.expand_event_occurrences(product_id, date, date))`
— le calcul de récurrence existant, jamais un second. Lignes de l'appelant seulement.

### Invariants

1. `cart_items`, `create_order`, `cart_lines_availability` et `/pago` sont **inchangés** : un
   evento de Mi viaje n'est jamais une ligne de commande, et le paiement du reste ne l'efface pas.
2. Seul un evento **non réservable en ligne** (`online_bookable = false`) passe par cette table ;
   un evento réservable (gratuit ou payant) suit le panier comme toute activité.
3. Passé = `date < todayInBogota()` (`@hifago/domain`) → absent partout (Mi viaje, pastille de
   l'en-tête, fusion à la connexion). Aucun job de purge : un filtre de lecture.
4. Un produit invisible (dépublié → RLS de `products`) → la ligne est absente partout.
5. Pastille de l'en-tête = lignes du panier + eventos à venir visibles — une seule lecture,
   dans `CartContext`.
6. Ordre de Mi viaje : date croissante, réservations et eventos mêlés ; à date égale, les
   réservations d'abord.
7. Ajout idempotent : un doublon (23505) est un succès, jamais une erreur affichée.
8. Fusion à la connexion (mot de passe et Google) : les eventos anonymes à venir suivent le panier,
   insérés **un par un** (un evento devenu invalide n'emporte pas les autres).

### Cas limites

- evento sans occurrence à venir dans l'horizon (6 mois) → pas de formulaire ; lien externe seul
  s'il existe, sinon rien (cul-de-sac de la spec 30 §10.5, désormais réduit à ce seul cas).
- L'admin change les dates → `on_occurrence = false` → Mi viaje garde la ligne avec un avis
  « ya no tiene lugar en esta fecha » et le bouton « Quitar ».
- L'evento devient réservable en ligne après l'ajout → la ligne reste ; son nom mène à la fiche,
  qui porte alors le formulaire de réservation.
- Mi viaje sans ligne de panier mais avec des eventos → la liste, sans total ni « Ir a pagar ».
- Lecture des statuts en panne → aucune ligne signalée (le statut n'est qu'un confort).
- Lecture de `trip_events` en panne → l'erreur lève (même règle que `getCartLines`).

### Fichiers touchés

- `supabase/migrations/20261019190000_trip_events.sql` ; `packages/supabase/src/database.types.ts`
  (deux entrées ajoutées à la main : le générateur local, plus récent, réécrivait tout le fichier)
- `supabase/tests/database/trip_events.test.sql` (19 cas ; mutation de la policy d'insert → 5 rouges)
- `apps/web/lib/cart/CartContext.tsx` (+ test) ; `apps/web/lib/cart/useAddToCart.ts` (`useAddTripEvent`)
- `apps/web/lib/cart/getTripEvents.ts` ; `apps/web/lib/cart/copiarEventosDeViaje.ts` (créés)
- `apps/web/lib/catalog/producto.ts` + `tipos.ts` (`fechasEventoSinReserva`)
- `apps/web/app/[locale]/(vitrine)/productos/[slug]/FichaProducto.tsx`
- `apps/web/app/[locale]/(vitrine)/productos/[slug]/EventoSinReservaForm.tsx` (créé, + test)
- `apps/web/components/organisms/CartSummary.tsx` (+ test) ; `apps/web/components/organisms/SiteHeader.tsx` (+ test)
- `apps/web/app/[locale]/(tunnel)/mi-viaje/page.tsx` (+ stories `ViajeConEventos`, `SoloEventos`)
- `apps/web/app/[locale]/(auth)/entrar/LoginForm.tsx` ; `apps/web/components/molecules/GoogleButton.tsx` (+ tests)
- `apps/web/messages/{es,en}/{CartPage,ProductPage}.json`
- `apps/web/.storybook/{preview.tsx,support/datos.ts,support/supabaseFalso.ts}` (filtre `gte`, `getTripEvents`)
- `apps/web/e2e/mi-viaje-evento-sin-reserva.spec.ts` (le chemin heureux, vraie base)

## 1. Contexte et problème

Demande de Jérôme (2026-10-19) : « Événements ajoutables à "Mi Viaje" : un événement doit pouvoir
s'y ajouter même sans réservation. »

Aujourd'hui Mi viaje **est** le panier (`cart_items`, spec 32). Un evento non réservable en ligne
y est refusé deux fois : `cart_lines_availability` le signale `not_sellable` et `create_order`
refuse la commande entière — l'ajouter tel quel rendrait tout le voyage impayable. Et
`create_order` vide le panier dès qu'une commande existe : un evento « noté » y disparaîtrait au
paiement du reste. Sur la fiche, un evento sans lien externe n'a aucun bouton (spec 30 §10.5).

## 2. Portée

**In** : ajout depuis la fiche d'un evento non réservable, choix de la date, affichage et retrait
dans Mi viaje, pastille de l'en-tête, fusion à la connexion, disparition après la date.

**Out** : rappel ou notification avant l'evento ; partage du voyage ; eventos dans le récapitulatif
de commande ou les e-mails ; nettoyage en base des lignes passées (un filtre suffit, les identités
anonymes sont déjà purgées à 30 jours avec tout ce qui en dépend).

## 3. Décisions retenues (Jérôme, 2026-10-19)

1. Le nom reste « Mi viaje » ; le bouton, « Añadir a Mi viaje » (libellé déjà en place).
2. Un evento réservable — gratuit ou payant — se traite comme toute activité : panier, réservation.
   Seul l'evento non réservable en ligne passe par ce nouveau chemin.
3. Evento récurrent : le client choisit la date, parce que Mi viaje est rangé par date.
4. Après sa date, l'evento disparaît de Mi viaje.

## 4. Parcours cible

1. Fiche d'un evento non réservable → calendrier de ses occurrences à venir (mêmes bornes que le
   formulaire de réservation : aujourd'hui à Guatapé → 6 mois) → choix d'une date →
   « Añadir a Mi viaje ».
2. Session anonyme créée si besoin (même déclencheur que le panier, spec 31 inv. 1) → insert
   `trip_events` → toast « Añadido a Mi viaje. » → même retour que l'evento réservable :
   `/alojamientos` pour la nuit de l'occurrence (retour Gabriel du 2026-09-16).
3. Mi viaje : l'evento apparaît à sa date, entre les réservations, marqué « Sin reserva », avec
   « Quitar ».
4. Le lendemain de sa date, il n'apparaît plus nulle part.

## 5. Écrans

- **Fiche evento non réservable** : `EventoSinReservaForm` (calendrier, sans quantité ni
  capacité) au-dessus du bouton de lien externe s'il existe.
- **Mi viaje** : une ligne evento = nom (lien vers la fiche) · établissement · date et heure ·
  puce « Sin reserva », sans prix ni quantité ; `on_occurrence = false` → avis d'erreur. Le total
  et « Ir a pagar » ne concernent que les lignes du panier, et disparaissent s'il n'y en a aucune.
  Le sous-titre « Tu viaje del … al … » couvre aussi les eventos.

## 10. Décisions tranchées / points ouverts

| Point | Décision | Raison |
|---|---|---|
| Table à part plutôt qu'une colonne dans `cart_items` | tranché | Une colonne obligeait à réécrire `create_order` (RPC critique, §4) pour ignorer et préserver ces lignes. |
| `on delete cascade` sur les deux FK, contre la règle de la spec 31 inv. 9 | tranché | Inv. 9 protège une identité qui a laissé une trace ; un evento noté n'en est pas une, au même titre que `cart_items` que les quatre fonctions de suppression vident déjà à la main. La cascade évite d'en réécrire quatre. |
| Occurrence vérifiée à la lecture, pas dans la policy d'insert | tranché | Le calcul de récurrence ne doit exister qu'une fois (`expand_event_occurrences`), et la lecture doit de toute façon détecter une date changée par l'admin après coup. |
| « Passé » filtré en TypeScript, pas en SQL | tranché | `today_in_bogota()` est fermée aux rôles de la Data API ; `todayInBogota()` en est la contrepartie déjà utilisée par le front. |
| Retour après ajout vers `/alojamientos` | tranché, réversible | Même geste que l'evento réservable — la nuit de l'evento reste à couvrir. |

## 12. Documents liés

- Spec 30 §10.5 (evento sans lien = cul-de-sac) ; spec 31 (identité anonyme, inv. 1 et 9) ;
  spec 32 (panier en base) ; `20260915120000_evento_online_bookable.sql`
  (`expand_event_occurrences`).
