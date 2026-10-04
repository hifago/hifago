-- Spec 19 §0 Tranche 1 — create_payment_intent, apply_payment_webhook (grant service_role
-- uniquement), payment_reconciliation_entries/resolve_payment_reconciliation_entry,
-- expire_stale_payment_orders (job pg_cron, SUPPRIMÉ le 2026-09-21). Migrations 20260818200000/210000/220000/230000,
-- seules sources de vérité pour les messages/logique. apply_payment_webhook n'a AUCUN check
-- interne d'identité (cf. commentaire de la migration) : sa sécurité repose entièrement sur le
-- GRANT — vérifié ici via has_function_privilege (métadonnée ACL) ET un appel réel sous
-- `set local role authenticated` (le vrai rôle Postgres change, contrairement à test_login qui ne
-- simule qu'un claim JWT), pas seulement l'un ou l'autre.
begin;
select plan(87);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function test_logout() returns void language sql as $$
  reset request.jwt.claims;
$$;

-- Fixtures : 1 partenaire propriétaire/établissement/produit, 1 partenaire référent, 1 admin, 2
-- comptes acheteurs distincts (buyer = propriétaire des commandes de test, other = identité
-- différente pour le cas "commande d'un autre compte"), 1 compte référent.
insert into partners (id, display_name) values
  ('88970000-0000-4000-8000-000000000001', 'Payments Test Owner Partner'),
  ('88970000-0000-4000-8000-000000000002', 'Payments Test Referrer');
insert into establishments (id, partner_id, name) values
  ('88970000-0000-4000-8000-000000000011', '88970000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Payments'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88970000-0000-4000-8000-000000000021', '88970000-0000-4000-8000-000000000001',
  '88970000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Payments'), 100000, true, 'payments-test'
);

insert into auth.users (id, email) values
  ('88970000-0000-4000-8000-000000000031', 'payments-admin@test.local'),
  ('88970000-0000-4000-8000-000000000032', 'payments-buyer@test.local'),
  ('88970000-0000-4000-8000-000000000033', 'payments-other@test.local'),
  ('88970000-0000-4000-8000-000000000034', 'payments-referrer@test.local'),
  -- RÉVISÉ 2026-09-10 (spec 31, Tranche 2) : orders.account_id est NOT NULL — l'« invité » de
  -- l'Order A ci-dessous a désormais besoin d'une identité réelle (distincte du buyer 032, pour ne
  -- pas fausser les cas qui comptent les commandes PAR compte), même si aucun de ces tests ne
  -- dépend d'elle étant spécifiquement anonyme (déjà couvert par create_order.test.sql).
  ('88970000-0000-4000-8000-000000000035', 'payments-guest@test.local'),
  -- Compte TECHNIQUE fixe des réservations walk-in (`v_technical_account_id`,
  -- create_manual_order_line, 20260910140000) — un UUID constant, PROVISIONNÉ ailleurs par
  -- `seed_auth_users.mjs`, jamais par ce fichier. Ce job pgTAP tourne délibérément SANS seed
  -- (`.github/workflows/hifago-ci.yml`, job `db`) : sans cette ligne, l'Order J ci-dessous violait
  -- la contrainte `orders_account_id_fkey` — trouvé le 2026-09-19, masqué jusque-là par un autre
  -- job CI en échec qui empêchait celui-ci de tourner.
  -- `on conflict do nothing` : cette base peut aussi être une base de DEV déjà seedée, où ce même
  -- UUID technique existe déjà — jamais un doublon à lever en erreur ici.
  ('e0000000-0000-4000-8000-000000000001', 'reserva-manual@hifago.local')
on conflict (id) do nothing;
insert into partner_capabilities (account_id, role, source, status)
values ('88970000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status)
values ('88970000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');
update partner_accounts set partner_id = '88970000-0000-4000-8000-000000000002'
 where id = '88970000-0000-4000-8000-000000000034';

-- Order A : invité (identité distincte 035) — cas create_payment_intent principal (chemin invité,
-- le plus fréquent en usage réel : redirection Checkout Pro immédiatement après create_order).
insert into orders (id, account_id, holder_name, holder_email)
values ('88970000-0000-4000-8000-000000000041', '88970000-0000-4000-8000-000000000035',
        'Holder Payments Guest', 'guest-payments@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-000000000051', '88970000-0000-4000-8000-000000000041',
  '88970000-0000-4000-8000-000000000035',
  '88970000-0000-4000-8000-000000000021', '2028-12-01', 1, 'reserved', 'Holder Payments Guest',
  100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);

-- Order B : compte authentifié (buyer), 3 lignes — 2 reserved (acompte 20000+20000=40000, seules
-- comptées) + 1 cancelled_by_client (exclue) + 1 superseded (exclue) : preuve que le montant somme
-- UNIQUEMENT les lignes encore actives, même discipline que cancel_order.
insert into orders (id, account_id, holder_name, holder_email)
values ('88970000-0000-4000-8000-000000000042', '88970000-0000-4000-8000-000000000032',
        'Holder Payments Buyer', 'buyer-payments@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('88970000-0000-4000-8000-000000000052', '88970000-0000-4000-8000-000000000042',
   '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
   '2028-12-02', 1, 'reserved', 'Holder Payments Buyer', 100000, 100000, 'direct', 0.2, 0, 0.2, 20000, 0, 20000),
  ('88970000-0000-4000-8000-000000000053', '88970000-0000-4000-8000-000000000042',
   '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
   '2028-12-03', 1, 'reserved', 'Holder Payments Buyer', 100000, 100000, 'direct', 0.2, 0, 0.2, 20000, 0, 20000),
  ('88970000-0000-4000-8000-000000000054', '88970000-0000-4000-8000-000000000042',
   '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
   '2028-12-04', 1, 'cancelled_by_client', 'Holder Payments Buyer', 100000, 100000, 'direct', 0.2, 0, 0.2, 20000, 0, 20000),
  ('88970000-0000-4000-8000-000000000055', '88970000-0000-4000-8000-000000000042',
   '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
   '2028-12-05', 1, 'superseded', 'Holder Payments Buyer', 100000, 100000, 'direct', 0.2, 0, 0.2, 20000, 0, 20000);

-- Order C : toutes les lignes déjà annulées → rien à payer.
insert into orders (id, account_id, holder_name, holder_email)
values ('88970000-0000-4000-8000-000000000043', '88970000-0000-4000-8000-000000000032',
        'Holder Payments Nothing', 'nothing-payments@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-000000000056', '88970000-0000-4000-8000-000000000043',
  '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
  '2028-12-06', 1, 'cancelled_by_client', 'Holder Payments Nothing', 100000, 100000, 'direct', 0.2, 0, 0.2, 20000, 0, 20000
);

------------------------------------------------------------------------------------------------
-- create_payment_intent
------------------------------------------------------------------------------------------------

-- Cas 1 : invité (SA PROPRE session — identité 035, jamais un simple rôle anon depuis le
-- 2026-09-10, spec 31 : orders.account_id est NOT NULL, donc la garde de create_payment_intent
-- refuse désormais tout appelant DISTINCT du propriétaire, sans exception pour l'absence de
-- session — cf. migration 20260909190000, le trou qu'elle laissait volontairement ouvert pour un
-- invité sans compte n'existe plus) crée un intent sur sa propre commande. UN SEUL appel RPC (un
-- second appel immédiat retomberait sur payment_already_pending, cf. cas 2) — les autres
-- assertions lisent l'état persisté (payments/orders), jamais un second appel à la RPC.
set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000035');
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000041') ->> 'ok'),
  'true',
  'cas 1a : invité crée un intent sur sa propre commande → ok:true'
);
-- Lecture directe de payments : jamais sous authenticated (RLS admin-only, payments_select_admin)
-- — reset role AVANT toute lecture de cette table dans ce fichier, même discipline que le reste des
-- RPC RLS-only déjà en place (ledger_entries.test.sql, set_order_line_status.test.sql).
reset role;
select is(
  (select amount_cop from payments where order_id = '88970000-0000-4000-8000-000000000041'),
  17000::bigint,
  'cas 1b : amount_cop = somme des acompte_cop des lignes reserved (17000)'
);
select is(
  (select status::text from payments where order_id = '88970000-0000-4000-8000-000000000041'),
  'pending',
  'cas 1c : une ligne payments pending créée'
);
select is(
  (select payment_status from orders where id = '88970000-0000-4000-8000-000000000041'),
  'pending',
  'cas 1d : orders.payment_status passe à pending'
);

