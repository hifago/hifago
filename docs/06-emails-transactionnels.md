---
id: refonte-emails-transactionnels
titre: "Emails transactionnels — les 13 envois possibles, leur déclencheur et leur destinataire"
theme: cadrage
statut: "vérifié en envoi RÉEL le 2026-08-31 — les 8 emails sont partis chez Resend depuis la stack locale et reçus en boîte ; secrets Resend posés en préprod, aucun envoi réel en préprod à ce jour"
maj: 2026-10-07
resume: >
  Table de référence des 13 seuls emails que hifago peut envoyer (liste fermée par la contrainte
  check sur notification_emails.event_type) : ce qui les déclenche, à qui ils partent, leur objet
  et leur corps exacts. Décrit le comportement réel du code, pas une cible.
mots_cles: [email, notification, resend, destinataire, declencheur, notification_emails, spec 23]
repond_a:
  - "Quels emails hifago peut-il envoyer, et à qui ?"
  - "Qu'est-ce qui déclenche tel email, et que contient-il exactement ?"
  - "Quel email part au client, lequel part au socio, lequel part à l'admin ?"
---

# Emails transactionnels — les 13 envois possibles

> Liste **fermée** : la contrainte `check` sur `notification_emails.event_type`
> (`supabase/migrations/20260824020000_notification_emails.sql`, élargie depuis — dernière fois par
> `20261006192424_order_line_cancellations.sql`) n'autorise que ces 13 valeurs.
> Aucun autre email ne peut sortir de hifago. Spécification d'origine :
> `docs/specs/23-notifications-email-transactionnelles.md`.
>
> Ce document décrit **ce que le code fait**, relevé sur les définitions live. En cas de
> divergence, le code fait foi.

## Tableau de référence

