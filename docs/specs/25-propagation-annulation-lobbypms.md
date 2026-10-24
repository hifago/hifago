---
id: specs-propagation-annulation-lobbypms
titre: "Propagation d'une annulation hifago vers LobbyPMS (C2)"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
reste: >
  Vérifiée en conditions réelles le 2026-08-27 (booking créé puis annulé chez Casa Kayam) —
  3 défauts trouvés par ce test live que les tests locaux ne voyaient pas, tous corrigés.
maj: 2026-08-27
resume: >
  Quand une réservation hifago adossée à LobbyPMS est annulée, le booking correspondant reste
  ouvert chez Lobby — la chambre est bloquée sans client. Cette spec établit pourquoi l'approche
  évidente (appeler cancel-booking depuis cancel_order) ne marche pas, et pose la forme retenue :
  une file en base alimentée dans la transaction des RPC de statut, drainée par une Edge Function.
mots_cles: [lobbypms, pms, annulation, cancel-booking, order_lines, pms_booking_id, reconciliation,
  edge function, pg_cron, file, idempotence, hifago]
repond_a:
  - "Quand une commande hifago est annulée, comment le booking LobbyPMS correspondant est-il annulé ?"
  - "Pourquoi ne pas simplement appeler cancel-booking depuis cancel_order ?"
  - "Qu'est-ce qui empêche d'annuler le booking d'une nuit en annulant une ligne d'activité ?"
---

# Spec 25 — Propagation d'une annulation vers LobbyPMS (C2)

> **Statut : implémenté et vérifié en conditions réelles le 2026-08-27** — un booking a été créé
> puis annulé sur le compte de Casa Kayam, et le nettoyage est confirmé (`RECORD_NOT_FOUND`).
> Les trois prémisses ci-dessous ont été vérifiées dans l'arbre, pas reprises de mémoire.
>
> **Le test live a trouvé TROIS défauts qu'aucun test local ne voyait**, et c'est le principal
> enseignement de cette spec : (1) le trigger enfilait sur `fulfilled`/`no_show`, donc hifago aurait
> demandé d'annuler des séjours **déjà effectués** ; (2) `cancellation_reason` est un CODE fermé, pas
> du texte libre ; (3) le succès de Lobby se lit **dans le corps**, jamais dans le statut HTTP.
> Les deux derniers étaient invisibles en local parce que le serveur de fixtures répondait
> gentiment `200` à tout — un faux Lobby plus poli que le vrai.

## 1. Le problème

`reserve-nights` (remplacé le 2026-10-23 par `pms-book-paid-orders`) crée un booking chez LobbyPMS après confirmation d'une commande, et écrit son
identifiant dans `order_lines.pms_booking_id`. **Rien n'annule jamais ce booking.** Une commande
annulée côté hifago laisse donc, chez Lobby, une chambre bloquée pour un client qui ne viendra pas —
invisible depuis hifago, et visible chez le partenaire comme une réservation valide.

`cancelLobbyBooking` existe dans `packages/domain/src/pms/lobbyClient.ts` depuis la Tranche 1. Elle
n'a **aucun call site**.

## 2. Pourquoi l'approche évidente ne marche pas

Le plan initial proposait un Route Handler appelé au moment de `cancel_order`. Les trois faits
suivants l'invalident.

### (a) `cancel_order` n'est pas le chemin d'annulation

`cancel_order` a **un seul appelant** : `apps/web/app/[locale]/account/orders/OrdersList.tsx:24` —
**dans le navigateur**, pour l'annulation par le client lui-même. Tout le reste passe ailleurs :

| Chemin | Ce qu'il produit | Couvert par `cancel_order` ? |
|---|---|---|
| Client annule depuis son compte | `cancelled_by_client` | oui |
| Admin / socio annule | `set_order_line_status` | **non** |
| Modification d'une ligne | `superseded` via `modify_order_line` | **non** |
| Commande impayée expirée | `expired` via `expire_stale_payment_orders` | **non** |

Un mécanisme accroché à `cancel_order` couvrirait donc **le cas le moins fréquent** et laisserait
les trois autres produire des bookings orphelins. C'est l'inverse de ce qu'on veut.