-- Cas 2 : second appel sur la même commande (même identité 035), intent encore pending au même
-- montant → le MÊME payment est renvoyé (`reused`), jamais un second `pending`. RÉVISÉ par la
-- migration 20260930221837 : avant, `payment_already_pending` sans payment_id — un seul 503 de
-- Mercado Pago bloquait alors « Reintentar pago » jusqu'à l'expiration de la commande.
set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000035');
create temp table intent_reuse as
  select create_payment_intent('88970000-0000-4000-8000-000000000041') as r;
reset role; -- lecture payments : admin-only RLS (cf. cas 1b)
select is(
  (select jsonb_build_object(
     'ok', r->'ok',
     'reused', r->'reused',
     'meme_paiement', (r->>'payment_id')::uuid
                        = (select id from payments where order_id = '88970000-0000-4000-8000-000000000041' and status = 'pending'),
     'pendings', (select count(*) from payments where order_id = '88970000-0000-4000-8000-000000000041' and status = 'pending'))
   from intent_reuse),
  jsonb_build_object('ok', true, 'reused', true, 'meme_paiement', true, 'pendings', 1),
  'cas 2 : second intent au même montant → le même payment, reused:true, toujours un seul pending'
);

-- Cas 3 : commande inconnue → order_not_found. Indépendant de l'identité (la garde d'existence
-- précède la garde de propriété) : rôle anon conservé ici, plus fidèle à un appel sans session.
reset role;
set local role anon;
select is(
  (select create_payment_intent('00000000-0000-4000-8000-000000000099') ->> 'reason'),
  'order_not_found',
  'cas 3 : commande inexistante → order_not_found'
);
reset role;

-- Cas 4 : buyer authentifié crée un intent sur SA commande à lignes mixtes (Order B).
set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000032'); -- buyer
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000042') ->> 'ok'),
  'true',
  'cas 4a : buyer authentifié crée un intent sur sa propre commande → ok:true'
);
select test_logout();
reset role; -- lecture payments : admin-only RLS, jamais sous authenticated (cf. cas 1b)
select is(
  (select amount_cop from payments where order_id = '88970000-0000-4000-8000-000000000042'),
  40000::bigint,
  'cas 4b : amount_cop ignore les lignes cancelled_by_client/superseded (40000, pas 80000)'
);

-- Cas 5 : un AUTRE compte authentifié tente de payer la commande du buyer → order_not_found (même
-- réponse qu'une commande inexistante, jamais un refus distinct qui la confirmerait).
set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000033'); -- other
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000042') ->> 'reason'),
  'order_not_found',
  'cas 5 : un autre compte authentifié ne peut pas payer la commande du buyer'
);

-- Cas 5bis : un appelant SANS AUCUNE SESSION (rôle anon, aucun claim JWT) sur la commande du
-- buyer → order_not_found. C'EST LE CAS QUI MANQUAIT : le cas 5 ci-dessus, avec un autre compte
-- AUTHENTIFIÉ, passait déjà — la garde d'origine (`v_account_id is not null and …`) se désarmait
-- justement quand l'appelant n'avait pas de session, et laissait alors créer un payment sur la
-- commande d'autrui en renvoyant l'email du titulaire. Reproduit en réel le 2026-09-09, corrigé par
-- la migration 20260909190000. Sans cette assertion, la correction serait un souhait (§11.20).
reset role;
set local role anon;
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000042') ->> 'reason'),
  'order_not_found',
  'cas 5bis : un appelant SANS session ne peut pas payer la commande d''un compte'
);
reset role;
-- (Pas d'assertion « aucune ligne créée » ici : la commande 42 porte DÉJÀ le payment légitime du
-- cas 4, donc un comptage serait faux. Le `order_not_found` ci-dessus suffit à prouver la garde —
-- la fonction retourne avant d'atteindre le moindre insert.)

-- Cas 6 : commande dont toutes les lignes sont déjà annulées → nothing_to_pay.
select test_logout();
select test_login('88970000-0000-4000-8000-000000000032');
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000043') ->> 'reason'),
  'nothing_to_pay',
  'cas 6 : commande sans ligne reserved → nothing_to_pay'
);

-- Cas 7 : paiement déjà approuvé → already_paid (nouvel intent refusé même après expiration du
-- pending précédent). Simule directement l'état post-webhook (pas besoin de rejouer webhook ici).
reset role;
update payments set status = 'approved' where order_id = '88970000-0000-4000-8000-000000000042';
set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000032');
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000042') ->> 'reason'),
  'already_paid',
  'cas 7 : paiement déjà approuvé → already_paid'
);
select test_logout();
reset role;