| # | `event_type` | Action qui le déclenche | Part à qui | Objet (ES) |
|---|---|---|---|---|
| 1 | `partner_invitation` | Un admin crée une invitation **et** remplit le champ « Correo (opcional) » | L'adresse saisie par l'admin | `Invitación a unirte a Hifago` |
| 2 | `admin_new_proposal` | Un socio soumet une proposition de produit ou d'établissement | **Tous les admins actifs**, un email chacun | `Nueva propuesta de producto pendiente de moderación` / `…de establecimiento…` |
| 3 | `admin_new_reconciliation_exception` | Une exception de réconciliation est créée (PMS ou paiement) | **Tous les admins actifs**, un email chacun | `Nueva excepción de reconciliación PMS` / `…de pago` / `Pago recibido sin reserva que honrar — reembolso requerido` (entrée `kind = 'refund_required'`, 2026-09-20) |
| 4 | `partner_proposal_decided` | Un admin approuve ou rejette une proposition | Le compte socio qui l'a soumise | `Tu propuesta fue aprobada` / `Tu propuesta fue rechazada` |
| 5 | `partner_commission_earned` | Le paiement d'une commande est confirmé | Chaque **compte référent distinct** ayant une ligne en `commission_case = 'external_referrer'` | `Nueva comisión asignada` |
| 6 | `partner_payment_confirmed` | Le paiement d'une commande est confirmé | Chaque **compte propriétaire distinct** des produits commandés | `Pago confirmado` |
| 7 | `client_order_confirmed` | Le paiement d'une commande est confirmé | Le client, sur `orders.holder_email` — un seul email par commande | `Reserva confirmada` |
| 8 | `partner_camp_evento_blocked` | Une commande contenant une ligne `camp` est créée — **à la réservation, avant le paiement** | Chaque compte du partenaire propriétaire du camp/evento | `Reserva confirmada — recurso bloqueado` |
| 9 | `client_payment_received_not_honored` | Une entrée `refund_required` de `reason_code` `paid_after_expiry` ou `amount_mismatch` est créée (le client a payé, rien n'est honoré) — spec 39 D3, 2026-09-22 | Le client, sur `orders.holder_email` — **un seul e-mail par entrée** (dédup sur `related_id`) | `Recibimos tu pago — tu reserva <HFG-n> no pudo confirmarse` |
| 10 | `client_duplicate_payment_refund` | Une entrée `refund_required` de `reason_code` `double_payment` est créée (la réservation EST confirmée, le doublon sera remboursé) | Le client, un e-mail par entrée | `Recibimos un pago duplicado para tu reserva <HFG-n>` |
| 11 | `admin_job_stalled` | Un watchdog constate qu'un job attendu n'a pas réussi depuis son seuil (`job_expectations`, un seuil par job) — ou n'a **jamais été exécuté** passé ce seuil — une seule fois par panne tant qu'il ne repart pas | **Tous les admins actifs**, un email chacun | `El job <job> no responde (sin ejecución exitosa desde hace más de <seuil>)` ; `payments-reconcile` garde le sien : `El job de conciliación de pagos no responde desde hace <seuil>` |
| 12 | `client_order_line_cancelled` | Une prestation est annulée (`cancelled_by_client` ou `cancelled_by_provider`), par le client, l'admin ou l'établissement — jamais pour `expired` | Le client, sur `orders.holder_email` — jamais une adresse sentinelle `@hifago.local` | `Anulación en tu reserva <HFG-n>` |
| 13 | `partner_order_line_cancelled` | Même événement que le 12 | Chaque compte de connexion du partenaire propriétaire du produit | `Reserva anulada: <produit>` |

Les emails 5, 6 et 7 partent tous les trois du **même événement** : `apply_payment_webhook` en
branche `approved`. Un paiement confirmé peut donc générer plusieurs emails d'un coup.

## Où c'est branché

| # | Fonction / trigger | Fichier |
|---|---|---|
| 1 | `create_partner_invitation` | `supabase/migrations/20260826100000_create_partner_invitation_reject_duplicate_code.sql` |
| 2 | trigger `notify_admin_new_proposal` sur `product_proposals` + `establishment_proposals` | `supabase/migrations/20260824090000_fix_notify_admin_new_proposal_null_join.sql` |
| 3 | trigger `notify_admin_new_reconciliation_exception` sur `pms_reconciliation_entries` + `payment_reconciliation_entries` | `supabase/migrations/20260824060000_notify_admin_reconciliation_exception.sql` |
| 4 | `moderate_product_proposal` + `moderate_establishment_proposal` | `supabase/migrations/20260824070000_notify_partner_proposal_decided.sql` |
| 5 | `apply_payment_webhook` | `supabase/migrations/20260824120000_notify_payment_confirmed.sql` |
| 6 | `apply_payment_webhook` | idem |
| 7 | `apply_payment_webhook` | idem |
| 8 | `create_order`, branche `camp` | `supabase/migrations/20260824110000_notify_partner_camp_evento_blocked.sql` |
| 9-10 | trigger `notify_client_refund_required` sur `payment_reconciliation_entries` (`when new.kind = 'refund_required'`) | `supabase/migrations/20260922100000_payment_refunds.sql` |
| 11 | `jobs_watchdog` → `job_watchdog` (pg_cron `jobs-watchdog`, `*/15`) et `payments_reconcile_watchdog` (pg_cron `*/15`), seuils lus dans `job_expectations` | `supabase/migrations/20261003223900_pms_jobs_supervision.sql`, `20261006143045_job_expectations.sql` (et `20260921100000_payments_reconcile.sql`) |
| 12-13 | `notify_order_line_cancelled`, appelée par `close_order_line_locked` (`cancel_order_line`, `set_order_line_status`) | `supabase/migrations/20261006192424_order_line_cancellations.sql` (redéfinie par `20261006235357_pms_booking_identity.sql`) |

Tous passent par `enqueue_notification_email` (ou `notify_all_admins` pour les e-mails admin),
qui empile dans `notification_emails`. L'envoi physique est fait plus tard par l'Edge Function
`send-notification-emails`, appelée toutes les 5 minutes par pg_cron.

## Contenu exact de chaque email

**1 · `partner_invitation`**
« Has recibido una invitación para unirte a Hifago. » + lien *Aceptar invitación* (URL **absolue**,
construite depuis le secret Vault `admin_app_public_url`) + « Este enlace es de un solo uso y expira
pronto. »

**2 · `admin_new_proposal`**
Nom de l'entité proposée (ou « Sin nombre ») + « Propuesto por: <socio> » (ou « Socio desconocido »)
+ lien *Ver propuesta* vers `/admin/proposals/<id>`.

**3 · `admin_new_reconciliation_exception`**
Libellé de l'entrée : nom du produit pour une exception PMS, « Pedido <HFG-n> de <nom> — <montant>
COP » pour une exception de paiement, ou « Pedido no identificado » si le webhook n'a jamais pu être
corrélé à un paiement connu + lien *Ver reconciliaciones pendientes* vers `/admin/reconciliation`,
**absolu** depuis le 2026-09-20 (secret Vault `admin_app_public_url`, même patron que l'invitation ;
relatif en repli si le secret manque). Le détail (`failure_reason`, `raw_event`) reste réservé à
l'écran. Une entrée `kind = 'refund_required'` (argent encaissé sans prestation à honorer —
migration 20260920120000) porte le sujet dédié ci-dessus. ⚠️ Un e-mail par admin et par entrée,
sans dédup — sauf les échecs de signature du webhook, étranglés à une entrée notifiée par heure
glissante, donc au plus un e-mail par admin et par heure (`20261002125023_reconciliation_email_throttle.sql`,
P5b). L'autre borne est l'index unique partiel « une entrée `refund_required` par paiement Mercado
Pago ».

