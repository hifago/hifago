-- Gardes d'apply_payment_webhook (migration 20261002185102).
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - un `pending` reçu sur un paiement qui ne l'est plus, alors qu'un autre intent de la commande
--     est `pending`, ne le rétrograde pas (other_intent_pending) ; sans autre pending, il passe ;
--   - l'index payments_one_pending_per_order refuse un second pending ;
--   - I2 : un `approved` alors qu'une nuit PMS-backed `reserved` n'a pas de booking → rien
--     n'est appliqué, refund_required pms_booking_missing, texte client dédié ; un logement local
--     ou une nuit PMS AVEC booking s'appliquent ; la décision est définitive (le même paiement
--     rejoué après la pose du booking n'est jamais appliqué) ;
--   - un `approved` sur un intent remplacé (annulé, commande vivante, intent plus récent) →
--     refund_required superseded_intent, texte client dédié, valeurs échappées ; sans intent plus
--     récent, ou sans ligne à honorer → paid_after_expiry comme avant ;
--   - l'écran client (order_for_client_jsonb) dit « paiement reçu, non honoré » pour les deux codes.
-- Le webhook est appelé par apply_payment_webhook_checked (le point d'entrée de la route et du job),
-- sous le rôle service_role.
begin;
select plan(21);

insert into partners (id, display_name) values ('9a5d0000-0000-4000-8000-000000000001', 'Guards Partner');
insert into establishments (id, partner_id, name) values
  ('9a5d0000-0000-4000-8000-000000000002', '9a5d0000-0000-4000-8000-000000000001', jsonb_build_object('es', 'Guards'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
  ('9a5d0000-0000-4000-8000-000000000003', '9a5d0000-0000-4000-8000-000000000001', '9a5d0000-0000-4000-8000-000000000002',
   'activity', jsonb_build_object('es', 'Guards Actividad'), 100000, true, 'guards-activity', null),
  ('9a5d0000-0000-4000-8000-000000000004', '9a5d0000-0000-4000-8000-000000000001', '9a5d0000-0000-4000-8000-000000000002',
   'lodging', jsonb_build_object('es', 'Guards PMS'), 100000, true, 'guards-pms', 9901),
  ('9a5d0000-0000-4000-8000-000000000005', '9a5d0000-0000-4000-8000-000000000001', '9a5d0000-0000-4000-8000-000000000002',
   'lodging', jsonb_build_object('es', 'Guards Local'), 100000, true, 'guards-local', null);
insert into auth.users (id, email) values ('9a5d0000-0000-4000-8000-000000000010', 'guards-buyer@test.local');

-- Commandes : 21 garde, 22 retour à pending, 23 I2, 24 logement local, 25 PMS avec booking,
-- 26 intent remplacé (titulaire et référence piégés), 27 remplacé mais expiré, 28 annulé sans
-- intent plus récent.
insert into orders (id, account_id, holder_name, holder_email, payment_status, reference) values
  ('9a5d0000-0000-4000-8000-000000000021', '9a5d0000-0000-4000-8000-000000000010', 'Guards', 'guards-buyer@test.local', 'pending', 'GRD-21'),
  ('9a5d0000-0000-4000-8000-000000000022', '9a5d0000-0000-4000-8000-000000000010', 'Guards', 'guards-buyer@test.local', 'unpaid', 'GRD-22'),
  ('9a5d0000-0000-4000-8000-000000000023', '9a5d0000-0000-4000-8000-000000000010', 'Guards', 'guards-buyer@test.local', 'pending', 'GRD-23'),
  ('9a5d0000-0000-4000-8000-000000000024', '9a5d0000-0000-4000-8000-000000000010', 'Guards', 'guards-buyer@test.local', 'pending', 'GRD-24'),
  ('9a5d0000-0000-4000-8000-000000000025', '9a5d0000-0000-4000-8000-000000000010', 'Guards', 'guards-buyer@test.local', 'pending', 'GRD-25'),
  ('9a5d0000-0000-4000-8000-000000000026', '9a5d0000-0000-4000-8000-000000000010', '<b>H</b> & "s"', 'guards-buyer@test.local', 'pending', '<em>REF-S</em>'),
  ('9a5d0000-0000-4000-8000-000000000027', '9a5d0000-0000-4000-8000-000000000010', 'Guards', 'guards-buyer@test.local', 'unpaid', 'GRD-27'),
  ('9a5d0000-0000-4000-8000-000000000028', '9a5d0000-0000-4000-8000-000000000010', 'Guards', 'guards-buyer@test.local', 'unpaid', 'GRD-28');
insert into order_lines (
  id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop, pms_booking_id
)
select l.id::uuid, l.order_id::uuid, '9a5d0000-0000-4000-8000-000000000010', l.product_id::uuid,
       '2029-05-01', l.end_date::date, 1, l.status, 'Guards',
       100000, 100000, 'direct', 0.1, 0, 0.1, 10000, 0, 10000, l.booking
  from (values
    ('9a5d0000-0000-4000-8000-000000000051', '9a5d0000-0000-4000-8000-000000000021', '9a5d0000-0000-4000-8000-000000000003', null, 'reserved', null),
    ('9a5d0000-0000-4000-8000-000000000052', '9a5d0000-0000-4000-8000-000000000022', '9a5d0000-0000-4000-8000-000000000003', null, 'reserved', null),
    ('9a5d0000-0000-4000-8000-000000000053', '9a5d0000-0000-4000-8000-000000000023', '9a5d0000-0000-4000-8000-000000000004', '2029-05-02', 'reserved', null),
    ('9a5d0000-0000-4000-8000-000000000054', '9a5d0000-0000-4000-8000-000000000024', '9a5d0000-0000-4000-8000-000000000005', '2029-05-02', 'reserved', null),
    ('9a5d0000-0000-4000-8000-000000000055', '9a5d0000-0000-4000-8000-000000000025', '9a5d0000-0000-4000-8000-000000000004', '2029-05-02', 'reserved', 'lobby-guards-25'),
    ('9a5d0000-0000-4000-8000-000000000056', '9a5d0000-0000-4000-8000-000000000026', '9a5d0000-0000-4000-8000-000000000003', null, 'reserved', null),
    ('9a5d0000-0000-4000-8000-000000000057', '9a5d0000-0000-4000-8000-000000000027', '9a5d0000-0000-4000-8000-000000000003', null, 'expired', null),
    ('9a5d0000-0000-4000-8000-000000000058', '9a5d0000-0000-4000-8000-000000000028', '9a5d0000-0000-4000-8000-000000000003', null, 'reserved', null)
  ) as l(id, order_id, product_id, end_date, status, booking);
insert into payments (id, order_id, status, amount_cop, created_at) values
  ('9a5d0000-0000-4000-8000-000000000031', '9a5d0000-0000-4000-8000-000000000021', 'rejected', 10000, now() - interval '10 minutes'),
  ('9a5d0000-0000-4000-8000-000000000032', '9a5d0000-0000-4000-8000-000000000021', 'pending', 10000, now() - interval '5 minutes'),
  ('9a5d0000-0000-4000-8000-000000000033', '9a5d0000-0000-4000-8000-000000000022', 'rejected', 10000, now() - interval '10 minutes'),
  ('9a5d0000-0000-4000-8000-000000000034', '9a5d0000-0000-4000-8000-000000000023', 'pending', 10000, now() - interval '5 minutes'),
  ('9a5d0000-0000-4000-8000-000000000035', '9a5d0000-0000-4000-8000-000000000024', 'pending', 10000, now() - interval '5 minutes'),
  ('9a5d0000-0000-4000-8000-000000000036', '9a5d0000-0000-4000-8000-000000000025', 'pending', 10000, now() - interval '5 minutes'),
  -- 26 : l'intent à 20000 a été remplacé (montant changé) par celui à 10000.
  ('9a5d0000-0000-4000-8000-000000000037', '9a5d0000-0000-4000-8000-000000000026', 'cancelled', 20000, now() - interval '10 minutes'),
  ('9a5d0000-0000-4000-8000-000000000038', '9a5d0000-0000-4000-8000-000000000026', 'pending', 10000, now() - interval '5 minutes'),
  ('9a5d0000-0000-4000-8000-000000000039', '9a5d0000-0000-4000-8000-000000000027', 'cancelled', 20000, now() - interval '10 minutes'),
  ('9a5d0000-0000-4000-8000-000000000040', '9a5d0000-0000-4000-8000-000000000027', 'cancelled', 10000, now() - interval '5 minutes'),
  ('9a5d0000-0000-4000-8000-000000000041', '9a5d0000-0000-4000-8000-000000000028', 'cancelled', 10000, now() - interval '10 minutes');

create function test_webhook(p_mp text, p_payment uuid, p_status text, p_amount numeric) returns jsonb
language sql as $$
  select public.apply_payment_webhook_checked(p_mp, p_payment, p_status, p_amount,
    jsonb_build_object('mp_payment_id', p_mp, 'status', p_status, 'transaction_amount', p_amount))
$$;

-- ── Garde other_intent_pending et index ─────────────────────────────────
set local role service_role;
create temp table r_garde as
  select test_webhook('mp-grd-1', '9a5d0000-0000-4000-8000-000000000031', 'pending', null) as r;
create temp table r_retour as
  select test_webhook('mp-grd-2', '9a5d0000-0000-4000-8000-000000000033', 'pending', null) as r;
reset role;

select is((select r from r_garde), jsonb_build_object('ok', true, 'reason', 'other_intent_pending'),
  'G1 : pending sur un rejected pendant qu''un autre intent est pending → ok, other_intent_pending (MP ne retente pas)');
select is(
  (select jsonb_build_object(
     'p1', (select status from payments where id = '9a5d0000-0000-4000-8000-000000000031'),
     'pendings', (select count(*) from payments where order_id = '9a5d0000-0000-4000-8000-000000000021' and status = 'pending'))),
  jsonb_build_object('p1', 'rejected', 'pendings', 1),
  'G1b : l''ancien intent reste rejected, un seul pending');
select is(
  (select jsonb_build_object('r', (select r from r_retour),
     'p1', (select status from payments where id = '9a5d0000-0000-4000-8000-000000000033'))),
  jsonb_build_object('r', jsonb_build_object('ok', true), 'p1', 'pending'),
  'G2 : sans autre pending, un rejected redevient pending (retentative légitime)');
select throws_ok(
  $$ insert into payments (order_id, status, amount_cop) values ('9a5d0000-0000-4000-8000-000000000022', 'pending', 10000) $$,
  '23505', null,
  'G3 : l''index payments_one_pending_per_order refuse un second pending pour une commande');

-- ── I2 : nuit PMS sans booking ───────────────────────────────────────────
set local role service_role;
create temp table r_i2 as select test_webhook('mp-grd-3', '9a5d0000-0000-4000-8000-000000000034', 'approved', 10000) as r;
create temp table r_local as select test_webhook('mp-grd-4', '9a5d0000-0000-4000-8000-000000000035', 'approved', 10000) as r;
create temp table r_booke as select test_webhook('mp-grd-5', '9a5d0000-0000-4000-8000-000000000036', 'approved', 10000) as r;
reset role;

select is((select r from r_i2), jsonb_build_object('ok', true, 'reason', 'pms_booking_missing'),
  'I1 : approved avec une nuit PMS sans booking → ok, pms_booking_missing');
select is(
  (select jsonb_build_object(
     'paiement', (select status from payments where id = '9a5d0000-0000-4000-8000-000000000034'),
     'mp', (select mp_payment_id from payments where id = '9a5d0000-0000-4000-8000-000000000034'),
     'commande', (select payment_status from orders where id = '9a5d0000-0000-4000-8000-000000000023'))),
  jsonb_build_object('paiement', 'pending', 'mp', 'mp-grd-3', 'commande', 'pending'),
  'I2 : rien n''est appliqué (paiement et commande intacts), l''identifiant MP est gardé pour rembourser');
select is(
  (select jsonb_build_object('kind', kind, 'reason_code', reason_code) from payment_reconciliation_entries where mp_payment_id = 'mp-grd-3'),
  jsonb_build_object('kind', 'refund_required', 'reason_code', 'pms_booking_missing'),
  'I3 : une entrée refund_required / pms_booking_missing pour l''admin (traitement manuel)');
select ok(strpos((select n.body_html from notification_emails n join payment_reconciliation_entries e on e.id = n.related_id
                   where e.mp_payment_id = 'mp-grd-3' and n.event_type = 'client_payment_received_not_honored'),
                 'no logramos confirmar la disponibilidad del alojamiento') > 0,
  'I4 : le client reçoit le texte de pms_booking_missing (jamais « expirada »)');
select is((select r from r_local), jsonb_build_object('ok', true),
  'I5 : un logement local sans booking s''applique (rien à réserver chez Lobby)');
select is((select r from r_booke), jsonb_build_object('ok', true),
  'I6 : une nuit PMS AVEC son booking s''applique');

-- Le booking est posé APRÈS le refus, puis le job rejoue le même paiement approuvé.
update order_lines set pms_booking_id = 'lobby-guards-tardif' where id = '9a5d0000-0000-4000-8000-000000000053';
set local role service_role;
create temp table r_rejeu as select test_webhook('mp-grd-3', '9a5d0000-0000-4000-8000-000000000034', 'approved', 10000) as r;
reset role;
select is(
  (select jsonb_build_object(
     'r', (select r from r_rejeu),
     'paiement', (select status from payments where id = '9a5d0000-0000-4000-8000-000000000034'),
     'commande', (select payment_status from orders where id = '9a5d0000-0000-4000-8000-000000000023'))),
  jsonb_build_object('r', jsonb_build_object('ok', true, 'reason', 'pms_booking_missing'), 'paiement', 'pending', 'commande', 'pending'),
  'I7 : décision définitive — rejoué après la pose du booking, le paiement à rembourser n''est jamais appliqué');

-- ── Intent remplacé ──────────────────────────────────────────────────────
set local role service_role;
create temp table r_remplace as select test_webhook('mp-grd-6', '9a5d0000-0000-4000-8000-000000000037', 'approved', 20000) as r;
create temp table r_expire as select test_webhook('mp-grd-7', '9a5d0000-0000-4000-8000-000000000039', 'approved', 20000) as r;
create temp table r_sans_recent as select test_webhook('mp-grd-8', '9a5d0000-0000-4000-8000-000000000041', 'approved', 10000) as r;
reset role;

select is((select r from r_remplace), jsonb_build_object('ok', true, 'reason', 'superseded_intent'),
  'S1 : approved sur un intent remplacé d''une commande vivante → ok, superseded_intent');
select is(
  (select jsonb_build_object(
     'ancien', (select status from payments where id = '9a5d0000-0000-4000-8000-000000000037'),
     'courant', (select status from payments where id = '9a5d0000-0000-4000-8000-000000000038'),
     'commande', (select payment_status from orders where id = '9a5d0000-0000-4000-8000-000000000026'),
     'entree', (select reason_code from payment_reconciliation_entries where mp_payment_id = 'mp-grd-6'))),
  jsonb_build_object('ancien', 'cancelled', 'courant', 'pending', 'commande', 'pending', 'entree', 'superseded_intent'),
  'S2 : rien n''est appliqué — l''intent courant reste pending, la commande attend son paiement ; entrée superseded_intent');
select ok(strpos((select n.body_html from notification_emails n join payment_reconciliation_entries e on e.id = n.related_id
                   where e.mp_payment_id = 'mp-grd-6' and n.event_type = 'client_payment_received_not_honored'),
                 'enlace de pago anterior') > 0,
  'S3 : le client reçoit le texte de l''intent remplacé (jamais « expirada »)');
select ok(strpos((select n.body_html from notification_emails n join payment_reconciliation_entries e on e.id = n.related_id
                   where e.mp_payment_id = 'mp-grd-6' and n.event_type = 'client_payment_received_not_honored'),
                 'Hola &lt;b&gt;H&lt;/b&gt; &amp; &quot;s&quot;,') > 0,
  'S4 : texte de l''intent remplacé — nom du titulaire échappé');
select ok(strpos((select n.body_html from notification_emails n join payment_reconciliation_entries e on e.id = n.related_id
                   where e.mp_payment_id = 'mp-grd-6' and n.event_type = 'client_payment_received_not_honored'),
                 '<strong>&lt;em&gt;REF-S&lt;/em&gt;</strong>') > 0,
  'S5 : texte de l''intent remplacé — référence échappée');
select is((select subject from notification_emails n join payment_reconciliation_entries e on e.id = n.related_id
            where e.mp_payment_id = 'mp-grd-6' and n.event_type = 'client_payment_received_not_honored'),
  'Recibimos un pago hecho con un enlace anterior de tu reserva <em>REF-S</em>',
  'S6 : le sujet reste du texte brut');
select is((select r from r_expire), jsonb_build_object('ok', true, 'reason', 'paid_after_expiry'),
  'S7 : remplacé mais sans ligne à honorer (expirée) → paid_after_expiry, comme avant');
select is((select r from r_sans_recent), jsonb_build_object('ok', true, 'reason', 'paid_after_expiry'),
  'S8 : annulé sans intent plus récent → paid_after_expiry, comme avant');

-- ── Écran client ─────────────────────────────────────────────────────────
select is(
  (select order_for_client_jsonb(o) ->> 'payment_received_not_honored' from orders o where o.id = '9a5d0000-0000-4000-8000-000000000023'),
  'true',
  'O1 : après I2, l''écran dit « paiement reçu, non honoré » (jamais « confirmando »)');
select is(
  (select order_for_client_jsonb(o) ->> 'payment_received_not_honored' from orders o where o.id = '9a5d0000-0000-4000-8000-000000000026'),
  'true',
  'O2 : après un intent remplacé, l''écran dit « paiement reçu, non honoré »');

select * from finish();
rollback;