------------------------------------------------------------------------------------------------
-- apply_payment_webhook — grant service_role uniquement (aucun check interne d'identité).
------------------------------------------------------------------------------------------------

-- Order D/E dédiées (payments insérés directement, RPC-only mais postgres/superuser passe outre —
-- même patron que les fixtures ledger_entries direct-insert).
insert into orders (id, account_id, holder_name, holder_email)
values
  ('88970000-0000-4000-8000-000000000044', '88970000-0000-4000-8000-000000000032',
   'Holder Payments Webhook OK', 'webhook-ok@test.local'),
  ('88970000-0000-4000-8000-000000000045', '88970000-0000-4000-8000-000000000032',
   'Holder Payments Webhook Rejected', 'webhook-rejected@test.local');
-- RÉVISÉ 2026-09-20 (durcissement 20260920120000) : ces deux commandes n'avaient AUCUNE ligne —
-- un raccourci de fixture impossible en réel (create_payment_intent exige une ligne reserved avec
-- acompte dû). Depuis la garde « rien à honorer », un paiement sur une commande sans ligne vivante
-- est refusé (refund_required) : la fixture porte donc désormais la ligne reserved qu'elle aurait
-- toujours dû avoir. Trouvé en faisant rougir ce fichier, pas supposé.
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('88970000-0000-4000-8000-000000000057', '88970000-0000-4000-8000-000000000044',
   '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
   '2028-12-07', 1, 'reserved', 'Holder Payments Webhook OK', 100000, 100000, 'direct', 0.25, 0, 0.25, 25000, 0, 25000),
  ('88970000-0000-4000-8000-000000000058', '88970000-0000-4000-8000-000000000045',
   '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
   '2028-12-08', 1, 'reserved', 'Holder Payments Webhook Rejected', 100000, 100000, 'direct', 0.3, 0, 0.3, 30000, 0, 30000);
insert into payments (id, order_id, status, amount_cop)
values
  ('88970000-0000-4000-8000-000000000071', '88970000-0000-4000-8000-000000000044', 'pending', 25000),
  ('88970000-0000-4000-8000-000000000072', '88970000-0000-4000-8000-000000000045', 'pending', 30000);

-- Cas 8 : métadonnées ACL — jamais authenticated/anon, service_role uniquement.
select is(
  has_function_privilege('authenticated', 'apply_payment_webhook(text,uuid,text,jsonb)', 'execute'),
  false,
  'cas 8a : authenticated n''a jamais EXECUTE sur apply_payment_webhook'
);
select is(
  has_function_privilege('anon', 'apply_payment_webhook(text,uuid,text,jsonb)', 'execute'),
  false,
  'cas 8b : anon n''a jamais EXECUTE sur apply_payment_webhook'
);
select is(
  has_function_privilege('service_role', 'apply_payment_webhook(text,uuid,text,jsonb)', 'execute'),
  true,
  'cas 8c : service_role a EXECUTE sur apply_payment_webhook'
);

-- Cas 9 : appel réel sous le VRAI rôle Postgres authenticated (pas seulement un claim JWT) →
-- rejeté par le GRANT lui-même, avant même d'entrer dans le corps de la fonction.
set local role authenticated;
select throws_ok(
  $$ select apply_payment_webhook(
       'mp-1', '88970000-0000-4000-8000-000000000071'::uuid, 'approved', '{}'::jsonb
     ) $$,
  '42501'::char(5),
  null,
  'cas 9 : appel sous le rôle authenticated → permission denied (grant, pas un check interne)'
);
reset role;

-- Cas 10 : appel réel sous service_role → approbation effective.
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-1', '88970000-0000-4000-8000-000000000071'::uuid, 'approved',
     jsonb_build_object('id', 'mp-1', 'status', 'approved')
   ) ->> 'ok'),
  'true',
  'cas 10a : webhook approved sous service_role → ok:true'
);
reset role;
select is(
  (select status::text from payments where id = '88970000-0000-4000-8000-000000000071'),
  'approved',
  'cas 10b : payments.status passe à approved'
);
select is(
  (select payment_status from orders where id = '88970000-0000-4000-8000-000000000044'),
  'paid',
  'cas 10c : orders.payment_status passe à paid'
);
select is(
  (select mp_payment_id from payments where id = '88970000-0000-4000-8000-000000000071'),
  'mp-1',
  'cas 10d : mp_payment_id enregistré'
);

-- Cas 11 : webhook dupliqué (même paiement déjà approved) → no-op idempotent, ok:true (jamais une
-- erreur — Mercado Pago retenterait indéfiniment un webhook qui ne renvoie pas 2xx).
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-1', '88970000-0000-4000-8000-000000000071'::uuid, 'approved', '{}'::jsonb
   )),
  jsonb_build_object('ok', true, 'reason', 'already_applied'),
  'cas 11 : webhook dupliqué sur un paiement déjà approved → no-op idempotent'
);

-- Cas 12 : external_reference inconnue → payment_not_found.
select is(
  (select apply_payment_webhook(
     'mp-x', '00000000-0000-4000-8000-000000000099'::uuid, 'approved', '{}'::jsonb
   ) ->> 'reason'),
  'payment_not_found',
  'cas 12 : external_reference inconnue → payment_not_found'
);

-- Cas 13 : webhook rejected sur un paiement encore pending → orders.payment_status repasse unpaid.
select is(
  (select apply_payment_webhook(
     'mp-2', '88970000-0000-4000-8000-000000000072'::uuid, 'rejected', '{}'::jsonb
   ) ->> 'ok'),
  'true',
  'cas 13a : webhook rejected → ok:true'
);
select is(
  (select payment_status from orders where id = '88970000-0000-4000-8000-000000000045'),
  'unpaid',
  'cas 13b : orders.payment_status repasse à unpaid après rejet'
);

-- Cas 14 : statut Mercado Pago inconnu → exception.
select throws_ok(
  $$ select apply_payment_webhook(
       'mp-3', '88970000-0000-4000-8000-000000000072'::uuid, 'bogus_status', '{}'::jsonb
     ) $$,
  'P0001'::char(5),
  null,
  'cas 14 : statut Mercado Pago inconnu → exception'
);
reset role;

------------------------------------------------------------------------------------------------
-- apply_payment_webhook — durcissement 20260920120000 (incident HFG-000013 du 2026-09-20) :
-- garde « rien à honorer », double paiement, idempotence de l'entrée, clôture des autres
-- paiements de la commande. Chaque cas ci-dessous correspond à un état RÉELLEMENT observé ou
-- reproductible en préprod, jamais à une hypothèse. Vérifiés par mutation le 2026-09-20 (journal).
------------------------------------------------------------------------------------------------

-- Order K : le cron d'expiration est passé — ligne `expired`, paiement `cancelled`, commande
-- `unpaid`. C'est l'état exact de HFG-000013 au moment où Mercado Pago aurait retenté l'`approved`.
insert into orders (id, account_id, holder_name, holder_email, payment_status)
values ('88970000-0000-4000-8000-0000000000a1', '88970000-0000-4000-8000-000000000032',
        'Holder Paid After Expiry', 'paid-after-expiry@test.local', 'unpaid');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-0000000000b1', '88970000-0000-4000-8000-0000000000a1',
  '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
  '2028-12-20', 1, 'expired', 'Holder Paid After Expiry', 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);
insert into payments (id, order_id, status, amount_cop)
values ('88970000-0000-4000-8000-0000000000c1', '88970000-0000-4000-8000-0000000000a1', 'cancelled', 17000);

-- Order L : lignes passées `expired` par un opérateur (set_order_line_status) alors que le paiement
-- est encore `pending` — la garde ne dépend pas du statut du paiement, seulement des lignes.
insert into orders (id, account_id, holder_name, holder_email, payment_status)
values ('88970000-0000-4000-8000-0000000000a2', '88970000-0000-4000-8000-000000000032',
        'Holder Expired Lines Pending', 'expired-lines@test.local', 'pending');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-0000000000b2', '88970000-0000-4000-8000-0000000000a2',
  '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
  '2028-12-21', 1, 'expired', 'Holder Expired Lines Pending', 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);