**4 · `partner_proposal_decided`**
« Tu propuesta para "<nom>" fue aprobada. » — ou, en cas de rejet, « …fue rechazada. » suivi de
« Motivo: <raison saisie par l'admin> ». Aucun lien.

**5 · `partner_commission_earned`**
« Se te asignó una comisión por una reserva confirmada. » Rien d'autre : ni montant, ni nom de
produit, ni lien.

**6 · `partner_payment_confirmed`**
« Se confirmó el pago de una reserva en tu establecimiento. » Rien d'autre non plus.

**7 · `client_order_confirmed`**
« Hola <prénom>, tu reserva fue confirmada: » suivi d'une liste, une ligne par prestation :
nom du produit en espagnol — date (— date de fin si séjour) — montant en COP. Le seul des huit qui
détaille vraiment quelque chose. Pas de lien vers `/orders/[id]/status`.

**8 · `partner_camp_evento_blocked`**
« Se reservó "<produit>". » + « Período bloqueado: <du> a <au>. » + « Otras actividades que comparten
este recurso pueden haber quedado no disponibles durante ese período. »

## Faiblesses connues de ces contenus

Relevées à la lecture du code, puis **confirmées en boîte** par l'envoi réel du 2026-08-31.
Aucune n'est corrigée — à traiter avant d'ouvrir l'envoi à de vrais partenaires et clients.

- **Emails 2 et 3 : les liens sont relatifs** (`href="/admin/proposals/…"`, `href="/admin/reconciliation"`).
  Un lien relatif n'a aucune base dans une boîte mail : il est inutilisable. Seul l'email 1
  construit une URL absolue, via `admin_app_public_url`.
- **Emails 5 et 6 : aucun contenu utile.** Ce sont les deux emails qui parlent d'argent à un socio,
  et ils ne portent ni montant, ni nom de produit, ni date, ni lien. Le destinataire ne peut rien
  en faire.
- **Aucun échappement HTML.** Les noms de produit et d'établissement viennent d'un payload saisi
  par un socio et sont concaténés bruts dans le corps (emails 2, 4, 7, 8). Une injection de lien
  dans un email lu par l'admin est possible.
- **Tout est en espagnol**, y compris les deux emails destinés aux admins. La langue était listée
  « à trancher » en §10.9 de la spec 23 ; elle a été tranchée de fait dans le code, jamais reportée
  dans la spec.
- **`create_manual_order_line` (réservation au comptoir) n'envoie rien** — pas même l'email 8 quand
  la ligne bloque un camp/evento. Comportement non spécifié, à trancher.