> ⚠️ Cas particulier de `expired` : `reserve-nights` tourne **avant** le paiement. Une commande
> abandonnée au paiement a donc déjà un booking chez Lobby quand elle expire — c'est probablement
> le cas le plus fréquent en volume, et il n'est couvert par rien aujourd'hui.
>
> **Mis à jour le 2026-10-23 (spec 21 §8.2).** Ce cas n'existe plus : le booking est créé APRÈS
> l'acompte (`pms-book-paid-orders`), plus jamais avant. Une commande abandonnée ou refusée au
> paiement n'a plus de booking à annuler. La file reste utile pour les annulations d'une commande
> payée — et ces bookings portent désormais un `payment` : Lobby refuse leur annulation par API
> (`RESTRICTED_RESERVATION`), ce qui n'est plus clos en silence mais envoyé en réconciliation
> (« annuler à la main dans Lobby », `resolve_pms_cancellation_restricted`).

### (b) `pms_booking_id` est partagé entre plusieurs lignes

`reserve-nights` écrit l'identifiant du booking sur **chaque ligne concernée** :
la ligne de logement reçoit le sien (`route.ts:194`), et **les lignes d'activité reçoivent le
`primaryBookingId` du logement** (`route.ts:239`) — parce que `add-product-service` exige un booking
porteur et que Lobby n'accepte pas la vente d'un service isolé.

Conséquence directe : **annuler « la ligne » ne peut pas vouloir dire annuler le booking.** Un client
qui retire une activité de sa commande annulerait la nuit d'hôtel. L'unité d'annulation est le
`pms_booking_id`, pas l'`order_line`.

### (c) Sortir de `reserved` fait quitter le seul filet existant

`claim_pms_poll_batch` (migration `20260819120000`) sélectionne les lignes
`where ol.pms_booking_id is not null and ol.status = 'reserved'`.

Les sept statuts possibles sont `reserved`, `fulfilled`, `no_show`, `cancelled_by_client`,
`cancelled_by_provider`, `expired`, `superseded`. **Dès qu'une ligne quitte `reserved`, elle sort du
lot de polling** — le booking Lobby correspondant n'est donc plus observé par quoi que ce soit. Une
annulation ne produit pas seulement un booking non annulé : elle produit un booking que **plus aucun
mécanisme ne regarde**.

### (d) L'autorisation n'était pas spécifiée

Le plan invoquait `reserve-nights` comme précédent — or c'est une route **non authentifiée**,
appelée en fire-and-forget depuis le checkout, et qui ne fait que rejouer un état déjà écrit en base.
Une route d'annulation, elle, déclenche une écriture chez un tiers à partir d'une entrée client. Le
précédent ne transpose pas.

## 3. Forme retenue

**Un point d'accroche côté base, drainé par une Edge Function.** Le patron existe déjà et il est
éprouvé : c'est celui de `pms-poll-bookings` et de `send-notification-emails`.

### 3.1 Déclenchement

Une entrée de file est posée **dans la même transaction** que le changement de statut — par un
**trigger `after update ... for each statement` sur `order_lines`**, et non par les RPC une à une
comme cette section le disait initialement. Les modifier toutes aurait voulu dire recréer quatre
grosses fonctions et rater la cinquième ; un trigger les attrape toutes, y compris celles qui
n'existent pas encore. Statement-level et non row-level : un trigger par ligne évaluerait la garde
« plus aucune ligne réservée » sur un état intermédiaire du même `UPDATE`.

**Liste blanche de statuts, jamais « tout sauf `reserved` »** :
`cancelled_by_client`, `cancelled_by_provider`, `expired`, `superseded`. `fulfilled` et `no_show`
n'en font PAS partie — le séjour a eu lieu, ou la nuit reste due. La première version enfilait sur
« tout sauf `reserved` » et aurait donc demandé l'annulation d'un séjour terminé, au cas le plus
nominal qui soit.

### 3.2 La règle qui évite le désastre de (b)

Une entrée n'est éligible que si, pour ce `pms_booking_id` **distinct**, **plus aucune ligne** n'est
`reserved` :

```sql
-- éligible si et seulement si :
not exists (
  select 1 from public.order_lines ol
   where ol.pms_booking_id = <le booking> and ol.status = 'reserved'
)
```

Retirer une activité d'une commande dont la nuit reste réservée ne déclenche donc rien. C'est la
traduction directe du fait (b) : l'unité d'annulation est le booking, pas la ligne.

### 3.3 Drainage