insert into payments (id, order_id, status, amount_cop)
values ('88970000-0000-4000-8000-0000000000c2', '88970000-0000-4000-8000-0000000000a2', 'pending', 17000);

-- Order M : le client a annulé toutes ses prestations (cancel_order_line) AVANT que l'acompte ne
-- soit encaissé — même garde, mais le motif doit dire « annulation client », pas « expiration ».
insert into orders (id, account_id, holder_name, holder_email, payment_status)
values ('88970000-0000-4000-8000-0000000000a3', '88970000-0000-4000-8000-000000000032',
        'Holder Cancelled Then Paid', 'cancelled-then-paid@test.local', 'pending');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-0000000000b3', '88970000-0000-4000-8000-0000000000a3',
  '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
  '2028-12-22', 1, 'cancelled_by_client', 'Holder Cancelled Then Paid', 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);
insert into payments (id, order_id, status, amount_cop)
values ('88970000-0000-4000-8000-0000000000c3', '88970000-0000-4000-8000-0000000000a3', 'pending', 17000);

-- Order N : prestation déjà `fulfilled` (réalisée avant que le webhook n'arrive — set_order_line_
-- status ne conditionne pas `fulfilled` au paiement). Aucune ligne `reserved`, et pourtant l'argent
-- est dû : la garde ne doit PAS se déclencher (attaque retenue de la revue adversariale).
insert into orders (id, account_id, holder_name, holder_email, payment_status)
values ('88970000-0000-4000-8000-0000000000a4', '88970000-0000-4000-8000-000000000032',
        'Holder Fulfilled Late Webhook', 'fulfilled-late@test.local', 'pending');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-0000000000b4', '88970000-0000-4000-8000-0000000000a4',
  '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
  '2028-12-23', 1, 'fulfilled', 'Holder Fulfilled Late Webhook', 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);
insert into payments (id, order_id, status, amount_cop)
values ('88970000-0000-4000-8000-0000000000c4', '88970000-0000-4000-8000-0000000000a4', 'pending', 17000);

-- Order O : carte refusée (P1 `rejected`), nouvel intent (P2 `pending`). P2 est payé ; puis Mercado
-- Pago livre un `approved` sur P1 (retentative dans la même session Checkout Pro, même
-- external_reference) — c'est le double paiement inter-external_reference.
insert into orders (id, account_id, holder_name, holder_email, payment_status)
values ('88970000-0000-4000-8000-0000000000a5', '88970000-0000-4000-8000-000000000032',
        'Holder Double Payment', 'double-payment@test.local', 'pending');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-0000000000b5', '88970000-0000-4000-8000-0000000000a5',
  '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
  '2028-12-24', 1, 'reserved', 'Holder Double Payment', 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);
insert into payments (id, order_id, status, amount_cop)
values
  ('88970000-0000-4000-8000-0000000000c5', '88970000-0000-4000-8000-0000000000a5', 'rejected', 17000),
  ('88970000-0000-4000-8000-0000000000c6', '88970000-0000-4000-8000-0000000000a5', 'pending', 17000);

-- Order P : P1 `rejected`, P2 `pending` — un `rejected` EN RETARD sur P1 ne doit pas rétrograder la
-- commande à `unpaid` pendant que P2 est en cours.
insert into orders (id, account_id, holder_name, holder_email, payment_status)
values ('88970000-0000-4000-8000-0000000000a6', '88970000-0000-4000-8000-000000000032',
        'Holder Late Rejected', 'late-rejected@test.local', 'pending');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-0000000000b6', '88970000-0000-4000-8000-0000000000a6',
  '88970000-0000-4000-8000-000000000032', '88970000-0000-4000-8000-000000000021',
  '2028-12-25', 1, 'reserved', 'Holder Late Rejected', 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);
insert into payments (id, order_id, status, amount_cop)
values
  ('88970000-0000-4000-8000-0000000000c7', '88970000-0000-4000-8000-0000000000a6', 'rejected', 17000),
  ('88970000-0000-4000-8000-0000000000c8', '88970000-0000-4000-8000-0000000000a6', 'pending', 17000);

-- Cas 28 : Order K — `approved` sur un paiement `cancelled` par le cron → refusé, rien ne bouge,
-- une entrée refund_required, aucun e-mail client. LE POINT DU LOT.
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-k1', '88970000-0000-4000-8000-0000000000c1'::uuid, 'approved',
     jsonb_build_object('id', 'mp-k1', 'status', 'approved')
   )),
  jsonb_build_object('ok', true, 'reason', 'paid_after_expiry'),
  'cas 28a : approved sur un paiement cancelled → ok:true, reason paid_after_expiry (200, pas de retry MP)'
);
reset role;
select is(
  (select status::text from payments where id = '88970000-0000-4000-8000-0000000000c1'),
  'cancelled',
  'cas 28b : payments.status reste cancelled — jamais réécrit approved'
);
select is(
  (select payment_status from orders where id = '88970000-0000-4000-8000-0000000000a1'),
  'unpaid',
  'cas 28c : orders.payment_status reste unpaid — pas de commande fantôme'
);
select is(
  (select count(*)::int from notification_emails
    where event_type = 'client_order_confirmed'
      and related_id = '88970000-0000-4000-8000-0000000000a1'),
  0,
  'cas 28d : aucun e-mail « reserva confirmada » pour une commande expirée'
);
select is(
  (select count(*)::int from payment_reconciliation_entries
    where payment_id = '88970000-0000-4000-8000-0000000000c1' and kind = 'refund_required'),
  1,
  'cas 28e : une entrée de réconciliation kind=refund_required est créée'
);
select is(
  (select failure_reason from payment_reconciliation_entries
    where payment_id = '88970000-0000-4000-8000-0000000000c1' and kind = 'refund_required'),
  'paiement approuvé après expiration de la commande',
  'cas 28f : le motif est dérivé du statut réel des lignes (expired)'
);
select is(
  (select mp_payment_id from payments where id = '88970000-0000-4000-8000-0000000000c1'),
  'mp-k1',
  'cas 28g : mp_payment_id conservé sur le paiement (de quoi rembourser plus tard)'
);