## État d'exécution

**Les 8 emails ont été envoyés et reçus pour de vrai le 2026-08-31**, depuis la stack Supabase
locale vers Resend, chacun déclenché par son vrai chemin d'appel. C'est la première fois que ces
messages sont lus par un humain. Le harnais qui le prouve est
`tests/notification-real/send_8_real_emails.mjs` (`npm run test:notification-real`, protégé par
`HIFAGO_REAL_EMAIL_SEND=1` et `--yes`, jamais en CI) : il fabrique ses fixtures, déclenche les 8
événements, dispatche une ligne à la fois et exige un `provider_message_id` Resend réel pour
chacune.

Ce que ce premier envoi réel a confirmé :

- les 8 enqueue sont présents dans les définitions **live** — aucune redéfinition ultérieure de
  `create_order` ou `apply_payment_webhook` ne les a perdus ;
- une seule commande à une seule ligne `external_referrer` produit bien **trois** emails (5, 6 et 7) ;
- l'email 8 part à la réservation, avant tout paiement, comme spécifié ;
- les corps sont rendus correctement en espagnol, accents compris.

Côté préprod, en revanche : les secrets `RESEND_API_KEY` et `NOTIFICATION_EMAIL_FROM` sont posés
depuis le 2026-08-31, mais **aucun envoi réel n'y a encore été observé**. Les 9 lignes empilées
avant que les secrets soient posés y sont toutes en `abandoned` — état terminal, elles ne
repartiront pas.

**9 · `client_payment_received_not_honored`** — « Hola <nom>, Recibimos tu pago de $<montant> COP,
pero tu reserva **<HFG-n>** no pudo confirmarse: la reserva ya había expirado o había sido anulada
cuando llegó el pago. » (ou « el monto recibido no coincide con el anticipo de la reserva. » pour un
écart de montant) « Te contactamos en las próximas horas para reembolsarte o volver a reservar. No
necesitas hacer nada. » + lien *Ver tu reserva* (Vault `web_app_public_url`, omis si absent).
⚠️ Texte proposé par l'agent le 2026-09-22, **à valider par Jérôme** (spec 39 §5/§10.6).

**10 · `client_duplicate_payment_refund`** — « Tu reserva **<HFG-n>** está confirmada. Recibimos un
segundo pago de $<montant> COP para la misma reserva: te lo reembolsaremos por el mismo medio de
pago en los próximos días. » + lien. Même réserve de validation.

**11 · `admin_job_stalled`** — watchdog générique (`job_watchdog`, cron `jobs-watchdog` toutes les
15 min) pour chaque job de `job_expectations` : nom du job, dernière exécution réussie (heure de
Colombie, ou « nunca »), dernier `last_error` ; pour un job jamais exécuté passé son seuil, les NOMS
à vérifier (déploiement de l'Edge Function, secrets du Vault, `net._http_response`), jamais une
valeur (`20261006143045_job_expectations.sql`). `payments-reconcile` garde son watchdog et son corps
dédiés : dernière exécution réussie, dernier `last_error`, et le rappel que tant que le job est
arrêté aucune réservation n'expire et aucun paiement tardif n'est concilié.

**12 · `client_order_line_cancelled`** — « Hola <nom>, » + qui a annulé (« Anulaste », « Anulamos, a
tu pedido, » ou « El establecimiento anuló ») « <produit> » + dates + référence de la commande + lien
*Ver tu reserva* (Vault `web_app_public_url`). Le **fait** seulement, sans un mot sur l'argent.
⚠️ Textes provisoires, **à valider par Jérôme**.

**13 · `partner_order_line_cancelled`** — « Se anuló <produit> » + dates, quantité, référence, auteur
de l'annulation, puis ce que devient la disponibilité (transmise à LobbyPMS, booking encore actif
chez Lobby, ou « La disponibilidad quedó liberada »). Rien sur l'argent. Même réserve de validation.

> Liste fermée de **13** événements depuis le 2026-10-06 (contrainte `notification_emails_event_type_check`,
> migration `20261006192424_order_line_cancellations.sql`).
