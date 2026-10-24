---
id: specs-garantie-confirmation-paiement
titre: "Garantir la confirmation d'un paiement quand le client ne revient pas"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: partiel
reste: >
  Lot A + B1 + B2 livrés et vérifiés en local le 2026-09-22 (§C). Restent : validation par Jérôme
  des textes des e-mails client 9-10 (§5) et du trigger « drapeaux de capacité gelés » (§10.1) ;
  déploiement préprod dans l'ordre prescrit (§C) ; en réel : capture des corps d'erreur MP des
  remboursements (§10.5), mesure du délai d'indexation de /payments/search (§10.3), un PSE
  abandonné (§10.4).
maj: 2026-09-22
resume: >
  Note de décision pour Jérôme (D1 réconciliation qui pilote l'expiration, D2 plafond des paiements
  pending, D3 remboursement) après l'incident HFG-000013 du 2026-09-20, puis — après arbitrage — la
  spec du job de réconciliation Mercado Pago, de l'expiration sous verrou et du chemin de
  remboursement. Lot A (durcissement), B1 (réconciliation qui pilote l'expiration, libération des
  cupos, plafond 2 h, bascule) et B2 (remboursement, e-mails et écran client, bouton admin) livrés
  les 2026-09-20/22 ; restent la validation des textes d'e-mails par Jérôme et le déploiement.
mots_cles: [paiement, mercadopago, reconciliation, expiration, remboursement, webhook, cron, arbitrage]
repond_a:
  - "Comment être sûr que le paiement passe si le client ne revient pas ?"
  - "Que décide-t-on sur l'expiration, les paiements pending et le remboursement ?"
  - "Qu'est-ce qui est déjà livré et qu'est-ce qui attend Jérôme ?"
---

# Garantir la confirmation d'un paiement quand le client ne revient pas

> **Cible stack** : hifago. **Statut** : arbitrage rendu le 2026-09-20 (§A) ; Lot A (§B), B1 et B2
> (§C) livrés et vérifiés en local les 2026-09-21/22. Reste : validation des textes d'e-mails 9-10
> (§5), déploiement préprod dans l'ordre prescrit (§C), mesures en réel (§10.3-5).

## A. Note de décision — arbitrage Jérôme requis

**La question** (Jérôme, 2026-09-20) : « comment être sûr que le paiement passe si la personne ne
revient pas ? » — onglet fermé sur la page Mercado Pago, paiement depuis l'app bancaire, réseau
perdu. Tout ce qui se déclenche au retour du client (`/reserva/<jeton>` se rafraîchit 20 fois
pendant une minute, `OrderResult.tsx:52-53,116-129`) est un confort d'affichage, jamais une
garantie. Aujourd'hui la confirmation tient par le webhook seul — et il n'a pas tenu pendant un
mois (piège 19). Pendant ce mois, `expire_stale_payment_orders` (cron `*/5`) a détruit une
réservation dont l'argent était encaissé (HFG-000013), sans jamais demander à Mercado Pago.

**Ce qui est mesuré, pas supposé** (chemins:lignes dans `docs/journal/2026-09.md`, 2026-09-20) : le
cron expire sans interroger MP ; jusqu'à ce jour la RPC du webhook réécrivait `approved` un
paiement annulé et envoyait 3 e-mails « reserva confirmada » sur des lignes expirées ; les deux
verrouillaient dans l'ordre inverse (interblocage **reproduit** par mutation : 4 `40P01` sur 12
webhooks concurrents) ; aucun chemin de remboursement ; aucun écran pour les exceptions de paiement.

### D1 — La réconciliation pilote l'expiration · **recommandé : oui**

