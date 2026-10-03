---
id: specs-paiement-mercadopago-acompte-ledger
titre: "Paiement en ligne Mercado Pago — acompte obligatoire, ledger de règlement, virement automatique au référent"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: partiel
reste: >
  Tranche 1 (capture d'acompte, CheckoutForm branché, ledger) livrée et vérifiée en paiement réel.
  Webhook vérifié en LIVRAISON RÉELLE le 2026-09-20 (piège 19 résolu : la clé de signature est
  celle du compte qui encaisse) et RPC durcie le même jour (migration 20260920120000 — verrou
  `orders` d'abord, garde « rien à honorer », entrée `refund_required` idempotente). Tranche 2
  (remboursement) non commencée : reprise par docs/specs/39-garantie-confirmation-paiement.md
  (arbitrage D3 de Jérôme).
revise:
  - "docs/01-cahier-des-charges-client.md"
  - "docs/02-cahier-des-charges-socio.md#3g"
  - "docs/03-cahier-des-charges-admin.md#3g"
maj: 2026-09-20
resume: >
  Rouvre explicitement le « hors périmètre v1 » du paiement en ligne (décidé 2026-08-11/12) :
  Mercado Pago remplace Wompi comme gateway cible. Le client paie l'acompte (moteur 17/10/7 déjà
  validé et codé, §3b) en ligne, obligatoire pour confirmer une réservation ; le reste se règle
  hors-ligne comme aujourd'hui. Construit le ledger de règlement qui n'existe pas encore côté
  hifago 2.0, et fait de Mercado Pago le canal obligatoire de rétribution du référent et de la
  compensation établissement (no-show), réglé par un virement automatique déclenché après
  réalisation de la prestation — jamais un split en temps
  réel à la capture, pour rester cohérent avec la règle de redistribution no-show déjà actée (A3).
mots_cles: [mercadopago, paiement, acompte, ledger, commission, referrer, 17/10/7, webhook,
  remboursement, no-show, payments, ledger_entries, order_lines, hifago]
repond_a:
  - "Comment intégrer Mercado Pago pour encaisser l'acompte en ligne ?"
  - "Comment se répartit l'argent entre Hifago (7 %/17 %), le référent (10 %) et l'établissement ?"
  - "Pourquoi le référent doit-il avoir un compte Mercado Pago ?"
  - "Que se passe-t-il si le client ne vient pas, ou si l'établissement annule ?"
  - "Quel est le ledger de règlement, et pourquoi n'existait-il pas déjà ?"
---

# Paiement en ligne Mercado Pago — acompte obligatoire, ledger de règlement

> **Cible stack** : Hifago uniquement (`hifago/supabase`, `hifago/apps/web`, `hifago/apps/admin`),
> pas l'app legacy. **Rouvre explicitement** le statut « hors périmètre v1 » du paiement en ligne,
> acté au conditionnel dans trois documents déjà validés le 2026-08-11/12
> (`04-architecture-cible.md:803-804`, `00-modele-de-donnees.md:427-430`, `README.md:44,67`) —
> fait nouveau : Jérôme a tranché le gateway (Mercado Pago, remplace Wompi comme cible v1) le
> 2026-08-18. Rouvre aussi partiellement §3g de `02-cahier-des-charges-socio.md` (méthode de
> paiement du référent) — cf. §3 et §10.
>
> **Statut d'implémentation (2026-08-18, suite 6)** — Découpé en 3 tranches (§0) : **Tranche 0
> livrée** (ledger + machine à états, sans Mercado Pago branché) ; **Tranche 1 livrée et branchée
> de bout en bout** (capture Mercado Pago + webhook, `CheckoutForm.tsx` redirige réellement vers
> Checkout Pro — le virement au référent reste manuel, cf. §0 Tranche 1, recherche technique) ;
> **Tranche 2 non commencée** (remboursement annulation établissement). Testé avec un vrai compte
> sandbox Mercado Pago Colombia (identifiants fournis par Jérôme) — webhook non encore testé en
> conditions réelles, `MERCADOPAGO_WEBHOOK_SECRET` pas encore configuré.
> **Périmé depuis le 2026-09-20** : premier paiement confirmé de bout en bout en préprod (piège 19
> résolu), puis `apply_payment_webhook` durcie (`20260920120000`, cf. §0 révisé ci-dessous) après
> l'incident HFG-000013 ; la suite (réconciliation qui pilote l'expiration, remboursement) est
> l'objet de la spec 39.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (Tranches 0/1/2) | brouillon |
| 1 | Contexte et problème | brouillon |
| 2 | Portée | brouillon |
| 3 | Décisions retenues | brouillon |
| 4 | Parcours cible | brouillon |
| 5 | Écran(s) | brouillon |
| 6-9 | *(fusionnées dans 0 — voir note en tête de §0)* | — |
| 10 | Décisions tranchées / points ouverts | brouillon |
| 11 | Annexe — traçabilité code→règle | brouillon |
| 12 | Documents liés | brouillon |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

> Organisé par tranche, comme la spec 17. Chaque tranche est livrable et testable
> indépendamment ; la Tranche 1 dépend de la Tranche 0 (elle étend la même RPC et consomme
> `ledger_entries`), la Tranche 2 dépend de la Tranche 1 (elle rembourse un `payments` existant).

### Tranche 0 — Ledger + machine à états (sans Mercado Pago branché)

**Table `ledger_entries`** (nouvelle, RPC-only, append-only dans son sens métier — jamais de
suppression, seulement des transitions de statut) :

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `order_line_id` | uuid → `order_lines` | |
| `beneficiary_type` | text check(`'referrer'`,`'establishment'`) | jamais `'app'` — la part app n'est pas une créance, cf. invariants |
| `beneficiary_id` | uuid | `referrer_partner_id` de la ligne, ou l'établissement propriétaire du produit |
| `entry_type` | text check(`'referral_earned'`,`'establishment_compensation'`) | |
| `amount_cop` | bigint | copié de `referrer_commission_cop` au moment de l'écriture, jamais recalculé |
| `status` | text check(`'estimated'`,`'due'`,`'paid'`,`'reversed'`,`'void'`) | mappe les 4 états du dashboard référent §3c (`estimated`=Estimée, `due`=Acquise à payer, `paid`=Acquise payée, `reversed`=Reprise) + `void` (jamais dû, cas self-referral/direct exclus en amont, ou redirection no-show) |
| `comprobante_path` | text nullable | uploadé par l'admin au règlement (repli manuel), ou référence du virement Mercado Pago (Tranche 1) |
| `note` | text nullable | |
| `created_at` / `paid_at` | timestamptz | |

**Table `establishment_payout_accounts`** (nouvelle, 1:1 `establishments`, RPC-only, **déjà livrée
en Tranche 0**) : `establishment_id` PK → `establishments`, `bank jsonb` (même forme que
`partner_crm_profile.bank` : `{nombre, bancolombia?, nequi?, received_at}`), `updated_at`. Au
moment de la livraison Tranche 0, le canal de compensation no-show établissement était encore
Bancolombia/Nequi ; **tranché le 2026-08-18** (§10 point 13) : la compensation établissement
bascule elle aussi vers Mercado Pago, comme le référent — le champ `bank jsonb` existant est libre
et peut porter des identifiants Mercado Pago sans migration de schéma ; un renommage/restructuration
éventuel se décide en Tranche 1, pas rétroactivement sur la Tranche 0 déjà testée.