-- Cas 29 : REJEU de la même livraison (Mercado Pago livre created puis updated, puis retente) →
-- toujours refusé, toujours UNE entrée, UNE seule salve d'e-mails admin.
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-k1', '88970000-0000-4000-8000-0000000000c1'::uuid, 'approved',
     jsonb_build_object('id', 'mp-k1', 'status', 'approved', 'replay', true)
   ) ->> 'reason'),
  'paid_after_expiry',
  'cas 29a : rejeu de la même livraison → même refus, idempotent'
);
reset role;
select is(
  (select count(*)::int from payment_reconciliation_entries
    where mp_payment_id = 'mp-k1' and kind = 'refund_required'),
  1,
  'cas 29b : toujours une seule entrée refund_required pour ce paiement MP (index unique partiel)'
);
select is(
  (select count(*)::int from notification_emails ne
    where ne.event_type = 'admin_new_reconciliation_exception'
      and ne.related_table = 'payment_reconciliation_entries'
      and ne.related_id = (select id from payment_reconciliation_entries
                            where mp_payment_id = 'mp-k1' and kind = 'refund_required')),
  (select count(*)::int from partner_capabilities where role = 'admin' and status = 'active'),
  'cas 29c : une seule salve d''e-mails admin (un par admin actif), pas une par livraison'
);

-- Cas 30 : Order L — paiement encore `pending`, lignes déjà `expired` → même garde.
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-l1', '88970000-0000-4000-8000-0000000000c2'::uuid, 'approved', '{}'::jsonb
   ) ->> 'reason'),
  'paid_after_expiry',
  'cas 30a : approved sur un paiement pending dont les lignes sont expired → refusé'
);
reset role;
select is(
  (select status::text from payments where id = '88970000-0000-4000-8000-0000000000c2'),
  'pending',
  'cas 30b : le statut du paiement n''est pas touché par la garde'
);

-- Cas 31 : Order M — lignes annulées par le client → refusé, motif « annulation client ».
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-m1', '88970000-0000-4000-8000-0000000000c3'::uuid, 'approved', '{}'::jsonb
   ) ->> 'reason'),
  'paid_after_expiry',
  'cas 31a : approved sur une commande entièrement annulée par le client → refusé'
);
reset role;
select is(
  (select failure_reason from payment_reconciliation_entries where mp_payment_id = 'mp-m1'),
  'paiement approuvé après annulation par le client',
  'cas 31b : le motif dit « annulation client », pas « expiration »'
);

-- Cas 32 : Order N — ligne `fulfilled`, aucune `reserved` → HONORABLE, le paiement s'applique.
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-n1', '88970000-0000-4000-8000-0000000000c4'::uuid, 'approved', '{}'::jsonb
   )),
  jsonb_build_object('ok', true),
  'cas 32a : approved sur une prestation déjà réalisée → appliqué normalement (pas de garde)'
);
reset role;
select is(
  (select payment_status from orders where id = '88970000-0000-4000-8000-0000000000a4'),
  'paid',
  'cas 32b : la commande passe paid'
);
select is(
  (select count(*)::int from payment_reconciliation_entries where mp_payment_id = 'mp-n1'),
  0,
  'cas 32c : aucune entrée de réconciliation pour un paiement légitime'
);

-- Cas 33 : Order O — P2 (pending) approuvé → commande payée, P1 (rejected) clôturé en cancelled.
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-o2', '88970000-0000-4000-8000-0000000000c6'::uuid, 'approved', '{}'::jsonb
   ) ->> 'ok'),
  'true',
  'cas 33a : approved sur P2 → ok'
);
reset role;
select is(
  (select payment_status from orders where id = '88970000-0000-4000-8000-0000000000a5'),
  'paid',
  'cas 33b : commande payée par P2'
);
select is(
  (select status::text from payments where id = '88970000-0000-4000-8000-0000000000c5'),
  'cancelled',
  'cas 33c : P1 (rejected) est clôturé en cancelled par l''approbation de P2'
);
select is(
  (select count(*)::int from notification_emails
    where event_type = 'client_order_confirmed'
      and related_id = '88970000-0000-4000-8000-0000000000a5'),
  1,
  'cas 33d : un seul e-mail de confirmation client'
);

-- Cas 34 : puis `approved` sur P1 (retentative Mercado Pago dans la même session) → DOUBLE
-- PAIEMENT : refusé, entrée refund_required, commande inchangée, pas de second e-mail.
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-o1b', '88970000-0000-4000-8000-0000000000c5'::uuid, 'approved', '{}'::jsonb
   )),
  jsonb_build_object('ok', true, 'reason', 'double_payment'),
  'cas 34a : approved sur P1 alors que P2 a payé → double_payment'
);
reset role;
select is(
  (select payment_status from orders where id = '88970000-0000-4000-8000-0000000000a5'),
  'paid',
  'cas 34b : la commande reste paid (une seule fois)'
);
select is(
  (select failure_reason from payment_reconciliation_entries
    where mp_payment_id = 'mp-o1b' and kind = 'refund_required'),
  'double paiement : la commande est déjà payée par le paiement 88970000-0000-4000-8000-0000000000c6',
  'cas 34c : entrée refund_required « double paiement » nommant le paiement qui a réglé la commande'
);
select is(
  (select count(*)::int from notification_emails
    where event_type = 'client_order_confirmed'
      and related_id = '88970000-0000-4000-8000-0000000000a5'),
  1,
  'cas 34d : toujours un seul e-mail de confirmation client (pas de second envoi)'
);
select is(
  (select status::text from payments where id = '88970000-0000-4000-8000-0000000000c5'),
  'cancelled',
  'cas 34e : P1 reste cancelled, jamais approved'
);

-- Cas 35 : Order K — un `pending` (PSE tardif) sur un paiement cancelled → no-op.
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-k1', '88970000-0000-4000-8000-0000000000c1'::uuid, 'pending', '{}'::jsonb
   )),
  jsonb_build_object('ok', true, 'reason', 'already_cancelled'),
  'cas 35a : pending sur un paiement cancelled → already_cancelled, no-op'
);
reset role;
select is(
  (select status::text from payments where id = '88970000-0000-4000-8000-0000000000c1'),
  'cancelled',
  'cas 35b : le paiement reste cancelled — une commande morte ne ressuscite pas'
);

-- Cas 36 : Order P — `rejected` en retard sur P1 pendant que P2 est pending → la commande reste
-- pending (jamais rétrogradée à unpaid tant qu'un autre paiement la porte).
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-p1', '88970000-0000-4000-8000-0000000000c7'::uuid, 'rejected', '{}'::jsonb
   ) ->> 'ok'),
  'true',
  'cas 36a : rejected en retard sur P1 → ok'
);
reset role;
select is(
  (select payment_status from orders where id = '88970000-0000-4000-8000-0000000000a6'),
  'pending',
  'cas 36b : orders.payment_status reste pending — P2 est encore en cours'
);

------------------------------------------------------------------------------------------------
-- expire_stale_payment_orders — SUPPRIMÉE le 2026-09-21 (20260921100100, spec 39 D1) : l'expiration
-- est désormais décidée par expire_payment_order, appelée par le job de réconciliation après avoir
-- interrogé Mercado Pago. Ses cas F-J (référent voidé, impayée sans intent, fenêtre de grâce, déjà
-- payée, walk-in) vivent dans payments_reconcile.test.sql (B6, B11, B7, C4, C5).
------------------------------------------------------------------------------------------------

------------------------------------------------------------------------------------------------
-- payment_reconciliation_entries / resolve_payment_reconciliation_entry
------------------------------------------------------------------------------------------------

