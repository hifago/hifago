-- Issue du poll Lobby (migration 20261003223900) : apply_pms_poll_outcome et claim_pms_poll_batch.
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - claim_pms_poll_batch : jamais un établissement sans jeton ; une ligne par booking, identifié
--     par (numéro, établissement) ; toutes les lignes vivantes du booking marquées interrogées ;
--   - le booking traité est celui de l'établissement de la ligne : le même numéro chez un autre
--     établissement, dans la même commande ou ailleurs, ne bouge pas ;
--   - gone : les lignes VIVANTES du booking passent cancelled_by_provider en une fois, les places
--     des activités reviennent (la nuit PMS n'en a jamais pris), le ledger référent est reversed,
--     le miroir est marqué dû, une entrée de réconciliation porte son détail — une commande payée le
--     dit (un paiement en cours aussi), sans que payment_status ni les paiements ne bougent ; une
--     ligne déjà annulée par le client ne bouge pas ; la nuit PMS ne rend rien ; idempotent ;
--   - realized : les lignes ÉCHUES du booking (nuit ET activités) passent fulfilled, commission due,
--     aucune place rendue ; une activité datée après le séjour reste réservée ;
--   - service_role seul.
-- ⚠️ `now()` est constant dans la transaction.
begin;
select plan(22);

insert into auth.users (id, email) values ('9a6a0000-0000-4000-8000-000000000001', 'poll-outcome-buyer@test.local');
insert into partners (id, display_name) values
  ('9a6a0000-0000-4000-8000-000000000002', 'Poll Outcome Owner'),
  ('9a6a0000-0000-4000-8000-000000000003', 'Poll Outcome Referrer');
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
  ('9a6a0000-0000-4000-8000-000000000011', '9a6a0000-0000-4000-8000-000000000002', jsonb_build_object('es', 'PO Avec jeton'), true, 'tok-po'),
  ('9a6a0000-0000-4000-8000-000000000012', '9a6a0000-0000-4000-8000-000000000002', jsonb_build_object('es', 'PO Sans jeton'), true, null),
  ('9a6a0000-0000-4000-8000-000000000013', '9a6a0000-0000-4000-8000-000000000002', jsonb_build_object('es', 'PO Autre compte'), true, 'tok-po-2'),
  ('9a6a0000-0000-4000-8000-000000000014', '9a6a0000-0000-4000-8000-000000000002', jsonb_build_object('es', 'PO Troisième compte'), true, 'tok-po-3');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
  ('9a6a0000-0000-4000-8000-000000000021', '9a6a0000-0000-4000-8000-000000000002', '9a6a0000-0000-4000-8000-000000000011',
   'lodging', jsonb_build_object('es', 'PO Nuit'), 100000, true, 'po-nuit', 9901),
  ('9a6a0000-0000-4000-8000-000000000022', '9a6a0000-0000-4000-8000-000000000002', '9a6a0000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'PO Activité'), 50000, true, 'po-activite', null),
  ('9a6a0000-0000-4000-8000-000000000023', '9a6a0000-0000-4000-8000-000000000002', '9a6a0000-0000-4000-8000-000000000012',
   'lodging', jsonb_build_object('es', 'PO Nuit sans jeton'), 100000, true, 'po-nuit-sans-jeton', 9902),
  ('9a6a0000-0000-4000-8000-000000000024', '9a6a0000-0000-4000-8000-000000000002', '9a6a0000-0000-4000-8000-000000000013',
   'lodging', jsonb_build_object('es', 'PO Nuit autre compte'), 100000, true, 'po-nuit-autre', 9903),
  ('9a6a0000-0000-4000-8000-000000000025', '9a6a0000-0000-4000-8000-000000000002', '9a6a0000-0000-4000-8000-000000000014',
   'lodging', jsonb_build_object('es', 'PO Nuit troisième compte'), 100000, true, 'po-nuit-troisieme', 9904);
-- L'activité a pris 2 + 1 places le 2029-07-02 (commande 31, dont 1 annulée par le client), 1 le
-- 2026-01-02 et 1 le 2099-01-01 (commande 32). Les nuits PMS ont des disponibilités au miroir (5
-- prises ailleurs) qu'elles ne décrémentent jamais.
insert into product_availability (product_id, date, capacity, booked) values
  ('9a6a0000-0000-4000-8000-000000000022', '2029-07-02', 10, 3),
  ('9a6a0000-0000-4000-8000-000000000022', '2026-01-02', 10, 1),
  ('9a6a0000-0000-4000-8000-000000000022', '2099-01-01', 10, 1),
  ('9a6a0000-0000-4000-8000-000000000021', '2029-07-01', 10, 5),
  ('9a6a0000-0000-4000-8000-000000000021', '2029-07-02', 10, 5);

insert into orders (id, account_id, holder_name, holder_email, payment_status, reference) values
  ('9a6a0000-0000-4000-8000-000000000031', '9a6a0000-0000-4000-8000-000000000001', 'PO', 'poll-outcome-buyer@test.local', 'paid', 'PO-31'),
  ('9a6a0000-0000-4000-8000-000000000032', '9a6a0000-0000-4000-8000-000000000001', 'PO', 'poll-outcome-buyer@test.local', 'paid', 'PO-32'),
  ('9a6a0000-0000-4000-8000-000000000033', '9a6a0000-0000-4000-8000-000000000001', 'PO', 'poll-outcome-buyer@test.local', 'paid', 'PO-33'),
  ('9a6a0000-0000-4000-8000-000000000034', '9a6a0000-0000-4000-8000-000000000001', 'PO', 'poll-outcome-buyer@test.local', 'paid', 'PO-34'),
  ('9a6a0000-0000-4000-8000-000000000035', '9a6a0000-0000-4000-8000-000000000001', 'PO', 'poll-outcome-buyer@test.local', 'pending', 'PO-35');
insert into order_lines (
  id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
  price_cop, total_cop, commission_case, referrer_partner_id, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop, pms_booking_id
)
select l.id::uuid, l.order_id::uuid, '9a6a0000-0000-4000-8000-000000000001', l.product_id::uuid,
       l.date::date, l.end_date::date, l.qty, l.status, 'PO',
       100000, 100000, l.cas, l.referrer::uuid, 0.17, l.rpct, 0.17 - l.rpct,
       17000, l.rcom, 17000 - l.rcom, l.booking
  from (values
    -- 31 : booking B-PO-1 = la nuit, une activité (qty 2, commission référent), une activité annulée par le client.
    ('9a6a0000-0000-4000-8000-000000000041', '9a6a0000-0000-4000-8000-000000000031', '9a6a0000-0000-4000-8000-000000000021', '2029-07-01', '2029-07-03', 1, 'reserved', 'direct', null, 0, 0, 'B-PO-1'),
    ('9a6a0000-0000-4000-8000-000000000042', '9a6a0000-0000-4000-8000-000000000031', '9a6a0000-0000-4000-8000-000000000022', '2029-07-02', null, 2, 'reserved', 'external_referrer', '9a6a0000-0000-4000-8000-000000000003', 0.1, 10000, 'B-PO-1'),
    ('9a6a0000-0000-4000-8000-000000000043', '9a6a0000-0000-4000-8000-000000000031', '9a6a0000-0000-4000-8000-000000000022', '2029-07-02', null, 1, 'cancelled_by_client', 'direct', null, 0, 0, 'B-PO-1'),
    -- 32 : booking B-PO-2, séjour PASSÉ = la nuit et une activité (commission référent), plus une
    -- activité datée APRÈS le séjour, pour « realized ».
    ('9a6a0000-0000-4000-8000-000000000044', '9a6a0000-0000-4000-8000-000000000032', '9a6a0000-0000-4000-8000-000000000021', '2026-01-01', '2026-01-03', 1, 'reserved', 'direct', null, 0, 0, 'B-PO-2'),
    ('9a6a0000-0000-4000-8000-000000000045', '9a6a0000-0000-4000-8000-000000000032', '9a6a0000-0000-4000-8000-000000000022', '2026-01-02', null, 1, 'reserved', 'external_referrer', '9a6a0000-0000-4000-8000-000000000003', 0.1, 10000, 'B-PO-2'),
    ('9a6a0000-0000-4000-8000-000000000049', '9a6a0000-0000-4000-8000-000000000032', '9a6a0000-0000-4000-8000-000000000022', '2099-01-01', null, 1, 'reserved', 'direct', null, 0, 0, 'B-PO-2'),
    -- 33 : établissement SANS jeton ; 34 : un autre compte Lobby qui porte le MÊME numéro que 31.
    ('9a6a0000-0000-4000-8000-000000000046', '9a6a0000-0000-4000-8000-000000000033', '9a6a0000-0000-4000-8000-000000000023', '2029-07-01', '2029-07-03', 1, 'reserved', 'direct', null, 0, 0, 'B-PO-3'),
    ('9a6a0000-0000-4000-8000-000000000047', '9a6a0000-0000-4000-8000-000000000034', '9a6a0000-0000-4000-8000-000000000024', '2029-07-01', '2029-07-03', 1, 'reserved', 'direct', null, 0, 0, 'B-PO-1'),
    -- 31 encore : une nuit chez un TROISIÈME compte Lobby, sous le même numéro B-PO-1.
    ('9a6a0000-0000-4000-8000-000000000048', '9a6a0000-0000-4000-8000-000000000031', '9a6a0000-0000-4000-8000-000000000025', '2029-07-01', '2029-07-03', 1, 'reserved', 'direct', null, 0, 0, 'B-PO-1'),
    -- 35 : un paiement est en cours.
    ('9a6a0000-0000-4000-8000-000000000050', '9a6a0000-0000-4000-8000-000000000035', '9a6a0000-0000-4000-8000-000000000021', '2029-08-01', '2029-08-03', 1, 'reserved', 'direct', null, 0, 0, 'B-PO-5')
  ) as l(id, order_id, product_id, date, end_date, qty, status, cas, referrer, rpct, rcom, booking);
-- 31 est payée : son paiement ne doit pas bouger.
insert into payments (id, order_id, status, amount_cop) values
  ('9a6a0000-0000-4000-8000-000000000061', '9a6a0000-0000-4000-8000-000000000031', 'approved', 17000);
insert into ledger_entries (order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status) values
  ('9a6a0000-0000-4000-8000-000000000042', 'referrer', '9a6a0000-0000-4000-8000-000000000003', 'referral_earned', 10000, 'estimated'),
  ('9a6a0000-0000-4000-8000-000000000045', 'referrer', '9a6a0000-0000-4000-8000-000000000003', 'referral_earned', 10000, 'estimated');
-- Le claim lit les lignes les plus anciennement interrogées : les nôtres passent devant.
update order_lines set pms_last_polled_at = '2000-01-01' where id::text like '9a6a0000-%';

-- ── claim_pms_poll_batch ─────────────────────────────────────────────────
-- Au-delà de LIMIT : une seule ligne candidate (la nuit), sa sœur (l'activité) est marquée quand même.
update order_lines set pms_last_polled_at = '1999-01-01' where id = '9a6a0000-0000-4000-8000-000000000041';
create temp table claim_un as select * from claim_pms_poll_batch(1);
select is(
  (select jsonb_build_object(
     'rendue', (select array_agg(order_line_id::text) from claim_un),
     'soeur', (select pms_last_polled_at = now() from order_lines where id = '9a6a0000-0000-4000-8000-000000000042'))),
  jsonb_build_object('rendue', array['9a6a0000-0000-4000-8000-000000000041'], 'soeur', true),
  'C3 : une seule ligne candidate (LIMIT 1), ses sœurs du même booking sont marquées interrogées aussi');
create temp table claim as select * from claim_pms_poll_batch(100000);
select is(
  (select array_agg(order_line_id::text order by order_line_id) from claim where order_line_id::text like '9a6a0000-%'),
  array['9a6a0000-0000-4000-8000-000000000041', '9a6a0000-0000-4000-8000-000000000044', '9a6a0000-0000-4000-8000-000000000047',
        '9a6a0000-0000-4000-8000-000000000048', '9a6a0000-0000-4000-8000-000000000050'],
  'C1 : une ligne par booking (numéro, établissement) ; jamais l''établissement sans jeton');
select is(
  (select count(*)::int from order_lines where id::text like '9a6a0000-%' and status = 'reserved' and pms_last_polled_at = '2000-01-01'),
  1,
  'C2 : toutes les lignes vivantes des bookings réclamés sont marquées interrogées (reste la seule ligne sans jeton)');

-- ── gone ─────────────────────────────────────────────────────────────────
create temp table r_gone as
  select apply_pms_poll_outcome('9a6a0000-0000-4000-8000-000000000041', 'gone', '404 modèle') as r;
select is((select r from r_gone), jsonb_build_object('ok', true, 'outcome', 'gone', 'lines', 2),
  'G1 : gone → ok, les 2 lignes vivantes du booking');
select is(
  (select array_agg(status order by id) from order_lines where order_id = '9a6a0000-0000-4000-8000-000000000031'),
  array['cancelled_by_provider', 'cancelled_by_provider', 'cancelled_by_client', 'reserved'],
  'G2 : la nuit et l''activité passent cancelled_by_provider ; l''activité déjà annulée par le client et la nuit d''un autre établissement ne bougent pas');
select is((select booked from product_availability where product_id = '9a6a0000-0000-4000-8000-000000000022' and date = '2029-07-02'),
  1, 'G3 : les 2 places de l''activité reviennent (3 → 1) ; celle de l''annulation client reste prise');
select is((select array_agg(booked order by date) from product_availability where product_id = '9a6a0000-0000-4000-8000-000000000021'),
  array[5, 5], 'G3b : la nuit PMS ne rend rien (elle n''avait jamais été décrémentée)');
select is((select status from ledger_entries where order_line_id = '9a6a0000-0000-4000-8000-000000000042'),
  'reversed', 'G4 : la commission référent de l''activité est reversed');
select ok(
  (select bool_and(invalidated_at = now()) from pms_sync_state where establishment_id = '9a6a0000-0000-4000-8000-000000000011' and month = '2029-07'),
  'G5 : le miroir du mois est marqué dû');
select is(
  (select count(*)::int from pms_reconciliation_entries e join order_lines ol on ol.id = e.order_line_id where ol.order_id = '9a6a0000-0000-4000-8000-000000000031'),
  1, 'G6 : UNE entrée de réconciliation pour le booking');
select ok(
  (select detail like '%B-PO-1%' and detail like '%PO-31%' and detail like '%PAYÉE%'
     from pms_reconciliation_entries e join order_lines ol on ol.id = e.order_line_id where ol.order_id = '9a6a0000-0000-4000-8000-000000000031'),
  'G7 : son détail nomme le booking, la commande, et dit qu''elle est PAYÉE (remboursement à décider)');
select is(
  (select jsonb_build_object(
     'commande', (select payment_status from orders where id = '9a6a0000-0000-4000-8000-000000000031'),
     'paiement', (select status from payments where id = '9a6a0000-0000-4000-8000-000000000061'),
     'entrees_paiement', (select count(*) from payment_reconciliation_entries e join payments p on p.id = e.payment_id where p.order_id = '9a6a0000-0000-4000-8000-000000000031'))),
  jsonb_build_object('commande', 'paid', 'paiement', 'approved', 'entrees_paiement', 0),
  'G8 : jamais de remboursement d''office — payment_status inchangé, aucune entrée de paiement');
select is(
  (select status from order_lines where id = '9a6a0000-0000-4000-8000-000000000047'),
  'reserved', 'G9 : le même numéro de booking chez un autre compte Lobby, dans une autre commande, n''est pas touché');
select is(
  (select status from order_lines where id = '9a6a0000-0000-4000-8000-000000000048'),
  'reserved', 'G12 : le même numéro chez un autre établissement de la MÊME commande n''est pas touché');
select is(
  (select apply_pms_poll_outcome('9a6a0000-0000-4000-8000-000000000041', 'gone', '404 modèle')),
  jsonb_build_object('ok', false, 'reason', 'no_live_line'),
  'G10 : idempotent — un second appel ne fait rien');
select is(
  (select count(*)::int from pms_reconciliation_entries e join order_lines ol on ol.id = e.order_line_id where ol.order_id = '9a6a0000-0000-4000-8000-000000000031'),
  1, 'G11 : … et n''ajoute aucune entrée');

select apply_pms_poll_outcome('9a6a0000-0000-4000-8000-000000000050', 'gone', null);
select ok(
  (select bool_and(e.detail like '%un paiement est en cours%')
     from pms_reconciliation_entries e join order_lines ol on ol.id = e.order_line_id
    where ol.order_id = '9a6a0000-0000-4000-8000-000000000035'),
  'P1 : un paiement en cours est signalé dans le détail (s''il aboutit, il sera à rembourser)');

-- ── realized ─────────────────────────────────────────────────────────────
select is(
  (select apply_pms_poll_outcome('9a6a0000-0000-4000-8000-000000000044', 'realized', null)),
  jsonb_build_object('ok', true, 'outcome', 'realized', 'lines', 2),
  'R1 : realized → ok, les 2 lignes échues du booking');
select is(
  (select jsonb_build_object(
     'lignes', (select array_agg(status order by id) from order_lines where order_id = '9a6a0000-0000-4000-8000-000000000032'),
     'commission', (select status from ledger_entries where order_line_id = '9a6a0000-0000-4000-8000-000000000045'),
     'places', (select array_agg(booked order by date) from product_availability
                 where product_id = '9a6a0000-0000-4000-8000-000000000022' and date in ('2026-01-02', '2099-01-01')))),
  jsonb_build_object('lignes', array['fulfilled', 'fulfilled', 'reserved'], 'commission', 'due', 'places', array[1, 1]),
  'R2 : la nuit ET l''activité échues sont réalisées (commission due), l''activité datée après le séjour reste réservée, aucune place ne revient');

-- ── Entrées refusées, droits ─────────────────────────────────────────────
select is((select apply_pms_poll_outcome('9a6a0000-0000-4000-8000-000000000046', 'annulé', null)),
  jsonb_build_object('ok', false, 'reason', 'invalid_outcome'), 'V1 : une issue inconnue est refusée');
select is((select apply_pms_poll_outcome('00000000-0000-4000-8000-000000000000', 'gone', null)),
  jsonb_build_object('ok', false, 'reason', 'line_not_found'), 'V2 : une ligne inconnue est refusée');
select ok(
  not has_function_privilege('anon', 'public.apply_pms_poll_outcome(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.apply_pms_poll_outcome(uuid, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.apply_pms_poll_outcome(uuid, text, text)', 'execute'),
  'V3 : service_role seul');

select * from finish();
rollback;