Une Edge Function `pms-cancel-bookings`, sur le patron de `pms-poll-bookings` : lecture du jeton par
la base (jamais par une variable d'environnement), appel de `cancelLobbyBooking`, marquage de
l'entrée. Jamais bloquante, jamais dans une transaction applicative.

### 3.4 Réponses attendues, et qui ne sont pas des incidents

| Réponse Lobby | Sens | Traitement |
|---|---|---|
| corps `{"cancel_booking": id}` | annulé | entrée close — **le succès se lit dans le CORPS, pas dans le statut** : Lobby ne renvoie pas 200 (constaté le 2026-08-27) |
| `422 RESTRICTED_RESERVATION` | booking portant déjà une charge | **cas ATTENDU** (spec 21 §0) — entrée close |
| `422 BOOKING_CHECK_IN_COMPLETE` | le client est arrivé | entrée close, rien à faire |
| `422 RECORD_NOT_FOUND` / `404` | booking déjà annulé chez Lobby | idempotent — entrée close |
| `422 INPUT_PARAMETERS` | **bug de NOTRE côté** | ÉCHEC, jamais un succès silencieux |
| autre | vraie panne | réessai borné (3), puis `failed` — jamais d'e-mail, le job nocturne en rapporte le compte |

⚠️ **`cancellation_reason` est un CODE, pas du texte** : `NS`/`RC`/`RE`/`TTC`/`CC`/`OTH`
(`docs/3-integrations/lobby_pms_api.md`). Envoyer une phrase donne `422 INPUT_PARAMETERS`. Le texte
humain va dans `description`. Constaté en conditions réelles, jamais par un test local.

⚠️ Le tri de cette colonne est ce qui décide si le job est utilisable. `pms_reconciliation_entries`
déclenche `notify_all_admins` (migration `20260824060000`) **sans dédup** : y router un cas attendu
produirait une salve d'e-mails à chaque annulation. C'est exactement le défaut C9, corrigé le
2026-08-26 sur le chemin jumeau — ne pas le réintroduire ici.

### 3.5 Idempotence

L'annulation doit pouvoir être rejouée sans effet de bord : un `404` est un succès, et une entrée
déjà close n'est jamais reprise. Le job peut donc être relancé à volonté, ce qui est la condition
pour qu'un cron sans supervision fine soit acceptable.

## 4. Ce que cette spec ne tranche pas

- **Le sens inverse existe déjà** — cette section disait le contraire avant le test live du
  2026-08-27, c'était faux. `pms-poll-bookings` détecte un booking disparu (`404` sur
  `GET /bookings/{id}`, seul signal possible — Lobby n'a pas de `deleted_at`), passe la ligne en
  `cancelled_by_provider` et ouvre une entrée de réconciliation. Ce qui n'est PAS écrit, et reste
  ouvert, c'est la règle métier : **que fait-on d'une commande payée dont le partenaire a annulé la
  nuit ?** Aujourd'hui la ligne change de statut et un admin est notifié, rien de plus.

  ⚠️ **Interaction connue et bénigne, à ne pas prendre pour un bug** : quand le poll passe la ligne
  en `cancelled_by_provider`, le trigger de C2 s'arme et enfile une annulation pour un booking que
  Lobby a déjà supprimé. Le drainage reçoit alors `RECORD_NOT_FOUND` et clôt l'entrée en `done`.
  Coût : un appel API inutile par annulation partenaire. Le supprimer demanderait de distinguer
  l'origine de l'annulation dans le trigger — complexité réelle pour un gain nul, non retenu.
- **Le remboursement.** Annuler chez Lobby ne dit rien du ledger ni de Mercado Pago. La politique
  d'annulation hifago est une règle fixe et universelle (`docs/00-modele-de-donnees.md` §1) ;
  l'articulation avec ce job est à poser avant implémentation.

## 5. À vérifier avant d'implémenter

1. Relire les définitions exactes de `set_order_line_status`, `modify_order_line` et
   `expire_stale_payment_orders` : cette spec s'appuie sur leur comportement de statut, pas sur leur
   code ligne à ligne.
2. Confirmer avec Jérôme que `422 RESTRICTED_RESERVATION` doit bien clore l'entrée en silence
   (booking déjà facturé côté partenaire) plutôt que remonter à un humain.
3. Trancher le point 4 (remboursement) — sans quoi le job annulera chez Lobby des commandes dont
   l'argent n'a pas bougé.