insert into payment_reconciliation_entries (id, payment_id, mp_payment_id, external_reference, raw_event, failure_reason, status)
values
  ('88970000-0000-4000-8000-000000000101', '88970000-0000-4000-8000-000000000072', 'mp-2',
   '88970000-0000-4000-8000-000000000072', '{}'::jsonb, 'signature HMAC invalide', 'open'),
  ('88970000-0000-4000-8000-000000000102', null, 'mp-9', null, '{}'::jsonb,
   'external_reference introuvable', 'resolved');

-- Cas 19 : non-admin → 42501.
set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000032'); -- buyer
select throws_ok(
  $$ select resolve_payment_reconciliation_entry(
       '88970000-0000-4000-8000-000000000101', 'Tentativa no admin'
     ) $$,
  '42501'::char(5),
  'resolve_payment_reconciliation_entry réservé au rôle admin',
  'cas 19 : appel non-admin → exception 42501'
);

select test_logout();
select test_login('88970000-0000-4000-8000-000000000031'); -- admin pour le reste des cas

-- Cas 20 : motif vide → exception.
select throws_ok(
  $$ select resolve_payment_reconciliation_entry('88970000-0000-4000-8000-000000000101', '') $$,
  'P0001'::char(5),
  'motif obligatoire pour résoudre une entrée',
  'cas 20 : motif vide → exception'
);

-- Cas 21 : entrée introuvable → exception.
select throws_ok(
  $$ select resolve_payment_reconciliation_entry('00000000-0000-4000-8000-000000000099', 'Motivo válido') $$,
  'P0001'::char(5),
  'entrée introuvable',
  'cas 21 : entrée inexistante → exception'
);

-- Cas 22 : admin résout l'entrée open.
select is(
  (select resolve_payment_reconciliation_entry(
     '88970000-0000-4000-8000-000000000101', 'Webhook rejoué manuellement, signature corrigée côté MP'
   ) ->> 'ok'),
  'true',
  'cas 22a : admin résout l''entrée open → ok:true'
);
select is(
  (select status from payment_reconciliation_entries where id = '88970000-0000-4000-8000-000000000101'),
  'resolved',
  'cas 22b : statut passe à resolved'
);

-- Cas 23 : entrée déjà résolue → exception.
select throws_ok(
  $$ select resolve_payment_reconciliation_entry('88970000-0000-4000-8000-000000000102', 'Motivo válido') $$,
  'P0001'::char(5),
  'entrée déjà traitée (statut resolved)',
  'cas 23 : entrée déjà résolue → exception'
);

-- Cas 24 : RLS — admin voit les 2 entrées de ce fichier.
select is(
  (select count(*)::int from payment_reconciliation_entries
    where id in ('88970000-0000-4000-8000-000000000101', '88970000-0000-4000-8000-000000000102')),
  2,
  'cas 24 : admin voit les 2 entrées de réconciliation'
);

-- Cas 25 : RLS — buyer (non-admin) ne voit aucune entrée.
select test_logout();
select test_login('88970000-0000-4000-8000-000000000032');
select is(
  (select count(*)::int from payment_reconciliation_entries),
  0,
  'cas 25 : buyer (non-admin) → aucune entrée de réconciliation visible'
);

------------------------------------------------------------------------------------------------
-- payments — RLS admin-only
------------------------------------------------------------------------------------------------

-- Cas 26 : RLS — buyer (propriétaire des commandes elles-mêmes) ne voit AUCUN payments en direct
-- (le statut de paiement passe par le Route Handler service_role, jamais une lecture RLS directe).
select is(
  (select count(*)::int from payments),
  0,
  'cas 26 : buyer ne voit aucun payments en lecture directe, même sur ses propres commandes'
);

select test_logout();
select test_login('88970000-0000-4000-8000-000000000031'); -- admin
select is(
  (select count(*)::int from payments) >= 4,
  true,
  'cas 27 : admin voit les payments (au moins les 4 de ce fichier)'
);
select test_logout();


------------------------------------------------------------------------------------------------
-- Lobby avant paiement (migration 20260930221837)
------------------------------------------------------------------------------------------------
-- I2 : aucun paiement tant qu'une nuit PMS-backed n'a pas son booking Lobby ; un logement local ou
-- une activité liée à Lobby sans booking ne bloquent pas. Montant changé entre deux intents →
-- l'ancien est annulé. Un seul `pending` par commande : le `for update` sur orders sérialise les
-- appels, et l'index payments_one_pending_per_order le garantit en base depuis la migration
-- 20261002185102, avec la garde du webhook (cf. cas 44).
reset role;
insert into products (
  id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id, lobby_product_id
) values
  ('88970000-0000-4000-8000-000000000221', '88970000-0000-4000-8000-000000000001',
   '88970000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Payments PMS'),
   100000, true, 'payments-pms', 9801, null),
  ('88970000-0000-4000-8000-000000000222', '88970000-0000-4000-8000-000000000001',
   '88970000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Payments Local'),
   100000, true, 'payments-local', null, null),
  ('88970000-0000-4000-8000-000000000223', '88970000-0000-4000-8000-000000000001',
   '88970000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Payments Actividad Lobby'),
   50000, true, 'payments-activity-lobby', null, 9802);
insert into orders (id, account_id, holder_name, holder_email) values
  ('88970000-0000-4000-8000-000000000241', '88970000-0000-4000-8000-000000000032', 'Holder PMS', 'pms-payments@test.local'),
  ('88970000-0000-4000-8000-000000000242', '88970000-0000-4000-8000-000000000032', 'Holder Local', 'local-payments@test.local'),
  ('88970000-0000-4000-8000-000000000243', '88970000-0000-4000-8000-000000000032', 'Holder Lobby Act', 'act-payments@test.local'),
  ('88970000-0000-4000-8000-000000000244', '88970000-0000-4000-8000-000000000032', 'Holder Montant', 'amount-payments@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
)
select l.id::uuid, l.order_id::uuid, '88970000-0000-4000-8000-000000000032', l.product_id::uuid,
       l.date::date, l.end_date::date, 1, 'reserved', 'Holder Payments',
       100000, 100000, 'direct', 0.1, 0, 0.1, 10000, 0, 10000
  from (values
    ('88970000-0000-4000-8000-000000000251', '88970000-0000-4000-8000-000000000241', '88970000-0000-4000-8000-000000000221', '2029-02-01', '2029-02-03'),
    ('88970000-0000-4000-8000-000000000252', '88970000-0000-4000-8000-000000000242', '88970000-0000-4000-8000-000000000222', '2029-02-01', '2029-02-03'),
    ('88970000-0000-4000-8000-000000000253', '88970000-0000-4000-8000-000000000243', '88970000-0000-4000-8000-000000000223', '2029-02-01', null),
    ('88970000-0000-4000-8000-000000000254', '88970000-0000-4000-8000-000000000244', '88970000-0000-4000-8000-000000000021', '2029-02-01', null),
    ('88970000-0000-4000-8000-000000000255', '88970000-0000-4000-8000-000000000244', '88970000-0000-4000-8000-000000000021', '2029-02-02', null)
  ) as l(id, order_id, product_id, date, end_date);