| | |
|---|---|
| **Option recommandée** | Un seul job `payments-reconcile` (pg_cron `*/2` → Edge Function → `GET /v1/payments/search?external_reference=<payments.id>` → RPC de décision sous verrou), qui **remplace** `expire_stale_payment_orders` (`cron.unschedule` + `drop`). Le claim se fait par **commande candidate** (même prédicat qu'aujourd'hui : > 30 min, ligne `reserved` avec acompte dû) — jamais par paiement seul, sinon une commande sans intent ou dont le seul paiement est `rejected` ne serait plus jamais expirée. Sans aucun `payments` ⇒ aucune préférence n'existe ⇒ expiration directe. Sinon MP est interrogé sur CHAQUE `external_reference` de la commande (un `rejected` peut avoir été retenté dans la même session). Approuvé au bon montant ⇒ appliqué (même RPC que le webhook) · approuvé au mauvais montant ⇒ entrée `refund_required` + expiration · `pending`/`in_process` ⇒ prolongé (D2) · rien ⇒ expiré. **MP injoignable ⇒ rien n'expire ce tour-ci** (échec fermé, `CLAUDE.md` §4.4). Le job prouve l'identité du compte (`GET /users/me` = `collector_id` persisté à la création de la préférence) : une recherche vide avec le mauvais token est exactement l'incident du 2026-09-20, elle ne vaut jamais « pas payé ». Un heartbeat (`job_heartbeats`) et un watchdog SQL `*/15` qui n'expire jamais mais alerte une fois si le job ne bat plus. |
| **Coût** | ~2 jours : 1 migration (heartbeat, `claim_orders_to_reconcile`, `reconcile_order`, `expire_payment_order`, `apply_payment_webhook_checked`, wrapper cron, unschedule + drop, watchdog), 1 Edge Function (copie de `pms-poll-bookings`), secret `MERCADOPAGO_ACCESS_TOKEN` côté Supabase (**même compte** que celui de Vercel), pgTAP + test d'intégration avec fixture HTTP + mesure du délai d'indexation en préprod. |
| **Ce qu'on perd** | L'expiration n'est plus du SQL pur qui tourne même si l'Edge Function est morte (d'où le watchdog). Une place peut rester immobilisée > 30 min pendant une panne Mercado Pago — c'est voulu. |
| **Si on ne fait rien** | Chaque raté du webhook (panne, mauvaise clé, retry MP > 30 min) reproduit HFG-000013 : argent encaissé, réservation détruite. Depuis la migration `20260920120000` la commande fantôme est évitée et l'admin est prévenu, mais le client a payé pour rien et il faut rembourser à la main. |
| **À mesurer avant de figer** | Le délai d'indexation de `/payments/search` n'est pas documenté par MP : le heartbeat l'enregistre en préprod ; jamais d'expiration avant `created_at + 30 min + marge`, premier examen à +2 min, la préférence meurt à +28. |

**D1-bis (déjà au backlog, « Trou (a) »)** : la nouvelle RPC d'expiration est l'endroit naturel
pour **libérer les cupos hifago** (miroir de `release_order_after_pms_refusal`, dont l'en-tête
argumente déjà qu'une expiration n'a aucune compensation à devoir ; les bookings Lobby sont déjà
annulés par trigger). À trancher en même temps. Sinon : comportement actuel, la place reste perdue.

### D2 — Plafond des paiements `pending` chez Mercado Pago · **recommandé : 2 h**

| | |
|---|---|
| **Option recommandée** | Un PSE (`bank_transfer`, non exclu de la préférence, `client.ts:104-106`) reste `pending_waiting_transfer` sans délai documenté, et un `pending` n'expire chez MP qu'après 30 jours : sans borne, une place est immobilisée pour rien. Règle : `pending` toléré jusqu'à `payments.created_at + 2 h` ; au-delà, le job tente `PUT /v1/payments/{id} status=cancelled` (re-GET pour confirmer), puis expire. L'annulation MP est un **meilleur effort, borné** (3 tentatives ou +2 h 30) : si un virement en cours est inannulable, on expire quand même — la garde « approved sur cancelled » (§B) et D3 sont le filet. |
| **Coût** | Inclus dans D1 (une branche). |
| **Alternative** | Exclure `bank_transfer` (1 ligne) : plus simple, mais retire PSE, le moyen de paiement le plus courant en Colombie sans carte. |
| **Si on ne fait rien** | Place bloquée jusqu'à 30 jours par un virement jamais finalisé. |
| **À mesurer** | Un PSE réel en préprod : est-il annulable une fois lancé, et que fait MP si le virement aboutit après l'annulation. |

### D3 — Le chemin de remboursement · **recommandé : détection automatique + écran admin, PAS de re-réservation automatique**

| | |
|---|---|
| **Option recommandée** | Trois situations produisent « argent encaissé, rien honoré » : payé après expiration/annulation, écart de montant, double paiement. Les trois sont **déjà détectées** côté serveur (§B) : entrée `kind = 'refund_required'`, e-mail admin, écran `/admin/reconciliation` « Pagos ». Reste à livrer : le bouton **« Reembolsar »** (Route Handler admin → RPC `request_payment_refund` idempotente → `POST /v1/payments/{id}/refunds` avec `X-Idempotency-Key` → RPC `finalize_payment_refund`, `payments.status = 'refunded'` à ajouter au CHECK), et **l'information du client** — aujourd'hui il n'a AUCUN signal (pas d'e-mail, et `/reserva` lui dit « no se completó el pago »). Proposition : un 9ᵉ e-mail `client_payment_received_not_honored` (« recibimos tu pago, la reserva no pudo confirmarse, te contactamos ») et un état d'écran dédié. Texte à valider par Jérôme (liste fermée, `docs/06`). |
| **Pourquoi pas de « réhonorer » automatique** | Ce serait une RPC critique refaisant les vérifications de capacité de `create_order` sur quatre tables, plus une re-réservation chez Lobby (le booking est déjà en file d'annulation à l'expiration), plus un test de concurrence — pour un cas qui devient rare dès que D1 est en place (préférence morte à +28 min, `pending` prolongé, annulation MP avant expiration). Rien d'existant n'est réutilisable (`modify_order_line` ne revérifie qu'une ligne et refuse `camp`). Le bouton « Resolver » (note obligatoire) couvre le réhonorage **manuel** : l'admin rappelle le client, refait la réservation par le tunnel, rembourse l'ancienne. Un client préfère souvent qu'on lui garde sa place — c'est justement pourquoi la décision doit rester humaine, cas par cas. |
| **Coût** | ~1,5 jour (table `payment_refunds` + 2 RPC de la spec 19 Tranche 2, Route Handler, bouton, e-mail client, pgTAP, Vitest). |
| **Si on ne fait rien** | Remboursement à la main depuis le panel Mercado Pago, sans trace dans le ledger ; le client sans nouvelles jusqu'à ce que quelqu'un l'appelle. |

**Ordre proposé** : D1 (+ D1-bis si oui) d'abord — c'est ce qui rend les trois cas rares — puis D3, D2 dedans.

## B. Déjà livré, sans décision produit — migration `20260920120000_harden_apply_payment_webhook.sql`

1. **Ordre des verrous** : `orders` d'abord, toujours (règle 8 de `.claude/rules/supabase.md`).
   Prouvé par `tests/concurrency/apply_payment_webhook_vs_expiry.concurrency.mjs` : 5 runs
   propres ; avec l'ancien corps, 4 interblocages `40P01` sur 12.
2. **Garde « rien à honorer »** : un `approved` sur un paiement `cancelled`, sur une commande sans
   ligne `reserved`/`fulfilled`/`no_show`, ou déjà payée par un autre paiement, ne touche ni
   `payments.status` ni `orders.payment_status`, n'envoie aucun e-mail, crée UNE entrée
   `refund_required` (motif dérivé des statuts réels), répond `{ok:true, reason:'paid_after_expiry'
   |'double_payment'}` → 200, pas de retry MP. Idempotent par index unique partiel
   (`mp_payment_id` where `kind = 'refund_required'`). 30 assertions pgTAP, vérifiées par mutation.
3. Après une approbation, les autres paiements de la commande (`pending`/`rejected`) passent
   `cancelled` ; un `rejected` en retard ne rétrograde jamais une commande qu'un autre paiement porte.
4. Route webhook : l'écart de montant est typé `refund_required` ; le rejeu (23505) est absorbé.
5. E-mail admin : lien absolu (Vault `admin_app_public_url`), numéro + montant, sujet dédié.
6. Écran `/admin/reconciliation` : section « Pagos » (lecture + « Resolver ») et compteur d'accueil.

> **Retourné le 2026-10-23 (spec 21 §8.2) — la garde `pms_booking_missing`.** Le webhook `approved`
> refusait d'appliquer un paiement dont une nuit PMS n'avait pas de booking Lobby
> (`refund_required/pms_booking_missing`, migration `20261002185102`), puisque le booking précédait
> toujours le paiement. Depuis que Lobby se réserve APRÈS l'acompte, cette situation est le cas
> NORMAL : le webhook passe la commande `paid`, pose une demande dans `pms_booking_requests` et DIFFÈRE
> les e-mails 5/6/7 jusqu'au booking (`notify_order_confirmed`). La garde disparaît ; aucune entrée
> `refund_required` n'est plus créée pour ce motif (les anciennes restent lisibles). Si Lobby refuse
> ensuite, l'argent n'est pas rendu automatiquement : la commande va en file « à traiter »
> (`pms_reconciliation_entries`), les remboursements restant suspendus. `create_payment_intent`
> garde `pms_booking_missing`, mais seulement sans booking NI hold de moins de 5 minutes.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| A | Note de décision | tranchée le 2026-09-20 (Jérôme via Gabriel) : D1 oui · D1-bis oui · D2 PSE + 2 h · D3 écran + e-mail + décision humaine |
| B | Déjà livré (durcissement) | livré |
| C | Livré B1 + B2 | livré le 2026-09-22, déploiement préprod à faire |
| 0 | Contrat compact | implémenté (signatures = code) |
| 1-5, 10-12 | Contexte, portée, décisions, parcours, écrans, points ouverts, traçabilité | rédigés ; §5 textes à valider |

## C. Livré — B1 (2026-09-21) et B2 (2026-09-22)

- **Migrations** `20260921100000_payments_reconcile.sql` (colonnes, `job_heartbeats`, `payment_refunds`,
  drapeaux gelés, `lock_order_capacity_rows` + `release_order_line_capacity`, `release_order_after_pms_refusal`
  réécrite, `expire_payment_order`, `apply_payment_webhook` révisée, `apply_payment_webhook_checked`,
  claims, `reconcile_order`, `mark_mp_cancel_attempt`, `record_mp_payment_status`, wrapper cron,
  watchdog, CHECK e-mails), `20260921100100_payments_reconcile_switch.sql` (`unschedule` + `drop`),
  `20260921100200_modify_order_line_locks_orders_first.sql` (interblocage réel trouvé par le test de
  concurrence : l'`insert` de la ligne de remplacement prend un verrou de clé étrangère sur `orders`),
  `20260922100000_payment_refunds.sql` (4 RPC, trigger e-mails client, contrat client).
- **Edge Function** `supabase/functions/payments-reconcile/index.ts` (identité du token, recherche,
  décision déléguée, annulation MP, surveillance 48 h, remboursements, heartbeat, budget d'appels).
- **apps/web** : `client.ts`/`create/route.ts` (préférence et collector persistés), mapper
  `refunded`/`charged_back`, `mock-confirm` (`pending`, `reason`), `orderState.ts` (états
  `refunded`, `paid_not_honored`, `awaiting` seulement avec une ligne vivante), contrats
  `getOrderByToken`/`getMyOrders`, `OrderResult.tsx`, messages es/en.
- **apps/admin** : `RefundDialog.tsx`, `PaymentReconciliationList.tsx` (« Reembolsar », états du
  remboursement, groupe « Reembolsados »), `reconciliation/page.tsx` (embed `payment_refunds`).
- **Tests** : pgTAP `payments_reconcile.test.sql` (119 assertions, 6 mutations consignées),
  `payments.test.sql` (65), garde-fou `service_role_only_functions` (+15), `get_order_by_token`,
  `release_order_after_pms_refusal` ; Vitest web/domaine/admin ; intégration
  `tests/payments-integration/payments_reconcile.integration.mjs` (8 scénarios sur le vrai runtime
  Edge, fixture MP port 4547) ; concurrence `apply_payment_webhook_vs_expiry` (réécrit) et
  `reconcile_order_vs_webhook` (job vs webhook ; expiration vs `modify_order_line`).
- **Déploiement préprod, dans cet ordre** : `supabase secrets set MERCADOPAGO_ACCESS_TOKEN=…`
  (même compte que `hifago-web`) → `supabase db push` (4 migrations) → `supabase functions deploy
  payments-reconcile` → `vercel deploy` web puis admin → lire `cron.job`, `job_heartbeats`,
  `net._http_response`. Puis capturer les corps réels de `/refunds` pour la fixture (§10.5), lire
  `stats.index_delay_ms_max` (§10.3), observer un PSE réel (§10.4).

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Endpoints / RPC (toutes `security definer`, `set search_path = ''`, `revoke all … from public, anon, authenticated` ; `grant … to service_role` pour celles du job ; listées dans `service_role_only_functions.test.sql`)

| Fonction | Appelant | Rôle |
|---|---|---|
| `claim_orders_to_reconcile(p_limit int default 25) returns table(order_id, created_at, claimed_at, payment_status, payments jsonb)` | job | commandes `unpaid`/`pending` avec (ligne `reserved` à acompte dû OU un `payments` `pending`) ET (un `payments` OU > 30 min) ET > 2 min ET non réclamée depuis 2 min ; `for update skip locked` ; pose et RENVOIE `reconcile_claimed_at` (= horodatage de contrôle) |
| `claim_payments_to_watch(p_limit int default 25) returns table(payment_id, order_id, claimed_at)` | job | paiements `rejected`/`cancelled` < 48 h dont le statut MP n'est pas terminal, non vérifiés depuis 10 min — surveillance APRÈS expiration |
| `record_mp_payment_status(p_payment_id uuid, p_mp_payments jsonb, p_checked_at timestamptz) returns jsonb` | job | écrit `mp_last_status`/`mp_last_checked_at` ; un `approved` → `apply_payment_webhook_checked` (la garde du Lot A décide) |
| `apply_payment_webhook_checked(p_mp_payment_id text, p_external_reference uuid, p_status text, p_transaction_amount numeric, p_raw_event jsonb) returns jsonb` | job | `approved` au mauvais montant → entrée `refund_required`/`amount_mismatch` + `{ok:true, reason:'amount_mismatch'}` ; sinon délègue à `apply_payment_webhook` (signature vivante intacte) |
| `reconcile_order(p_order_id uuid, p_mp_payments jsonb, p_checked_at timestamptz, p_collector_id text, p_expiry_margin interval default '2 minutes') returns jsonb {action, …}` | job | LA décision, sous verrou `orders` : `noop` · `identity_mismatch` · `applied` · `closed` (plus aucune ligne vivante) · `kept_pending` · `cancel_at_mp` (+ `mp_payment_ids`) · `expired` · `kept` |
| `mark_mp_cancel_attempt(p_payment_id uuid, p_mp_status_after text) returns void` | job | après `PUT cancel` + re-GET : incrémente `mp_cancel_attempts`, écrit le statut relu |
| `expire_payment_order(p_order_id uuid, p_checked_at timestamptz, p_force boolean default false) returns jsonb` | job (via `reconcile_order`) | refuse `not_candidate` / `stale_check` (> 2 min) / `mp_approved` / `mp_pending` (sous borne 3 tentatives ou 2 h 30) ; sinon verrous en bloc, `release_order_line_capacity` par ligne, UN `update order_lines → expired`, ledger, `payments pending → cancelled`, `orders → unpaid` |
| `release_order_line_capacity(p_line_id uuid) returns void` | interne | rend les places d'UNE ligne sur des FAITS (`availability_blocks` de la ligne pour la ressource partagée ; `product_availability`/`product_slot_availability` sauf ligne PMS) ; `raise warning` si `booked < qty` |
| `lock_order_capacity_rows(p_line_ids uuid[]) returns void` | interne | verrouille dans l'ordre de `create_order` : `product_availability` → `provider_resource_calendar` → `product_slot_availability` |
| `heartbeat_job(p_job text, p_ok boolean, p_stats jsonb default '{}', p_error text default null) returns void` | job | `job_heartbeats` |
| `payments_reconcile_watchdog() returns void` | pg_cron `*/15` | alerte admin UNE fois si `last_ok_at` (repli `created_at`) < now − 15 min ; n'expire jamais rien |
| `invoke_payments_reconcile() returns void` | pg_cron `*/2` | wrapper Vault + `net.http_post` (`{"limit":25}`, 55 s) |
| `apply_payment_webhook` (révisée, même signature) | route + job | accepte `refunded`/`charged_back` ; double paiement sur le MÊME `external_reference` détecté dans le court-circuit ; `reason_code` posé sur chaque entrée |
| B2 · `request_payment_refund(p_entry_id uuid, p_note text)` | admin (`authenticated` + `is_admin`) | entrée `refund_required` ouverte → `payment_refunds` `pending` (index unique par entrée), entrée `retrying` |
| B2 · `claim_payment_refunds(p_limit)`, `finalize_payment_refund(p_refund_id, p_outcome, p_mp_refund_id, p_raw, p_error)`, `fail_payment_refund(p_refund_id, p_error)` | job | exécution MP, statuts `refunded` seulement si le paiement remboursé est celui qui a payé la commande, backoff 5 min × 2ⁿ |

### Modèle de données (delta)

| Table | Delta |
|---|---|
| `payments` | + `mp_preference_id text`, `mp_collector_id text` (écrits à la création de la préférence), `mp_last_status text`, `mp_last_checked_at timestamptz`, `mp_cancel_attempts int default 0` ; CHECK `status` + `refunded`, `charged_back` |
| `orders` | + `reconcile_claimed_at`, `reconcile_checked_at` ; index partiel `(created_at) where payment_status in ('unpaid','pending')` |
| `payment_reconciliation_entries` | + `reason_code text` check (`paid_after_expiry`, `double_payment`, `amount_mismatch`, `refunded_externally`, `charged_back`) ; CHECK `kind` + `refunded_externally` ; index uniques partiels `(mp_payment_id) where kind = 'refunded_externally'` et `(mp_payment_id, failure_reason) where kind = 'webhook_failure'` |
| `job_heartbeats` (créée) | `job_name pk, last_run_at, last_ok_at, last_error, stats jsonb, alerted_at, created_at` ; RLS admin lecture ; ligne seed `payments-reconcile` |
| `payment_refunds` (créée en B1, RPC en B2) | `id, entry_id → payment_reconciliation_entries not null, payment_id → payments, mp_payment_id text not null, amount_cop, status check('pending','approved','rejected'), mp_refund_id, raw_response jsonb, attempts, last_error, next_attempt_at, requested_by, note, created_at, updated_at` ; index unique partiel `(entry_id) where status in ('pending','approved')` ; RPC-only |
| `notification_emails` | CHECK `event_type` + `admin_job_stalled`, `client_payment_received_not_honored`, `client_duplicate_payment_refund` |
| `products` | trigger `products_capacity_flags_frozen` : `lobby_category_id`/`evento_capacity_mode`/`evento_occupies_resource` non modifiables tant qu'une ligne `reserved` existe |
| `cron.job` | + `payments-reconcile` (`*/2`), + `payments-reconcile-watchdog` (`*/15`) ; − `expire-stale-payment-orders` (migration de bascule + `drop function`) |

### Invariants
- Aucune commande n'est expirée sans que Mercado Pago ait été interrogé, sauf si elle n'a jamais eu de `payments` (aucune préférence).
- MP injoignable, identité du token non prouvée (`GET /users/me` ≠ `mp_collector_id`), horodatage de contrôle > 2 min ⇒ rien n'expire.
- Un paiement dont MP dit `approved` n'est jamais expiré (`mp_approved`) ; un paiement approuvé après expiration produit une entrée `refund_required` — jamais une commande `paid` sur des lignes mortes.
- `orders` d'abord, toujours ; puis les lignes en bloc ; puis les lignes de capacité dans l'ordre `product_availability` → `provider_resource_calendar` → `product_slot_availability` ; puis les écritures.
- La libération d'une place se décide sur des faits de la ligne (`availability_blocks`), jamais sur un drapeau produit relu après coup.
- Une entrée `refund_required` par paiement MP ; un e-mail client par entrée ; un remboursement vivant par entrée.
- `payments.status`/`orders.payment_status` ne passent `refunded` que si le paiement remboursé est celui qui a payé la commande ; un double paiement remboursé laisse la commande `paid`.
- Aucun `new Date()` dans l'Edge Function : les horodatages de contrôle viennent de la base.

### Cas limites
- Commande sans ligne vivante avec un `payments` `pending` (client a tout annulé, ou opérateur a expiré à la main) → claimée ; MP `approved` → `refund_required` ; MP `pending` → annulation MP immédiate ; sinon fermée (`payments cancelled`, `orders unpaid`).
- P1 `rejected` puis P2 : les deux `external_reference` sont cherchés ; un `rejected` dont le statut MP est terminal et dont la préférence est morte (+28 min) n'est plus cherché.
- Deux `approved` (même ou autre `external_reference`) → le premier appliqué, le second `double_payment`.
- PSE `pending` > 2 h → `PUT cancel` ; MP refuse (400) → 3 tentatives (6 min) puis expiration quand même ; un virement qui aboutit ensuite → `paid_after_expiry` (surveillance 48 h) → remboursement D3.
- `PUT cancel` accepté puis webhook `cancelled` → `already_cancelled`/no-op ; la commande reste candidate, l'expiration passe.
- Notre remboursement déclenche un webhook `refunded` → reconnu (`payment_refunds` vivant) → no-op ; un `refunded`/`charged_back` externe → entrée `refunded_externally`, statuts mis à jour seulement sur le paiement qui a payé.
- Budget d'appels MP par run dépassé → les commandes restantes sont re-claimées au tick suivant (2 min).
- Job jamais déployé / secret manquant → aucune expiration, alerte admin à 15 min, une seule fois.

### Fichiers touchés
`supabase/migrations/20260921100000_payments_reconcile.sql`, `20260921100100_payments_reconcile_switch.sql`, `20260922100000_payment_refunds.sql` (B2) · `supabase/functions/payments-reconcile/index.ts` · `apps/web/lib/mercadopago/client.ts`, `apps/web/app/api/payments/create/route.ts`, `mock-confirm/route.ts`, `packages/domain/src/mercadopago/mapPaymentStatus.ts` · `apps/web/lib/orders/orderState.ts`, `getOrderByToken.ts`, `getMyOrders.ts`, `OrderResult.tsx`, `OrderCard.tsx`, messages es/en · `apps/admin/app/admin/reconciliation/PaymentReconciliationList.tsx` (B2) · tests : `supabase/tests/database/payments_reconcile.test.sql`, `payments.test.sql`, `service_role_only_functions.test.sql`, `release_order_after_pms_refusal.test.sql`, `get_order_by_token.test.sql`, `tests/concurrency/*.mjs` (3), `tests/payments-integration/payments_reconcile.integration.mjs` · `package.json` (`test:payments-integration`).

## 1. Contexte et problème
Voir §A et `docs/journal/2026-09.md` (2026-09-20, trois entrées) : le webhook seul portait la confirmation ; le cron d'expiration ne demandait rien à Mercado Pago ; aucun remboursement ; aucun écran. Le Lot A (§B) a fermé la commande fantôme et rendu l'argent visible ; ce document porte la garantie elle-même.

## 2. Portée
- **B1** : réconciliation qui pilote l'expiration, libération des cupos (Trou (a)), plafond 2 h, surveillance 48 h, heartbeat + watchdog, statuts `refunded`/`charged_back`, bascule (`unschedule` + `drop`).
- **B2** : demande et exécution de remboursement, e-mails client (3 textes §5), état d'écran client, bouton admin.
- **Hors périmètre** : re-réservation automatique (décision D3), remboursement partiel, écran admin des heartbeats, `orders.partially_refunded`.

## 3. Décisions retenues
D1, D1-bis, D2, D3 (§A, 2026-09-20). Déjà tranché ailleurs et non rouvert : RPC-only pour tout ce qui touche la capacité (`CLAUDE.md` §3), squelette anti-survente (§4), Playwright/Vitest/pas de pgTAP pour la concurrence (§6), Resend pour les e-mails, jamais de Fly.

## 4. Parcours cible
1. Le client clique « Pagar » : `create_payment_intent` → préférence MP (`mp_preference_id`, `mp_collector_id` persistés) → Checkout Pro. Il ferme l'onglet.
2. t+2 min : le job réclame la commande, cherche ses `external_reference` chez MP. `approved` au bon montant → `apply_payment_webhook` → commande `paid`, 3 e-mails. Aucun retour client nécessaire.
3. `pending` (PSE) → réexamen toutes les 2 min jusqu'à 2 h ; ensuite annulation MP (meilleur effort, 3 essais) puis expiration avec libération des places.
4. Rien chez MP à t+32 min → expiration, places libérées, booking Lobby annulé par trigger.
5. Paiement approuvé après expiration (webhook ou surveillance 48 h) → entrée `refund_required`, e-mail admin, e-mail client (B2), écran client « recibimos tu pago… ». L'admin rembourse (job) ou re-réserve à la main et résout.

## 5. Écrans et textes (B2 — textes À VALIDER par Jérôme avant merge)
- **Client `/reserva/<jeton>` et `/cuenta/reservas`** — état `paid_not_honored` : « Recibimos tu pago, pero tu reserva no pudo confirmarse. Te contactamos en las próximas horas para reembolsarte o reservar de nuevo. » ; état `refunded` : « Te reembolsamos el anticipo de esta reserva. » Jamais de bouton « Pagar » sur ces états.
- **E-mail 9 · `client_payment_received_not_honored`** (paid_after_expiry, amount_mismatch) — objet « Recibimos tu pago — tu reserva <HFG-n> no pudo confirmarse » ; corps : montant reçu, raison en une phrase (« la reserva ya había expirado » / « el monto no coincide con el anticipo »), « te contactamos en las próximas horas para reembolsarte o volver a reservar », lien vers la réservation.
- **E-mail 10 · `client_duplicate_payment_refund`** (double_payment) — objet « Recibimos un pago duplicado para tu reserva <HFG-n> » ; corps : la réservation EST confirmée, le paiement en double sera remboursé.
- **E-mail 11 · `admin_job_stalled`** — objet « El job de conciliación de pagos no responde desde hace 15 min » ; corps : dernière exécution réussie, dernière erreur, rappel qu'aucune reserva n'expire tant qu'il est arrêté.
- **Admin `/admin/reconciliation` · Pagos** : bouton « Reembolsar » (note obligatoire) sur une entrée `refund_required` ouverte ; statuts « Reembolso en curso », « Reembolsado », « Reembolso rechazado : <motif> ».

## 10. Décisions tranchées ici / points ouverts
1. **Trigger « drapeaux de capacité gelés »** : un produit portant une ligne `reserved` ne peut plus changer `lobby_category_id`, `evento_capacity_mode`, `evento_occupies_resource` (sinon la libération rendrait une place jamais prise, ou ne rendrait pas une place prise). Comportement admin nouveau : erreur explicite à l'écran. À confirmer par Jérôme si un cas réel l'exige (rattacher un établissement à Lobby avec des réservations en cours).
2. **Budget d'appels MP par run** : 60 (25 commandes × ≤ 2 recherches + annulations) ; au-delà, le reste attend 2 min. Rate limit MP inconnu — à mesurer via `job_heartbeats.stats`.
3. **Marge d'expiration** : 2 min au-delà de 30 min, paramètre de `reconcile_order` ; à recaler sur `stats.index_delay_ms_max` mesuré en préprod.
4. **Ouvert — PSE en cours de virement annulable ?** Non documenté par MP ; la règle (3 tentatives puis expiration) tient dans les deux cas. À observer sur un PSE réel.
5. **Ouvert — corps d'erreur MP des remboursements** (« too old », « already refunded ») : le mapping s'écrit après capture réelle en préprod ; la fixture rejoue ces corps.
6. **Ouvert — textes des e-mails 9-11** (§5) : validation Jérôme.

## 11. Annexe — traçabilité code→règle
| Règle | Source |
|---|---|
| Un seul aller-retour, `for update`, `security definer`, `search_path=''` | `docs/05-reference-technique.md` §1, §1bis (verrous en ordre déterministe) |
| Échec fermé | `CLAUDE.md` §4.4 |
| `orders` d'abord | `.claude/rules/supabase.md` règle 8, piège 21 |
| Libération = miroir de `create_order` | `supabase/migrations/20260915130000` l.280-356, 632-636, 658-661, 709-710, 773-790 ; `20260829100000` (modèle réécrit) |
| Pattern cron → Edge Function | `20260819140000`, `20260917160000`, `supabase/functions/pms-poll-bookings/index.ts`, `tests/pms-integration/` |
| Contrat client | `20260916100000_order_for_client_jsonb_duration_days.sql`, `get_order_by_token.test.sql` |
| E-mails | `docs/06-emails-transactionnels.md`, `20260824020000` (CHECK, index de dédup) |

## 12. Documents liés

`docs/specs/19-paiement-mercadopago-acompte-ledger.md` (Tranche 2 remboursement, jamais codée) ·
`docs/specs/33-resultat-paiement-et-fermeture-du-tunnel.md` · `docs/06-emails-transactionnels.md`
· `docs/05-reference-technique.md` · `docs/pieges-empiriques.md` (piège 19) · `docs/backlog.md`.