**Table dédiée `partner_payout_accounts`** (tranché §10 point 7, pas une extension de
`partner_crm_profile.bank`) — RPC-only, miroir de `establishment_payout_accounts`, porte
l'identifiant Mercado Pago obligatoire de toute identité `referrer` — mécanisme exact (déclaration
simple vs OAuth) reste à statuer pendant l'implémentation, cf. §10 point 15.

**RPC `set_order_line_status` — étendue** (`hifago/supabase/migrations/20260814170000_set_order_line_status_rpc.sql`) :

```
set_order_line_status(p_order_line_id uuid, p_new_status text, p_reason text) returns jsonb
```

Modifications par rapport à la version actuelle :
1. **Garde de statut de départ ajoutée** (gap de sécurité existant, corrigé ici) : refuse si
   `v_before_status <> 'reserved'` — aujourd'hui absente, une ligne `fulfilled` peut être
   re-basculée sans contrôle. Même patron que `modify_order_line`.
2. **Autorisation élargie** : accepte `is_admin(auth.uid())` **ou**
   `has_capability(auth.uid(), 'operator', <établissement propriétaire de la ligne>)` pour la
   transition `no_show` spécifiquement (le prestataire marque lui-même, depuis son espace socio,
   qu'un client n'est pas venu). Les autres transitions restent admin-only sauf décision contraire
   en implémentation (§10 point non listé — à trancher si besoin apparaît).
3. **Écriture ledger par transition**, pour toute ligne où `referrer_commission_cop > 0` (donc
   `commission_case = 'external_referrer'` uniquement) :
   - `fulfilled` → `ledger_entries` correspondante passe `estimated` → `due`.
   - `no_show` / `cancelled_by_client` → passe `estimated` → `void` **et** insère une nouvelle
     `ledger_entries(beneficiary_type='establishment', entry_type='establishment_compensation',
     amount_cop=<même montant que referrer_commission_cop>, status='due')`.
   - `cancelled_by_provider` → passe `estimated`/`due` → `reversed` (déclenche la Tranche 2).
   - `expired` → passe `estimated` → `void`.
   - Pas d'écriture ledger pour `self_referral`/`direct` (`referrer_pct=0` — rien à créer).

**`create_order` — étendue** (`20260814180000_order_lines_commission_snapshot.sql`) : pour toute
ligne `commission_case = 'external_referrer'`, insère la `ledger_entries` initiale
(`status='estimated'`) dans la même transaction que la ligne elle-même.

**RPC `mark_ledger_entry_paid`** (nouvelle, admin-only, repli manuel) :
```
mark_ledger_entry_paid(p_ledger_entry_id uuid, p_comprobante_path text, p_note text) returns jsonb
```
`security definer`, `set search_path=''`, `select ... for update` sur la ligne, refuse si
`status <> 'due'`.

**Policy RLS `ledger_entries_select_referrer`** (nouvelle) : même patron que
`order_lines_select_referrer` (`20260814200000_order_lines_referrer_visibility.sql`) — un référent
voit ses propres `ledger_entries` (`beneficiary_type='referrer' and beneficiary_id = <son partner_id>`).

**Invariants (Tranche 0)**
- La part app (7 % ou 17 %) n'est **jamais** une ligne de `ledger_entries` — c'est un revenu
  retenu par la plateforme, pas une dette envers un tiers. Ceci est vrai y compris quand
  `commission_case = 'direct'` (aucun référent) : Hifago perçoit alors la totalité de l'acompte
  (17 %), pas seulement 7 % — l'app absorbe la part qui serait allée au référent (§3b).
- La part référent (10 %) n'est due (`due`) que si la ligne est `fulfilled` — sinon `void` +
  redirection vers l'établissement (`establishment_compensation`), jamais un split en temps réel.
- `ledger_entries` est append-only dans son sens métier — transitions de statut uniquement, jamais
  de suppression (même discipline que `audit_log`, `20260813201000_admin_audit_log.sql`).
- La transition `no_show` par l'operator est scopée à ses propres établissements — jamais une
  ligne d'un autre prestataire.

**Cas limites (Tranche 0)**
- Ligne `self_referral`/`direct` : aucune `ledger_entries` créée, rien à régler (l'app garde tout).
- Établissement sans `establishment_payout_accounts` renseigné quand une compensation lui est due :
  la `ledger_entries` reste `due` sans bloquer le flux de vente — le versement attend juste la
  saisie des coordonnées (repli admin).
- Ligne déjà `fulfilled` qu'on tente de rebasculer : refusé par la garde de statut de départ (gap
  corrigé ici, cf. §1).

**Fichiers touchés (Tranche 0)** : `supabase/migrations/<ts>_ledger_entries.sql`,
`<ts>_establishment_payout_accounts.sql`, `<ts>_partner_payout_accounts.sql`,
`<ts>_set_order_line_status_ledger_and_operator.sql`,
`<ts>_create_order_ledger_entry.sql`, `<ts>_mark_ledger_entry_paid.sql`,
`<ts>_ledger_entries_referrer_visibility.sql`, `apps/admin/app/admin/ledger/page.tsx` (nouveau,
liste + action « marquer payé » + upload comprobante), dashboard référent existant étendu (à
localiser en implémentation — pas encore construit, cf. §5).

---

### Tranche 1 — Capture Mercado Pago obligatoire + webhook + virement automatique au référent

**Statut (2026-08-18, suite 4) : couche DB + API livrée et testée.** UI (redirection depuis
`CheckoutForm.tsx` + page de retour) **volontairement non branchée** — décision explicite prise
avec Jérôme avant de coder (aucun identifiant sandbox Mercado Pago réel disponible pour tester en
conditions réelles ; `CheckoutForm.tsx` est aussi le point de passage d'une dizaine de specs e2e
existantes, brancher un redirect obligatoire sans pouvoir le tester en vrai aurait cassé le
checkout réel pour de vrais visiteurs). Le code ci-dessous est prêt, testé (pgTAP
`payments.test.sql`, 41 assertions ; typecheck/lint propres), mais rien n'y mène encore depuis
l'écran public — à brancher dans une session dédiée une fois des identifiants sandbox fournis.

**Table `payments`** (livrée, RPC-only, schéma propre — pas de reprise du schéma Wompi legacy) :
`id uuid PK`, `order_id → orders`, `provider text default 'mercadopago'`, `mp_payment_id text unique
nullable`, `status text check('pending','approved','rejected','cancelled')`, `amount_cop bigint`,
`payer_email text` (ajout par rapport au plan initial — évite une jointure vers `orders` pour
préremplir le payer Mercado Pago), `raw_last_event jsonb`, `created_at`, `updated_at`. RLS
admin-only en lecture (`payments_select_admin`) — ni un invité ni un compte connecté ne lit cette
table en direct, le statut passe par `GET /api/payments/[orderId]/status`.