set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000032'); -- buyer
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000241') ->> 'reason'),
  'pms_booking_missing',
  'cas 40a : nuit PMS-backed sans booking Lobby → pms_booking_missing (I2)'
);
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000242') ->> 'ok'),
  'true',
  'cas 41 : logement NON PMS sans booking → payable (rien à réserver chez Lobby)'
);
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000243') ->> 'ok'),
  'true',
  'cas 42 : activité liée à Lobby sans booking → payable (Lobby refuse une vente de service isolée)'
);
create temp table intent_montant_1 as
  select create_payment_intent('88970000-0000-4000-8000-000000000244') as r;
reset role;
select is(
  (select count(*)::int from payments where order_id = '88970000-0000-4000-8000-000000000241'),
  0,
  'cas 40b : pms_booking_missing → aucun payments créé'
);
-- Une ligne de 244 est annulée entre deux clics : le montant passe de 20000 à 10000.
update order_lines set status = 'cancelled_by_client' where id = '88970000-0000-4000-8000-000000000255';
set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000032');
create temp table intent_montant_2 as
  select create_payment_intent('88970000-0000-4000-8000-000000000244') as r;
reset role;
select is(
  (select jsonb_build_object(
     'premier', (select r->'amount_cop' from intent_montant_1),
     'second', (select r->'amount_cop' from intent_montant_2),
     'nouveau_paiement', (select r->>'payment_id' from intent_montant_2) <> (select r->>'payment_id' from intent_montant_1),
     'ancien', (select status from payments where id = (select (r->>'payment_id')::uuid from intent_montant_1)),
     'pendings', (select count(*) from payments where order_id = '88970000-0000-4000-8000-000000000244' and status = 'pending'))),
  jsonb_build_object('premier', 20000, 'second', 10000, 'nouveau_paiement', true, 'ancien', 'cancelled', 'pendings', 1),
  'cas 43 : montant changé entre deux intents → ancien payment annulé, nouveau créé, un seul pending'
);

-- Cas 44 (migration 20261002185102) : un paiement `rejected` qui redevient `pending` par une
-- retentative dans l'ancienne session Checkout Pro, pendant qu'un nouvel intent est déjà `pending`,
-- n'est PAS rétrogradé : la garde other_intent_pending répond ok (Mercado Pago ne retente pas), et
-- l'index payments_one_pending_per_order n'est jamais heurté. Avant cette garde, l'index était
-- retiré (P4a) parce que ce chemin finissait en 23505.
insert into orders (id, account_id, holder_name, holder_email, payment_status) values
  ('88970000-0000-4000-8000-000000000246', '88970000-0000-4000-8000-000000000032', 'Holder Retry', 'retry-payments@test.local', 'pending');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-000000000257', '88970000-0000-4000-8000-000000000246', '88970000-0000-4000-8000-000000000032',
  '88970000-0000-4000-8000-000000000021', '2029-03-10', 1, 'reserved', 'Holder Retry',
  100000, 100000, 'direct', 0.1, 0, 0.1, 10000, 0, 10000
);
insert into payments (id, order_id, amount_cop, payer_email, status) values
  ('88970000-0000-4000-8000-000000000266', '88970000-0000-4000-8000-000000000246', 10000, 'retry-payments@test.local', 'rejected'),
  ('88970000-0000-4000-8000-000000000267', '88970000-0000-4000-8000-000000000246', 10000, 'retry-payments@test.local', 'pending');
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-retry-1', '88970000-0000-4000-8000-000000000266'::uuid, 'pending',
     jsonb_build_object('id', 'mp-retry-1', 'status', 'in_process')
   )),
  jsonb_build_object('ok', true, 'reason', 'other_intent_pending'),
  'cas 44 : rejected → pending pendant qu''un autre pending existe → ok, other_intent_pending, aucune 23505'
);
reset role;
select is(
  (select jsonb_build_object(
     'ancien', (select status from payments where id = '88970000-0000-4000-8000-000000000266'),
     'pendings', (select count(*) from payments where order_id = '88970000-0000-4000-8000-000000000246' and status = 'pending'))),
  jsonb_build_object('ancien', 'rejected', 'pendings', 1),
  'cas 44a : l''ancien intent reste rejected, un seul pending'
);
set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000032');
select is(
  (select (r ->> 'ok') || '/' || (r ->> 'reused') || '/' || (r ->> 'payment_id')
     from (select create_payment_intent('88970000-0000-4000-8000-000000000246') as r) x),
  'true/true/88970000-0000-4000-8000-000000000267',
  'cas 44b : create_payment_intent réutilise le pending courant, sans erreur'
);
reset role;

-- Cas 45 (revue adversariale) : un pending existe déjà ET une nuit PMS n'a pas son booking → le
-- refus pms_booking_missing passe AVANT la réutilisation : jamais un `reused` sans booking.
reset role;
insert into orders (id, account_id, holder_name, holder_email, payment_status) values
  ('88970000-0000-4000-8000-000000000245', '88970000-0000-4000-8000-000000000032', 'Holder PMS Pending', 'pms-pending@test.local', 'pending');
insert into order_lines (
  id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-000000000256', '88970000-0000-4000-8000-000000000245', '88970000-0000-4000-8000-000000000032',
  '88970000-0000-4000-8000-000000000221', '2029-03-01', '2029-03-03', 1, 'reserved', 'Holder PMS Pending',
  100000, 100000, 'direct', 0.1, 0, 0.1, 10000, 0, 10000
);
insert into payments (id, order_id, amount_cop, payer_email, status) values
  ('88970000-0000-4000-8000-000000000265', '88970000-0000-4000-8000-000000000245', 10000, 'pms-pending@test.local', 'pending');
set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000032');
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000245') ->> 'reason'),
  'pms_booking_missing',
  'cas 45 : pending existant + nuit PMS sans booking → pms_booking_missing, jamais reused'
);
reset role;
select is(
  (select status from payments where id = '88970000-0000-4000-8000-000000000265'),
  'pending',
  'cas 45b : le pending existant n''est pas touché par le refus'
);