**Table `payment_reconciliation_entries`** (livrée) : proche de `pms_reconciliation_entries`
(`20260814210000`), mêmes 4 statuts `open/retrying/resolved/permanently_failed`, mais `payment_id`
**nullable** (un webhook peut échouer avant toute corrélation possible) + `mp_payment_id`/
`external_reference`/`raw_event`/`failure_reason` dédiés. **Ajout 2026-09-20** (`20260920120000`) :
colonne `kind` (`webhook_failure` = bruit à diagnostiquer, défaut ; `refund_required` = argent
encaissé chez MP sans prestation à honorer, action admin requise) et index unique partiel
`(mp_payment_id) where kind = 'refund_required'` — une seule entrée par paiement MP quel que soit
le nombre de livraisons/retentatives. RPC
`resolve_payment_reconciliation_entry` (admin-only, motif obligatoire) — même patron que
`resolve_reconciliation_entry`. INSERT jamais via RPC : le Route Handler webhook écrit directement
avec `service_role` (déjà grantée par défaut, cf. `20260813163456_identity_rls.sql`).

**Colonne `orders.payment_status`** (livrée) : `text check('unpaid','pending','paid',
'partially_refunded','refunded') default 'unpaid'` — colonne explicitement réservée à cette spec
par `01-cahier-des-charges-client.md` §3f point 4.

**RPC `create_payment_intent`** (livrée) :
```
create_payment_intent(p_order_id uuid) returns jsonb
```
`security definer`, `set search_path=''`. Autorisation **volontairement plus large** qu'imaginé au
plan initial (`account_id = auth.uid()`) : un invité (`account_id null`) n'a **aucune session** pour
prouver la propriété de sa commande (`orders_select` l'exclut déjà de toute lecture RLS directe) —
la possession de `p_order_id` (uuid à haute entropie, renvoyé une seule fois par `create_order`)
fait foi, exactement le même modèle de capacité que la confirmation de commande elle-même. Un
compte authentifié sous une **identité différente** du propriétaire reste refusé (`order_not_found`,
jamais un refus distinct qui confirmerait l'existence de la commande d'un tiers). Ceci résout aussi
le cas limite « commande invité qui revient payer plus tard » (ci-dessous) : rien de spécial à
construire, le modèle de capacité couvre les deux cas identiquement. `select ... for update` sur
`orders`. Calcule `amount_cop = sum(order_lines.acompte_cop) where status = 'reserved'` (ignore les
lignes déjà `superseded`/annulées — jamais gonflé par une ligne remplacée). Refuse si un `payments`
`approved`/`pending` existe déjà (idempotence métier). Insère `payments(status='pending',
amount_cop, payer_email, order_id)`. Retourne `{payment_id, amount_cop, payer_email}`. N'appelle
**pas** Mercado Pago elle-même (Postgres ne fait pas d'appel HTTP sortant synchrone) — le Route
Handler `POST /api/payments/create` fait l'appel SDK ensuite, **en relisant lui-même** l'état
autoritatif de `payments` via `service_role` (jamais en faisant confiance à un `amount_cop`/
`payer_email` relayé par le client — défense en profondeur, cf. Route Handler ci-dessous), avec
`external_reference = payments.id`.

**RPC `apply_payment_webhook`** (livrée) :
```
apply_payment_webhook(p_mp_payment_id text, p_external_reference uuid, p_status text,
                       p_raw_event jsonb) returns jsonb
```
`security definer`, `set search_path=''`, **`grant execute` uniquement à `service_role`** (jamais
`authenticated`/`anon` — `revoke execute ... from public` explicite, sans quoi PostgreSQL
accorderait EXECUTE à PUBLIC par défaut comme pour toute fonction). Appelée uniquement par
`POST /api/payments/webhook`, **après** vérification de la signature (`x-signature`) **et** un GET
serveur-à-serveur de re-confirmation `/v1/payments/{id}` — jamais sur la seule foi du corps du
webhook. Vérification de signature déléguée à `WebhookSignatureValidator.validate(...)`,
utilitaire **officiel** du SDK `mercadopago` (npm) découvert en implémentation — remplace le HMAC
manuscrit initialement envisagé (manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`) :
comparaison à temps constant déjà intégrée, plus une fenêtre de tolérance d'horloge en option,
maintenu par Mercado Pago lui-même plutôt que réimplémenté ici. `select ... for update` sur
`payments where id = p_external_reference`. Si `status` déjà `'approved'` → no-op idempotent. Si
transition vers `'approved'` pour la 1ʳᵉ fois → `orders.payment_status := 'paid'`. Si
`'rejected'`/`'cancelled'` → `orders.payment_status := 'unpaid'`.
**RÉVISÉ 2026-09-20** (`20260920120000_harden_apply_payment_webhook.sql`, incident HFG-000013) :
(1) verrou `orders` D'ABORD puis `payments` (ordre du cron, piège 21) ; (2) garde « rien à
honorer » — un `approved` sur un paiement `cancelled`, sur une commande sans ligne
`reserved`/`fulfilled`/`no_show`, ou déjà payée par un autre `payments`, ne touche ni
`payments.status` ni `orders`, n'envoie aucun e-mail, crée UNE entrée `kind='refund_required'`
(motif dérivé des statuts réels) et répond `{ok:true, reason:'paid_after_expiry'|'double_payment'}`
(200, MP ne retente pas) ; (3) après approbation, les autres `payments` `pending`/`rejected` de la
commande passent `cancelled` ; (4) tout non-`approved` sur un paiement `cancelled` →
`already_cancelled`, et un `rejected` ne rétrograde jamais une commande qu'un autre paiement porte.
Preuves : `payments.test.sql` cas 28-36 (mutation), `apply_payment_webhook_vs_expiry.concurrency.mjs`.
Le Route Handler ajoute une
**défense en profondeur non prévue au plan initial** : avant d'appeler cette RPC avec `'approved'`,
il compare `transaction_amount` (réponse Mercado Pago re-confirmée) à `payments.amount_cop` — un
écart n'approuve jamais automatiquement, atterrit en `payment_reconciliation_entries` à la place.

**Virement au bénéficiaire — tranché par la recherche technique (2026-08-18, suite 3)** : **aucune
API Mercado Pago ne permet un virement programmatique différé plateforme→tiers en libre-service
pour la Colombie, à l'échelle de Hifago** (§10 point 15, recherche approfondie). Split de Pagos est
temps réel + OAuth (déjà écarté, §1) ; Advanced Payments/Disbursements existe bien (SDK Node
`AdvancedPayment`, v3.1.0+) mais réservé aux comptes en « cartera asesorada » avec seuils
d'éligibilité hors de portée (>100 000 utilisateurs actifs, ticket moyen <15-40 USD selon le
modèle, approbation commerciale Mercado Pago requise) ; aucune API de virement P2P autonome
(type CVU/alias) n'existe pour la Colombie, ce mécanisme étant réservé à l'Argentine. **Conséquence
directe** : le repli déjà accepté par Jérôme (§10 point 12) devient le mécanisme **permanent**, pas
un repli temporaire en attendant mieux — le virement matériel se fait manuellement par l'admin,
directement dans l'app/le site Mercado Pago (hors Hifago), vers l'identifiant Mercado Pago
enregistré dans `partner_payout_accounts`/`establishment_payout_accounts`. Seule la **détection**
qu'une créance est due reste automatique (transition `due` du ledger, cf. §0 Tranche 0, visible
dans `/admin/ledger`) — **le RPC `mark_ledger_entry_paid` (déjà livré en Tranche 0) reste donc le
seul point de bascule `due → paid`**, comprobante à l'appui. Aucune RPC d'orchestration de virement
(`payout_ledger_entry` ou équivalent) n'est nécessaire en Tranche 1 : ce sous-chantier disparaît du
périmètre. Ce n'est **pas** un split de la transaction client (`application_fee`) : la capture reste
un événement séparé et antérieur, sur un seul compte marchand.

**Job d'expiration** (pg_cron, pattern déjà tranché `04-architecture-cible.md:468-498`) : une
commande dont `payment_status='pending'` au-delà d'une fenêtre de grâce expire —
`order_lines.status := 'expired'` (libère le cupo, cohérent avec le mécanisme d'expiration déjà
existant). Durée validée par Jérôme : **30 minutes** (§10 point 14).

**SDK** : `mercadopago` (npm, actuel : 3.4.0) côté serveur uniquement. **Simplification par rapport
au plan initial** : `@mercadopago/sdk-js`/`sdk-react` côté client **jamais nécessaire** — Checkout
Pro par simple redirection plein-écran vers `init_point` (un lien/`window.location.href` suffit),
aucune brique/bouton intégré requis pour ce périmètre (un seul compte marchand, pas de
personnalisation in-page). Conséquence directe : `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` n'est pas
nécessaire non plus. En-tête `X-Idempotency-Key` posé explicitement sur `Preference.create(...)`
avec `payments.id` comme clé (pas une clé aléatoire par appel) — un retry réseau sur le même intent
ne crée jamais deux préférences distinctes.

**Invariants (Tranche 1)**
- Un seul compte marchand bénéficiaire de la capture (Hifago) — aucun split Mercado Pago natif, aucun
  OAuth établissement, au moment du paiement client.
- Le compte Mercado Pago du référent n'est jamais crédité à la capture — seulement via le virement
  manuel post-fulfillment décrit ci-dessus (aucun mécanisme API différé disponible à l'échelle de
  Hifago, confirmé §10 point 15).
- **Les frais Mercado Pago sont absorbés par la part app** (§10 point 10) — jamais déduits de
  `referrer_commission_cop` ni de `establishment_compensation` : le référent/l'établissement reçoit
  toujours le montant plein enregistré dans `ledger_entries.amount_cop`.
- Traitement webhook idempotent par construction : `select ... for update` sur `payments` +
  vérification `status` avant toute écriture — un webhook dupliqué ou reçu hors-ordre ne produit
  jamais un double crédit. Depuis le 2026-09-20 : jamais non plus une commande `paid` sur des
  lignes `expired`/annulées, ni deux `approved` sur une même commande (double paiement
  inter-`external_reference` → `refund_required`).
- Corrélation paiement↔commande par `external_reference = payments.id` (généré avant tout appel
  Mercado Pago), jamais par `mp_payment_id` seul (pas encore connu à la création de l'intent pour
  Checkout Pro).
- `apply_payment_webhook` grantée uniquement à `service_role`.
- Échec fermé : si Mercado Pago est indisponible à la création de l'intent, la RPC échoue proprement
  sans bloquer la commande déjà réservée par `create_order`.
- Écart assumé à l'invariant anti-survente « un seul aller-retour » (`05-reference-technique.md`) :
  la chaîne `create_payment_intent` (DB) → appel SDK Mercado Pago (réseau externe) → webhook (DB,
  RPC séparée) n'est pas un round-trip unique, parce qu'aucun round-trip Postgres ne peut appeler
  une carte bancaire de façon synchrone. La garantie anti-survente elle-même (verrou `for update`
  sur la ressource critique — ici `payments`/`orders`, pas un compteur de capacité) reste intacte à
  chaque étape individuelle.

**Cas limites (Tranche 1)**
- Webhook dupliqué → no-op idempotent (invariant `for update` + check `status`).
- Webhook reçu avant la fin de l'appel de création côté Route Handler (race réseau) → corrélation
  par `external_reference`, pas par un `mp_payment_id` pas encore connu.
- Double-clic « payer » (deux `create_payment_intent` concurrents sur la même commande) → refusé
  par le `for update` sur `orders` + vérification d'un `payments` `approved`/`pending` existant.
- Commande invité (`account_id null`) qui revient payer plus tard → **résolu par construction**
  (voir `create_payment_intent` ci-dessus) : la possession de `p_order_id` fait foi dans les deux
  cas (paiement immédiat ou différé), aucun traitement spécial — volontairement différent de
  `cancel_order` qui refuse l'invité (`20260814161500_cancel_order_rpc.sql:69-73`), parce que ce
  dernier est une action destructive nécessitant une preuve d'identité plus forte, alors que payer
  sa propre commande via son seul numéro de réservation est déjà le modèle de confiance retenu
  pour toute action post-réservation d'un invité dans ce projet.
- Mercado Pago indisponible à la création de l'intent → Route Handler échoue proprement (503,
  `mercadopago_unavailable`), commande reste `reserved`/`pending` (pas de blocage rétroactif, cf.
  invariant échec fermé ci-dessus) — le client peut retenter, le job d'expiration reste le filet de
  dernier recours.
- Montant Mercado Pago re-confirmé ≠ `payments.amount_cop` attendu (falsification de préférence,
  bug client, ou coupon appliqué côté Mercado Pago) → **jamais approuvé automatiquement** (webhook
  route), atterrit en `payment_reconciliation_entries` pour résolution manuelle admin — typé
  `kind = 'refund_required'` depuis le 2026-09-20 (l'argent est encaissé au mauvais montant).

**Fichiers livrés (Tranche 1)** : migrations `20260818200000_payments.sql` (table `payments` +
`orders.payment_status` + `create_payment_intent`), `20260818210000_payment_reconciliation_entries.sql`
(table + `resolve_payment_reconciliation_entry`), `20260818220000_apply_payment_webhook.sql`,
`20260818230000_expire_stale_payment_orders_job.sql` (pg_cron, */5 min — voir invariant fenêtre de
grâce ci-dessous) ; `supabase/tests/database/payments.test.sql` (41 assertions) ;
`apps/web/lib/mercadopago/client.ts` (wrapper `Preference.create`/`Payment.get`, jamais dans
`packages/domain` — dépend du SDK + d'un secret serveur, même patron que `sharp` dans
`apps/admin/app/api/upload/[entity]/route.ts`) ; `packages/domain/src/mercadopago/mapPaymentStatus.ts`
+ test (fonction pure, mappe le vocabulaire Mercado Pago — `approved/rejected/pending/in_process/
authorized/in_mediation/cancelled/refunded/charged_back` — vers les 4 états `payments.status`) ;
`apps/web/app/api/payments/create/route.ts`, `apps/web/app/api/payments/webhook/route.ts`,
`apps/web/app/api/payments/[orderId]/status/route.ts` (supprimé le 2026-10-01 : aucun appelant, cf.
spec 33 §10) ; `apps/web/.env.example` :
`MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` (pas de variable côté `apps/admin`, pas de
`NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY`, cf. simplification SDK ci-dessus).

**UI branchée (2026-08-18, suite 6)**, une fois les identifiants sandbox fournis par Jérôme :
`CheckoutForm.tsx` appelle réellement `create_payment_intent` (RPC directe, comme `create_order`)
puis `POST /api/payments/create` puis redirige (`window.location.href`) vers `init_point` — plus un
placeholder. État transitoire `pendingOrderId`/`paymentError` avec bouton « Reintentar pago » si
l'appel Mercado Pago échoue après une réservation déjà confirmée (la commande reste `reserved`, le
job d'expiration 30 min reste le filet de dernier recours). Page de retour dédiée toujours absente
— `back_urls` pointe vers l'écran checkout existant (suffisant pour ce périmètre, la reprise de
statut se fait via `GET /api/payments/[orderId]/status`, pas encore appelée depuis l'écran).

**11 specs e2e mises à jour** (`reserve`, `attribution`, `login`, `cart-multi-establishment`,
`reserve-hotel-room`, `reserve-lodging-range`, `reserve-concurrency` côté `apps/web` ;
`partner-agenda`, `partner-qr-tool`, `admin-camp-booking`, `partner-reservations` côté
`apps/admin`) — toutes empruntaient `CheckoutForm.tsx` jusqu'à `order-success` immédiat. Nouveau
helper partagé `mockMercadoPagoCheckout(page)` (`packages/e2e-support/src/payments.ts`) : intercepte
uniquement l'appel réseau vers `/api/payments/create` et renvoie un `init_point` fictif mais
navigable (même origine) — `create_order` et `create_payment_intent` restent de VRAIS appels RPC
(réservation et ligne `payments` réellement écrites), seul l'appel externe au SDK Mercado Pago est
simulé. **Race condition trouvée et corrigée en testant** : `order-success` n'est qu'un état
transitoire, parfois déjà remplacé par la redirection mockée avant que Playwright ne l'observe (fetch
mocké quasi instantané) — remplacé par `page.waitForURL(redirectUrl)` dans les 10 cas simples et par
une course `checkout-error` vs `waitForURL` dans `reserve-concurrency.spec.ts` (qui devait déjà
distinguer gagnant/perdants). **2 gaps FK préexistants trouvés et corrigés** dans le helper partagé
`resetAvailability` (`packages/e2e-support/src/db.ts`) — jamais déclenchés avant que ce travail ne
fasse tourner ces tests en boucle après l'existence de `payments`/`ledger_entries` : nettoyage
ajouté pour `payments.order_id`, `ledger_entries.order_line_id`, `pms_reconciliation_entries.
order_line_id`, `availability_blocks.source_order_line_id`, toutes FK vers `orders`/`order_lines`
non purgées avant le `delete` — `ledger_entries` datait de la Tranche 0, pas de cette session.

---

### Tranche 2 — Remboursement (annulation établissement) + redistribution ledger

> **2026-09-20** : jamais commencée. Le contrat ci-dessous (table `payment_refunds`, deux RPC) est
> repris tel quel par `docs/specs/39-garantie-confirmation-paiement.md` D3, qui l'élargit aux trois
> cas « argent encaissé, rien honoré » (payé après expiration/annulation, écart de montant, double
> paiement) — arbitrage Jérôme en attente.

**Table `payment_refunds`** (nouvelle) : `id`, `payment_id → payments`, `order_line_id →
order_lines`, `amount_cop`, `mp_refund_id text`, `status check('pending','approved','rejected')`,
`reason text`, `created_at`.

**RPC `request_provider_cancellation_refund`** :
```
request_provider_cancellation_refund(p_order_line_id uuid, p_reason text) returns jsonb
```
Admin-only. Enveloppe `set_order_line_status(..., 'cancelled_by_provider', p_reason)` puis, dans la
même transaction : localise le `payments` approuvé de la commande parente, vérifie qu'aucun
`payment_refunds` actif n'existe déjà pour cette ligne (idempotence), insère
`payment_refunds(status='pending', amount_cop=order_lines.acompte_cop, ...)`. Retourne
`{refund_id, mp_payment_id, amount_cop}` — le Route Handler appelle ensuite l'API refund Mercado
Pago (`refundPartial` — remboursement scopé à la ligne, pas à la commande entière).

**RPC `finalize_refund`** : `security definer`, grant execute à `service_role` uniquement (même
invariant que le webhook) — appelée par le Route Handler après la réponse de l'API refund.

**Invariants (Tranche 2)**
- `cancelled_by_provider` ⇒ remboursement intégral de l'acompte de la ligne **et** aucune commission
  due (référent ET app) — invariant financier le plus sensible de la spec, à tester explicitement.
  Reverse les `ledger_entries` concernées en `reversed` (« Reprise »).
- Remboursement toujours scopé à la ligne annulée (`refundPartial`), jamais à la commande entière
  sur une commande multi-lignes.
- `finalize_refund` grantée uniquement à `service_role`.

**Cas limites (Tranche 2)**
- Remboursement demandé deux fois sur la même ligne → refusé (idempotence sur `payment_refunds`).
- Ligne à plage de nuits (spec 17 Tranche 2, `end_date`) annulée à mi-séjour → montant remboursé =
  `acompte_cop` de la ligne entière (forfaitaire, `refundPartial` sur la ligne) — un prorata n'est
  **pas** codé, traité au cas par cas manuellement par l'admin si la situation se présente (§10
  point 9, retiré du périmètre de cette spec).

**Fichiers touchés (Tranche 2)** : `supabase/migrations/<ts>_payment_refunds.sql`,
`apps/admin/app/api/payments/refund/route.ts` (à créer — Tranche 2 non commencée), bouton « Le prestataire annule » dans
`apps/admin/app/admin/orders/OrdersTable.tsx` (même emplacement que le bouton de changement de
statut posé en spec 17 Tranche 1).

---

## 1. Contexte et problème

L'app legacy (racine du dépôt, Express/SQLite) ne collecte aucun paiement en ligne aujourd'hui : le
dépôt est affiché au client mais payé à l'arrivée (`docs/2-reference/08-known-gaps.md:72`), la cible
documentée pour ça est Wompi (`docs/4-pilotage/backlog.md` carte C8), jamais implémentée, bloquée par
la création de la SAS et du compte bancaire pro (cartes A3/A4, non cochées).

Côté hifago 2.0, le moteur de commission **17/10/7 est déjà entièrement conçu, validé et codé** —
ce n'est pas l'objet de cette spec. `01-cahier-des-charges-client.md` §3b (validé par Jérôme le
2026-08-11) fixe, par ligne de commande, snapshoté à la création et jamais recalculé
(`create_order`, `20260814180000_order_lines_commission_snapshot.sql`) :

| Cas | Qui a référé | Acompte total | Part référent | Part app (Hifago) |
|---|---|---|---|---|
| Référent externe | un partenaire différent du prestataire encaissant | 17 % | 10 % | 7 % |
| Auto-référence | le prestataire s'est référé lui-même | 7 % | 0 % | 7 % |
| Direct | aucun référent attribué | 17 % | 0 % | 17 % |

Trois faits, vérifiés directement dans les documents déjà validés, cadrent tout le reste de cette
spec :

1. **L'établissement ne reçoit jamais l'acompte via la plateforme.** L'argent mobilisé en ligne
   n'est jamais le total de la réservation, seulement l'acompte — « le reste se règle directement
   avec l'établissement » (`01-cahier-des-charges-client.md` l.844-847), hors-ligne, à l'arrivée.
   L'établissement ne redevient bénéficiaire d'une part de l'acompte que par une redistribution
   différée (ligne annulée/no-show côté client, cf. règle A3 ci-dessous) — jamais un split en temps
   réel. **Conséquence : le paiement Mercado Pago n'a jamais besoin d'être un split à 3 parties.**
2. **Règle de non-remboursement et de redistribution A3** (`01-cahier-des-charges-client.md`
   l.821-847, simplifiée 2026-08-12) : aucune annulation/no-show côté client ne rembourse jamais le
   client — l'acompte reste encaissé. Seule une annulation par l'**établissement** (impossibilité
   d'honorer) rembourse le client intégralement, et alors aucune commission n'est due. Sur une
   ligne réalisée ou annulée/no-show côté client (acompte encaissé dans les deux cas), la part app
   reste toujours acquise ; la part référent (cas externe uniquement) n'est due que si la ligne est
   **réalisée** — sinon redirigée vers l'établissement, en compensation du créneau bloqué pour rien.
3. **La méthode de paiement du référent était tranchée : manuelle, Bancolombia/Nequi** (§3g
   `02-cahier-des-charges-socio.md`, validé 2026-08-11). Cette spec rouvre ce point (§3) : Mercado
   Pago devient le canal obligatoire, mais le **moment** du virement ne change pas — toujours après
   réalisation de la prestation, jamais à la capture, pour rester cohérent avec le point 2 ci-dessus.

**Le ledger de règlement n'existe pas encore côté hifago 2.0** — confirmé par un commentaire
explicite dans `20260814170000_set_order_line_status_rpc.sql` : *« le cahier des charges dit
"chaque transition écrit le ledger et l'audit" — seul l'audit est branché ici. Le ledger n'existe
pas encore. »* Le dashboard référent a déjà 4 états spécifiés sans mécanisme pour les alimenter
(`02-cahier-des-charges-socio.md` §3c) : Estimée / Acquise à payer / Acquise payée / Reprise.

**Ce qui déclenche cette spec maintenant** : Jérôme a demandé, le 2026-08-18, une intégration
Mercado Pago pour encaisser l'acompte et régler les rétributions. La recherche préalable (moteur de
commission, méthode de paiement référent, capacités marketplace de Mercado Pago) a montré que le
sujet touche directement deux décisions déjà validées (« hors périmètre v1 » du paiement en ligne,
et « Bancolombia/Nequi » pour le référent) — cette spec les rouvre explicitement, avec la
justification ci-dessus, plutôt que de les contredire en silence.

## 2. Portée

**Dans le périmètre** :
- Capture obligatoire de l'acompte (calculé par le moteur 17/10/7 déjà existant) via Mercado Pago,
  pour confirmer une réservation.
- Ledger de règlement (`ledger_entries`) et sa machine à états, alimentés par le cycle de vie
  existant de `order_lines`.
- Virement automatique au référent (via Mercado Pago), déclenché après réalisation de la ligne.
- Compensation à l'établissement en cas de no-show/annulation côté client (redirection ledger,
  réglée manuellement, canal Bancolombia/Nequi inchangé).
- Remboursement intégral et redistribution en cas d'annulation par l'établissement.
- Le prestataire peut marquer lui-même une ligne « client pas venu » depuis son espace socio.
- Webhook Mercado Pago avec vérification de signature et re-confirmation serveur-à-serveur.

**Hors périmètre (renvoyé ailleurs, jamais construit dans cette spec)** :
- Flux self-service de paiement des rétributions (demande de retrait à l'initiative du référent,
  suivi en temps réel) — `README.md` le liste déjà comme non tranché ; la **détection** qu'un
  virement est dû devient automatique côté plateforme (ledger), mais son exécution reste manuelle
  côté admin (§10 point 15) et le référent n'a de toute façon pas d'interface pour en déclencher un
  lui-même.
- Écrans self-service « Datos de pago » (référent et établissement) — spec séparée, à écrire plus
  tard ; cette spec s'appuie sur le chemin admin déjà existant (`create_partner_direct`) comme
  repli pour enregistrer les coordonnées.
- Split marketplace natif Mercado Pago (`application_fee`, OAuth établissement) au moment de la
  capture — inutile ici, cf. §1 point 1 : l'établissement n'est jamais payé via la transaction
  client.
- Prise en charge d'un moyen de paiement autre que Mercado Pago (Wompi, Stripe, PayPal) — hors
  périmètre de cette spec, qui tranche le gateway.

## 3. Décisions retenues

Décisions déjà actées ailleurs, appliquées ici sans être rouvertes :
- Moteur de commission 17/10/7, snapshoté par ligne (§3b, cf. §1) — consommé tel quel, jamais
  recalculé.
- Règle de non-remboursement et de redistribution A3 (§7 cahier client) — cadre entièrement le
  moment du virement référent (§0 Tranche 1) et la logique de remboursement (§0 Tranche 2).
- Statuts `orders`/`order_lines` et leurs transitions (`set_order_line_status`,
  `cancel_order`, `modify_order_line`) — étendus, jamais réécrits.

Décisions explicitement rouvertes par cette spec (fait nouveau : arbitrage direct de Jérôme le
2026-08-18, pas une extension silencieuse) :
- **Le paiement en ligne sort du statut « hors périmètre v1 »** — Mercado Pago remplace Wompi comme
  gateway cible (`04-architecture-cible.md:803-804`, `00-modele-de-donnees.md:427-430`,
  `README.md:44,67` à amender d'un renvoi vers cette spec, cf. §10 point 7).
- **Le paiement de l'acompte devient obligatoire** pour confirmer une réservation — le client paie
  l'acompte calculé en ligne, le reste se règle sur place comme aujourd'hui (inchangé).
- **Mercado Pago devient le canal obligatoire de règlement du référent ET de la compensation
  établissement (no-show)**, rouvrant §3g (`02-cahier-des-charges-socio.md`, « on reste sur
  Bancolombia/Nequi ») pour les deux cas — pas seulement le référent (tranché 2026-08-18, §10
  point 13).
- **Le virement au référent est automatique**, déclenché par API dès que la ligne est réalisée —
  pas un geste manuel admin, et pas un split en temps réel à la capture (choix tranché en session
  pour rester cohérent avec la règle A3 : le split en temps réel enverrait la part référent avant
  de savoir si le client viendra, rendant la redistribution no-show impossible sans reprise).
- **Le prestataire peut marquer lui-même un no-show** depuis son espace socio — élargit
  l'autorisation de `set_order_line_status`, aujourd'hui strictement admin-only.

## 4. Parcours cible

**Client — réservation et paiement** :
1. Le client compose sa commande (parcours existant, inchangé) ; `create_order` réserve les cupos
   et snapshote la commission par ligne (inchangé), insère les `ledger_entries` initiales
   (Tranche 0).
2. Le client est redirigé vers Mercado Pago (Checkout Pro) pour payer l'acompte total de la
   commande (`create_payment_intent`, Tranche 1).
3. Retour sur le site : statut affiché en attente de confirmation webhook (poll de secours,
   `GET /api/payments/[orderId]/status`).
4. Webhook Mercado Pago confirme le paiement (vérifié, re-confirmé côté serveur) →
   `orders.payment_status = 'paid'` → réservation confirmée. Si le paiement n'arrive jamais dans la
   fenêtre de grâce, la réservation expire et le cupo est libéré (inchangé du mécanisme
   d'expiration existant).

**Établissement (socio) — réalisation ou no-show** :
5. À la date de la prestation, l'établissement marque la ligne `fulfilled` (parcours existant) ou
   **`no_show`** (nouveau : accessible directement depuis son espace, pas seulement l'admin).
   `fulfilled` → la créance référent passe `due` → virement Mercado Pago automatique au référent.
   `no_show` → la créance référent est annulée, une compensation `due` est créée pour
   l'établissement (réglée manuellement, canal inchangé).

**Admin — annulation établissement (exceptionnel)** :
6. Si l'établissement ne peut pas honorer, l'admin déclenche
   `request_provider_cancellation_refund` (Tranche 2) → remboursement intégral au client, aucune
   commission due, ledger reversé.

**Référent — suivi** :
7. Le référent consulte son dashboard (§3c cahier socio) : ses `ledger_entries` en Estimée/Acquise à
   payer/Acquise payée/Reprise, alimentées automatiquement par les étapes ci-dessus.

## 5. Écran(s)

- **Admin — Ledger** (nouveau, Tranche 0) : liste des `ledger_entries` par statut, filtrable par
  bénéficiaire, action « marquer payé » + upload comprobante (repli manuel).
- **Admin — Orders** (étendu, Tranche 2) : bouton « Le prestataire annule » sur une ligne, même
  emplacement que le bouton de changement de statut existant (spec 17 Tranche 1).
- **Socio — Mis Reservas** (existant, spec 17 Tranche 1, étendu Tranche 0) : action « Client pas
  venu » directement sur une ligne réservée, en plus des transitions déjà possibles.
- **Socio — Dashboard commissions** (§3c cahier socio — à localiser/construire en implémentation,
  pas encore vérifié comme existant) : lecture des `ledger_entries` du partenaire connecté.
- **Web — Paiement** (nouveau, Tranche 1) : redirection Checkout Pro après `create_order`, page de
  retour avec statut (payé/en attente/échec).

## 6-9. Modèle de données / Contrat API/RPC / Règles et invariants / Cas limites

Entièrement couverts par tranche en §0 — aucune justification ici ne dépasse ce qui y est déjà
écrit.

## 10. Décisions tranchées / points ouverts

**Tranché pendant cette session de planification** (arbitrages directs de Jérôme, pas à rouvrir
sans fait nouveau) :
1. Le paiement de l'acompte en ligne est **obligatoire** pour confirmer une réservation (pas
   optionnel en parallèle du paiement à l'arrivée).
2. Les écrans self-service « Datos de pago » (référent, établissement) sont **hors périmètre** de
   cette spec — chemin admin en repli.
3. Le prestataire (operator) peut marquer lui-même un `no_show` depuis son espace socio.
4. Mercado Pago devient le canal **obligatoire** de règlement du référent, rouvrant §3g pour ce cas
   précis.
5. Le virement au référent est **automatique**, déclenché après réalisation de la ligne — jamais un
   split en temps réel à la capture (contredirait la règle A3 de redistribution no-show). Nuancé par
   la recherche technique (§10 point 15) : c'est la **détection** de la créance due qui est
   automatique (le ledger), pas l'exécution du virement lui-même — aucune API adaptée n'existe pour
   l'exécuter programmatiquement à l'échelle de Hifago.

**Tranché le 2026-08-18 (suite — réponses de Jérôme aux 9 points initialement ouverts)** :
6. **Blocage légal/fiscal** — confirmé : le blocage SAS+NIT (`docs/4-pilotage/backlog.md:122-137,474`,
   cartes A3/A4 non cochées) s'applique **identiquement** à Mercado Pago. Ce n'est pas un choix de
   gateway, c'est structurel : aucun compte marchand colombien (quel que soit le fournisseur)
   n'ouvre sans SAS + NIT + compte bancaire pro. Ne bloque **pas** le développement/les tests en
   sandbox Mercado Pago, seulement le passage en **prod réelle** (vrai argent).
7. **Table dédiée `partner_payout_accounts`** (pas une extension de `partner_crm_profile.bank`) —
   RPC-only, miroir exact de `establishment_payout_accounts`, porte l'identifiant Mercado Pago
   obligatoire de toute identité `referrer`.
8. **Format du justificatif/comprobante** envoyé au client après paiement : **nouveau gabarit**,
   pas une réutilisation des canaux email/WhatsApp existants — à concevoir en implémentation
   (Tranche 1).
9. **Prorata sur annulation à mi-séjour** (ligne à plage de nuits, spec 17 Tranche 2) : **retiré du
   périmètre de cette spec** — traité au cas par cas, manuellement par l'admin selon la situation
   réelle rencontrée, pas une règle générale à coder. Le remboursement automatique
   (`request_provider_cancellation_refund`, §0 Tranche 2) reste forfaitaire (ligne entière) par
   défaut ; un prorata reste un ajustement manuel hors RPC si le cas se présente.
10. **Frais Mercado Pago** — absorbés par la **part app**, jamais déduits de la part référent
    (`referrer_commission_cop` toujours versé intégralement) ni de la part établissement
    (`establishment_compensation`). Invariant ajouté en §0 Tranche 1.
11. **Cahiers de cadrage corrigés directement** (`04-architecture-cible.md`, `00-modele-de-donnees.md`,
    `README.md`, `02-cahier-des-charges-socio.md` §3g) — pas seulement un renvoi depuis cette spec :
    Jérôme veut pousser Mercado Pago comme cible active, pas la documenter en creux. Fait dans
    cette même session, cf. `docs/journal/2026-08.md`.
12. **Mécanisme technique du virement automatique** — si l'API Mercado Pago ne permet pas un
    virement différé plateforme→tiers adapté (cf. point ouvert technique ci-dessous), le repli est
    un **virement manuel admin**, accepté explicitement par Jérôme — pas une contradiction à
    remonter, un repli assumé.
13. **Canal de la compensation établissement (no-show)** — **bascule aussi vers Mercado Pago**, même
    canal que le référent : Bancolombia/Nequi ne reste **pas** le canal pour ce cas. Rouvre le
    champ `establishment_payout_accounts.bank jsonb` livré en Tranche 0 (cf. §0 Tranche 0) — le
    jsonb existant peut porter des identifiants Mercado Pago sans migration de schéma ; un
    renommage/restructuration éventuel se tranche en Tranche 1, pas rétroactivement sur la
    Tranche 0 déjà livrée et testée.

**Confirmé par Jérôme (2026-08-18, suite 3)** :
14. **Durée de la fenêtre de grâce** avant expiration d'une réservation `payment_status='pending'` —
    **30 minutes, validé** (n'est plus une proposition par défaut) — cf. §0 Tranche 1 job
    d'expiration.

**Tranché par la recherche technique (2026-08-18, suite 3) — plus un point ouvert** :
15. **Mécanisme API précis du virement** — recherche approfondie effectuée (SDK Node officiel,
    changelogs GitHub `mercadopago/sdk-nodejs`, docs Developers Mercado Pago CO/AR/PE, forums
    développeurs officiels) : **aucun mécanisme adapté n'existe en libre-service pour la Colombie à
    l'échelle de Hifago**. Split de Pagos = temps réel + OAuth (déjà écarté). Advanced
    Payments/Disbursements existe (`AdvancedPayment` côté SDK, endpoints `POST /v1/advanced_payments`
    + `.../disburses`, confiance moyenne sur le détail exact des endpoints — sources officielles
    inaccessibles au fetch direct, reconstruites via résultats de recherche cohérents) mais réservé
    aux comptes "cartera asesorada" (>100 000 utilisateurs actifs, ticket moyen <15-40 USD selon le
    modèle, approbation commerciale Mercado Pago) — hors de portée. Aucune API de virement P2P
    autonome (CVU/alias) pour la Colombie, ce mécanisme étant réservé à l'Argentine. **Conséquence
    appliquée au §0 Tranche 1** : le repli du point 12 (virement manuel admin) devient le mécanisme
    **permanent**, pas provisoire — `mark_ledger_entry_paid` (Tranche 0, déjà livré) reste l'unique
    point de bascule `due → paid`, aucune RPC d'orchestration de virement n'est construite en
    Tranche 1.

**Proposé avec confiance, déjà ancré dans des décisions validées (documenté directement, pas
re-demandé)** : Checkout Pro plutôt que Checkout API/Bricks pour le v1 (moins de scope PCI,
cohérent avec « un seul compte marchand, pas de split à la capture ») ; `external_reference =
payments.id` comme mécanisme de corrélation ; comptes de règlement (référent, établissement) en
table(s) RPC-only dédiée(s) plutôt qu'une colonne `establishments.payout_method` (cohérent avec le
refus déjà exprimé des tables polymorphes `entity_type`/`entity_id`, spec 17 §10).

## 11. Annexe — traçabilité code→règle

| Section | Fichiers sources |
|---|---|
| §0 Tranche 0, moteur de commission consommé | `hifago/supabase/migrations/20260814180000_order_lines_commission_snapshot.sql` (`create_order`) |
| §0 Tranche 0, RPC étendue | `hifago/supabase/migrations/20260814170000_set_order_line_status_rpc.sql` |
| §0 Tranche 0, patron visibilité référent | `hifago/supabase/migrations/20260814200000_order_lines_referrer_visibility.sql` |
| §0 Tranche 0, forme `bank jsonb` | `hifago/supabase/migrations/20260814233000_partner_direct_creation.sql` (`partner_crm_profile.bank`) |
| §0 Tranche 1, patron file de retry webhook | `hifago/supabase/migrations/20260814210000_pms_reconciliation_entries.sql` |
| §0 Tranche 1, squelette sécurité RPC | `hifago/docs/05-reference-technique.md` |
| §0 Tranche 1, job d'expiration (pattern) | `hifago/docs/04-architecture-cible.md:468-498` |
| §0 Tranche 1, DB livrée | `hifago/supabase/migrations/20260818200000_payments.sql`, `20260818210000_payment_reconciliation_entries.sql`, `20260818220000_apply_payment_webhook.sql`, `20260818230000_expire_stale_payment_orders_job.sql`, `hifago/supabase/tests/database/payments.test.sql` |
| §0 Tranche 1, wrapper SDK + route handlers livrés | `hifago/apps/web/lib/mercadopago/client.ts`, `hifago/packages/domain/src/mercadopago/mapPaymentStatus.ts`, `hifago/apps/web/app/api/payments/{create,webhook,[orderId]/status}/route.ts` |
| §0 Tranche 1, `WebhookSignatureValidator` officiel | `node_modules/mercadopago/dist/utils/webhook/index.d.ts` (SDK npm `mercadopago`, découvert en implémentation — remplace le HMAC manuscrit initialement prévu) |
| §1, moteur 17/10/7 validé | `hifago/docs/01-cahier-des-charges-client.md` §3b (l.318-357) |
| §1, règle A3 redistribution/remboursement | `hifago/docs/01-cahier-des-charges-client.md` l.821-847 |
| §1, méthode de paiement référent | `hifago/docs/02-cahier-des-charges-socio.md` §3g (l.533-555) |
| §1, dashboard référent (4 états) | `hifago/docs/02-cahier-des-charges-socio.md` §3c (l.311-325) |
| §1, « hors périmètre v1 » (3 documents) | `hifago/docs/04-architecture-cible.md:803-804`, `hifago/docs/00-modele-de-donnees.md:427-430`, `hifago/README.md:44,67,76` |
| §10 point 1, blocage légal Wompi (app racine) | `docs/4-pilotage/backlog.md:122-137,474` (dépôt racine, carte C8/A3/A4) |
| §5, dashboard socio existant | `hifago/docs/specs/17-calendrier-disponibilite-refonte.md` (Tranche 1, « Mis Reservas ») |

## 12. Documents liés

- `hifago/docs/01-cahier-des-charges-client.md` §3b/§7 — moteur de commission et règle de
  non-remboursement, non rouverts, seulement consommés.
- `hifago/docs/02-cahier-des-charges-socio.md` §3c/§3g — dashboard référent et méthode de paiement,
  §3g partiellement rouvert (§3/§10 point 9).
- `hifago/docs/00-modele-de-donnees.md` l.416-430 — schéma dormant payout établissement, décision
  « on ne touche pas au paiement pour l'instant » rouverte par cette spec.
- `hifago/docs/04-architecture-cible.md` l.803-804 — « hors périmètre v1 » rouvert par cette spec.
- `hifago/docs/specs/17-calendrier-disponibilite-refonte.md` — cycle de vie `order_lines`/
  `set_order_line_status` étendu ici, écran socio « Mis Reservas » réutilisé.
- `hifago/docs/05-reference-technique.md` — squelette RPC anti-survente réutilisé, écart documenté
  en §0 Tranche 1.
- `docs/4-pilotage/backlog.md` (dépôt racine) — carte C8 (Wompi), blocage légal A3/A4, contexte du
  choix de gateway remplacé par cette spec.