------------------------------------------------------------------------------------------------
-- Échéance de paiement (migration 20261001194704)
------------------------------------------------------------------------------------------------
-- create_payment_intent refuse `order_expiring` dès created_at + 28 min (order_payment_deadline)
-- MOINS 30 s (marge, migration 20261002185102 : payments/create revérifie la limite juste après),
-- avant tout `payments`, avant `pms_booking_missing` et avant la réutilisation d'un pending.
-- `now()` est constant dans la transaction : on VIEILLIT LA DONNÉE, jamais l'horloge.
reset role;
select test_logout();
insert into orders (id, account_id, holder_name, holder_email, payment_status, created_at) values
  ('88970000-0000-4000-8000-000000000e01', '88970000-0000-4000-8000-000000000032', 'Holder Echeance 1', 'deadline-1@test.local', 'unpaid', now() - interval '27 minutes 29 seconds'),
  ('88970000-0000-4000-8000-000000000e02', '88970000-0000-4000-8000-000000000032', 'Holder Echeance 2', 'deadline-2@test.local', 'unpaid', now() - interval '27 minutes 30 seconds'),
  ('88970000-0000-4000-8000-000000000e03', '88970000-0000-4000-8000-000000000032', 'Holder Echeance 3', 'deadline-3@test.local', 'unpaid', now() - interval '27 minutes 31 seconds'),
  ('88970000-0000-4000-8000-000000000e04', '88970000-0000-4000-8000-000000000032', 'Holder Echeance 4', 'deadline-4@test.local', 'unpaid', now() - interval '28 minutes'),
  ('88970000-0000-4000-8000-000000000e05', '88970000-0000-4000-8000-000000000032', 'Holder Echeance 5', 'deadline-5@test.local', 'pending', now() - interval '28 minutes'),
  ('88970000-0000-4000-8000-000000000e06', '88970000-0000-4000-8000-000000000032', 'Holder Echeance 6', 'deadline-6@test.local', 'paid', now() - interval '40 minutes'),
  ('88970000-0000-4000-8000-000000000e07', '88970000-0000-4000-8000-000000000032', 'Holder Echeance 7', 'deadline-7@test.local', 'unpaid', now() - interval '40 minutes'),
  ('88970000-0000-4000-8000-000000000e08', '88970000-0000-4000-8000-000000000032', 'Holder Echeance 8', 'deadline-8@test.local', 'unpaid', now() - interval '29 minutes');
insert into order_lines (
  id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
)
select l.id::uuid, l.order_id::uuid, '88970000-0000-4000-8000-000000000032', l.product_id::uuid,
       l.date::date, l.end_date::date, 1, 'reserved', 'Holder Payments',
       100000, 100000, 'direct', 0.1, 0, 0.1, 10000, 0, 10000
  from (values
    -- e01 à e03, e05, e06 : un logement local ; e04 : une nuit PMS-backed SANS booking.
    ('88970000-0000-4000-8000-000000000e11', '88970000-0000-4000-8000-000000000e01', '88970000-0000-4000-8000-000000000222', '2029-03-01', '2029-03-02'),
    ('88970000-0000-4000-8000-000000000e12', '88970000-0000-4000-8000-000000000e02', '88970000-0000-4000-8000-000000000222', '2029-03-03', '2029-03-04'),
    ('88970000-0000-4000-8000-000000000e13', '88970000-0000-4000-8000-000000000e03', '88970000-0000-4000-8000-000000000222', '2029-03-05', '2029-03-06'),
    ('88970000-0000-4000-8000-000000000e14', '88970000-0000-4000-8000-000000000e04', '88970000-0000-4000-8000-000000000221', '2029-03-07', '2029-03-08'),
    ('88970000-0000-4000-8000-000000000e15', '88970000-0000-4000-8000-000000000e05', '88970000-0000-4000-8000-000000000222', '2029-03-09', '2029-03-10'),
    ('88970000-0000-4000-8000-000000000e16', '88970000-0000-4000-8000-000000000e06', '88970000-0000-4000-8000-000000000222', '2029-03-11', '2029-03-12'),
    ('88970000-0000-4000-8000-000000000e17', '88970000-0000-4000-8000-000000000e07', '88970000-0000-4000-8000-000000000222', '2029-03-13', '2029-03-14'),
    ('88970000-0000-4000-8000-000000000e18', '88970000-0000-4000-8000-000000000e08', '88970000-0000-4000-8000-000000000222', '2029-03-15', '2029-03-16')
  ) as l(id, order_id, product_id, date, end_date);
-- e07 : déjà expirée (aucune ligne vivante) et vieille.
update order_lines set status = 'expired' where id = '88970000-0000-4000-8000-000000000e17';
-- e05 : un pending au même montant, qui serait réutilisé sans l'échéance ; e06 : déjà payée.
insert into payments (id, order_id, status, amount_cop) values
  ('88970000-0000-4000-8000-000000000e21', '88970000-0000-4000-8000-000000000e05', 'pending', 10000),
  ('88970000-0000-4000-8000-000000000e22', '88970000-0000-4000-8000-000000000e06', 'approved', 10000);

set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000032');
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000e01') ->> 'ok'),
  'true',
  'cas 46a : commande de 27 min 29 s → intent accepté'
);
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000e02') ->> 'reason'),
  'order_expiring',
  'cas 46b : commande de 27 min 30 s pile → order_expiring (limite de payments/create moins la marge de 30 s)'
);
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000e03') ->> 'reason'),
  'order_expiring',
  'cas 46c : commande de 27 min 31 s → order_expiring'
);
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000e04') ->> 'reason'),
  'order_expiring',
  'cas 46d : nuit PMS sans booking ET 28 min → order_expiring avant pms_booking_missing (Lobby jamais rappelé)'
);
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000e05') ->> 'reason'),
  'order_expiring',
  'cas 46e : pending au même montant ET 28 min → order_expiring, jamais reused'
);
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000e06') ->> 'reason'),
  'already_paid',
  'cas 46f : commande payée ET vieille → already_paid d''abord'
);
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000e07') ->> 'reason'),
  'nothing_to_pay',
  'cas 46j : commande déjà expirée ET vieille → nothing_to_pay, comme avant (l''écran relu dit « expirée »)'
);
-- Cas 46k-l : à 29 min, la commande n'est plus payable mais pas encore expirable — la limite de
-- paiement (28 min) précède l'expiration (30 min), écart que scripts/check-payment-deadline.sh
-- verrouille sur les littéraux.
select is(
  (select create_payment_intent('88970000-0000-4000-8000-000000000e08') ->> 'reason'),
  'order_expiring',
  'cas 46k : commande de 29 min → plus payable (order_expiring)'
);
reset role;
select is(
  (select expire_payment_order('88970000-0000-4000-8000-000000000e08', now()) ->> 'reason'),
  'not_candidate',
  'cas 46l : commande de 29 min → pas encore expirable (not_candidate) : la limite précède l''expiration'
);
select test_logout();
select is(
  (select count(*)::int from payments where order_id in ('88970000-0000-4000-8000-000000000e02', '88970000-0000-4000-8000-000000000e03', '88970000-0000-4000-8000-000000000e04')),
  0,
  'cas 46g : order_expiring → aucun payments créé'
);
select is(
  (select count(*)::int from orders where id in ('88970000-0000-4000-8000-000000000e02', '88970000-0000-4000-8000-000000000e03', '88970000-0000-4000-8000-000000000e04') and payment_status <> 'unpaid'),
  0,
  'cas 46h : order_expiring → payment_status intact (jamais « confirmando » sur une commande condamnée)'
);
select is(
  (select status from payments where id = '88970000-0000-4000-8000-000000000e21'),
  'pending',
  'cas 46i : le pending existant n''est pas touché par le refus'
);

select * from finish();
rollback;
