-- Lobby après l'acompte (migration 20261023120000) — claim_paid_order_for_pms_booking (le claim des
-- commandes PAYÉES, pour pms-book-paid-orders), get_pms_check_payload (la lecture de check-nights)
-- et pms_recorded_at posé par record_pms_booking.
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - claim_paid : refuse une commande inconnue, NON payée (unpaid, pending, refunded,
--     partially_refunded), un bail vivant, une commande sans ligne vivante, un connecteur coupé ; ne
--     connaît aucune échéance de paiement ; pose le bail ; rend par établissement les nuits PMS et
--     activités Lobby SANS booking, chaque nuit avec son acompte (relu en base), son type de
--     logement, son unité et sa capacité, et primary_booking_id = le booking de la plus ancienne
--     nuit déjà bookée et vivante de cet établissement ; un groupe d'activités seules est rendu ;
--     rien à réserver → ok, claimed_at null, groups vides, aucun bail ;
--   - get_pms_check_payload : refus typés (inconnue, payée, sans ligne vivante, connecteur coupé),
--     et seulement les nuits PMS sans booking, groupées par établissement avec leur jeton ;
--   - record_pms_booking : pms_recorded_at = l'heure réelle de l'enregistrement, dans ses DEUX
--     branches, pms_booked_at inchangé (l'heure du claim) ;
--   - service_role seul.
-- ⚠️ `now()` est constant dans la transaction ; un bail « vieux » se simule en vieillissant la donnée.
-- La concurrence (passage immédiat contre le cron) relève de
-- tests/concurrency/claim_paid_order_for_pms_booking.concurrency.mjs.
begin;
select plan(32);

create function t_id(p text) returns uuid language sql as $$
  select ('7e130000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid;
$$;

insert into partners (id, display_name) values (t_id('1'), 'ClaimPaid Partner');
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
  (t_id('11'), t_id('1'), jsonb_build_object('es', 'ClaimPaid Uno'), true, 'tok-cp-1'),
  (t_id('12'), t_id('1'), jsonb_build_object('es', 'ClaimPaid Dos'), true, 'tok-cp-2'),
  (t_id('13'), t_id('1'), jsonb_build_object('es', 'ClaimPaid Apagado'), false, 'tok-cp-3');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                      lobby_category_id, lobby_product_id, lodging_kind, unit, capacity) values
  (t_id('31'), t_id('1'), t_id('11'), 'lodging', jsonb_build_object('es', 'CP Dorm'), 100000, true, 'cp-dorm', 7301, null, 'dorm', 'per_person', 8),
  (t_id('32'), t_id('1'), t_id('12'), 'lodging', jsonb_build_object('es', 'CP Privada'), 100000, true, 'cp-privada', 7302, null, 'private', 'per_two', 2),
  (t_id('33'), t_id('1'), t_id('13'), 'lodging', jsonb_build_object('es', 'CP Apagado'), 100000, true, 'cp-off', 7303, null, null, null, null),
  (t_id('34'), t_id('1'), t_id('11'), 'lodging', jsonb_build_object('es', 'CP Local'), 100000, true, 'cp-local', null, null, null, null, null),
  (t_id('35'), t_id('1'), t_id('11'), 'activity', jsonb_build_object('es', 'CP Actividad Uno'), 50000, true, 'cp-act-1', null, 8301, null, null, null),
  (t_id('36'), t_id('1'), t_id('12'), 'activity', jsonb_build_object('es', 'CP Actividad Dos'), 50000, true, 'cp-act-2', null, 8302, null, null, null),
  (t_id('37'), t_id('1'), t_id('11'), 'activity', jsonb_build_object('es', 'CP Actividad Local'), 50000, true, 'cp-act-loc', null, null, null, null, null);
insert into auth.users (id, email) values (t_id('21'), 'cp-buyer@test.local');
insert into partner_codes (code) values ('CP-PROMO');

create function t_order(p text, p_status text, p_created timestamptz default now()) returns void language sql as $$
  insert into orders (id, account_id, holder_name, holder_email, payment_status, created_at)
  values (t_id(p), t_id('21'), 'CP Holder', 'cp-' || p || '@test.local', p_status, p_created);
$$;
create function t_line(p text, p_order text, p_product text, p_date date, p_end date, p_qty int default 1,
                       p_status text default 'reserved', p_booking text default null) returns void language sql as $$
  insert into order_lines (
    id, order_id, account_id, product_id, date, end_date, qty, status, holder_name, holder_email, holder_phone,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop, pms_booking_id
  ) values (
    t_id(p), t_id(p_order), t_id('21'), t_id(p_product), p_date, p_end, p_qty, p_status, 'CP Holder',
    'cp-holder@test.local', '+573000000000',
    100000, 100000 * p_qty, 'direct', 0.17, 0, 0.17, 17000 * p_qty, 0, 17000 * p_qty, p_booking
  );
$$;

-- 1001 : payée, attribuée. Dans 011 : une nuit à réserver (qty 2), deux nuits DÉJÀ bookées (la plus
-- ancienne fait le booking principal), une nuit bookée MORTE plus ancienne encore (jamais choisie),
-- un logement local, une activité Lobby, une activité sans produit Lobby. Dans 012 : une activité
-- Lobby seule (aucune nuit de la commande dans cet établissement).
select t_order('1001', 'paid');
update orders set attribution_code = 'CP-PROMO', attribution_source = 'link' where id = t_id('1001');
select t_line('2001', '1001', '31', '2029-05-01', '2029-05-03', 2);
select t_line('2003', '1001', '31', '2029-04-20', '2029-04-21', 1, 'reserved', 'BK-CP-FIRST');
select t_line('2004', '1001', '31', '2029-04-25', '2029-04-26', 1, 'reserved', 'BK-CP-SECOND');
select t_line('2005', '1001', '31', '2029-04-01', '2029-04-02', 1, 'cancelled_by_client', 'BK-CP-DEAD');
select t_line('2006', '1001', '34', '2029-05-01', '2029-05-03');
select t_line('2007', '1001', '35', '2029-05-01', null);
select t_line('2008', '1001', '37', '2029-05-01', null);
select t_line('2009', '1001', '36', '2029-05-02', null);
-- Refus : 1002 à 1005 non payées ; 1006 bail vivant ; 1008 sans ligne vivante ; 1009 connecteur coupé.
select t_order('1002', 'unpaid');
select t_line('2010', '1002', '31', '2029-06-01', '2029-06-02');
select t_order('1003', 'pending');
select t_line('2011', '1003', '31', '2029-06-01', '2029-06-02');
select t_order('1004', 'refunded');
select t_line('2012', '1004', '31', '2029-06-01', '2029-06-02');
select t_order('1005', 'partially_refunded');
select t_line('2013', '1005', '31', '2029-06-01', '2029-06-02');
select t_order('1006', 'paid');
select t_line('2014', '1006', '31', '2029-06-01', '2029-06-02');
update orders set pms_reserve_claimed_at = now() - interval '1 minute' where id = t_id('1006');
select t_order('1007', 'paid');
select t_line('2015', '1007', '31', '2029-06-03', '2029-06-04');
update orders set pms_reserve_claimed_at = now() - interval '6 minutes' where id = t_id('1007');
select t_order('1008', 'paid');
select t_line('2016', '1008', '31', '2029-06-05', '2029-06-06', 1, 'cancelled_by_client');
select t_order('1009', 'paid');
select t_line('2017', '1009', '33', '2029-06-07', '2029-06-08');
-- 100a : payée il y a 40 min (bien au-delà de l'échéance de paiement) ; 100b : tout est booké ;
-- 100c : la nuit bookée au 1er passage, l'activité restante.
select t_order('100a', 'paid', now() - interval '40 minutes');
select t_line('2018', '100a', '31', '2029-06-09', '2029-06-10');
select t_order('100b', 'paid');
select t_line('2019', '100b', '31', '2029-06-11', '2029-06-12', 1, 'reserved', 'BK-CP-ALL');
select t_order('100c', 'paid');
select t_line('201a', '100c', '31', '2029-06-13', '2029-06-14', 1, 'reserved', 'BK-CP-PASS1');
select t_line('201b', '100c', '35', '2029-06-13', null);

-- get_pms_check_payload : 1101 deux établissements ; 1102 connecteur coupé ; 1103 logement local
-- seul ; 1104 sans ligne vivante ; 1105 payée.
select t_order('1101', 'unpaid');
select t_line('2101', '1101', '31', '2029-07-01', '2029-07-03', 2);
select t_line('2102', '1101', '32', '2029-07-01', '2029-07-02');
select t_line('2103', '1101', '31', '2029-07-10', '2029-07-11', 1, 'reserved', 'BK-PAY-OLD');
select t_line('2104', '1101', '34', '2029-07-01', '2029-07-02');
select t_line('2105', '1101', '35', '2029-07-01', null);
select t_order('1102', 'unpaid');
select t_line('2106', '1102', '33', '2029-07-01', '2029-07-02');
select t_order('1103', 'unpaid');
select t_line('2107', '1103', '34', '2029-07-01', '2029-07-02');
select t_order('1104', 'unpaid');
select t_line('2108', '1104', '31', '2029-07-01', '2029-07-02', 1, 'expired');
select t_order('1105', 'paid');
select t_line('2109', '1105', '31', '2029-07-01', '2029-07-02');

-- record_pms_booking : 1201 ligne vivante ; 1202 ligne morte entre le claim et le booking.
select t_order('1201', 'unpaid');
select t_line('2201', '1201', '31', '2029-08-01', '2029-08-02');
select t_order('1202', 'unpaid');
select t_line('2202', '1202', '31', '2029-08-03', '2029-08-04', 1, 'expired');
update orders set pms_reserve_claimed_at = now() where id in (t_id('1201'), t_id('1202'));

-- ── Droits ───────────────────────────────────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.claim_paid_order_for_pms_booking(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_paid_order_for_pms_booking(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.claim_paid_order_for_pms_booking(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.get_pms_check_payload(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.get_pms_check_payload(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.get_pms_check_payload(uuid)', 'execute'),
  'D1 : les deux fonctions (elles rendent le jeton Lobby) sont à service_role seul');
set local role anon;
select throws_ok($$ select public.get_pms_check_payload('7e130000-0000-4000-8000-000000001101') $$, '42501', null,
  'D2 : un appel anonyme de get_pms_check_payload est refusé (42501)');
set local role authenticated;
select throws_ok($$ select public.claim_paid_order_for_pms_booking('7e130000-0000-4000-8000-000000001001') $$, '42501', null,
  'D3 : un appel authentifié de claim_paid_order_for_pms_booking est refusé (42501)');
reset role;

set local role service_role;
-- ── claim_paid_order_for_pms_booking ────────────────────────────────────────────────────────
create temp table t_claim as select public.claim_paid_order_for_pms_booking(t_id('1001')) as r;
select is(
  (select jsonb_build_object('ok', r->'ok', 'claimed_at', (r->>'claimed_at')::timestamptz = now(),
                             'code', r->>'attribution_code', 'source', r->>'attribution_source') from t_claim),
  jsonb_build_object('ok', true, 'claimed_at', true, 'code', 'CP-PROMO', 'source', 'link'),
  'K1 : commande payée → ok, claimed_at = l''horodatage posé, attribution de la commande');
select is(
  (select array_agg(g->>'establishment_id' order by ord) from t_claim, jsonb_array_elements(r->'groups') with ordinality as x(g, ord)),
  array[t_id('11')::text, t_id('12')::text],
  'K2 : un groupe par établissement, dans l''ordre');
select is(
  (select jsonb_agg(l->'id') from t_claim, jsonb_array_elements(r->'groups'->0->'lodging_lines') l),
  jsonb_build_array(t_id('2001')),
  'K3 : seules les nuits PMS SANS booking (ni les bookées, ni la morte, ni le logement local)');
select is(
  (select jsonb_build_object('acompte', l->'acompte_cop', 'kind', l->'lodging_kind', 'unit', l->'unit', 'capacity', l->'capacity',
                             'categorie', l->'lobby_category_id', 'qty', l->'qty', 'total', l->'total_cop', 'fin', l->'end_date',
                             'titulaire', l->'holder_name', 'telephone', l->'holder_phone')
     from t_claim, jsonb_array_elements(r->'groups'->0->'lodging_lines') l),
  jsonb_build_object('acompte', 34000, 'kind', 'dorm', 'unit', 'per_person', 'capacity', 8,
                     'categorie', 7301, 'qty', 2, 'total', 200000, 'fin', '2029-05-03',
                     'titulaire', 'CP Holder', 'telephone', '+573000000000'),
  'K4 : chaque nuit porte son acompte (relu en base), son type de logement, son unité, sa capacité');
select is((select r->'groups'->0->>'primary_booking_id' from t_claim), 'BK-CP-FIRST',
  'K5 : primary_booking_id = la plus ancienne nuit déjà bookée ET vivante de l''établissement');
select is(
  (select jsonb_agg(a->'lobby_product_id') from t_claim, jsonb_array_elements(r->'groups'->0->'activity_lines') a),
  jsonb_build_array(8301),
  'K6 : les activités liées à Lobby seulement');
select is(
  (select jsonb_build_object('nuits', g->'lodging_lines', 'activites', jsonb_array_length(g->'activity_lines'), 'principal', g->'primary_booking_id')
     from t_claim, jsonb_array_elements(r->'groups') g where g->>'establishment_id' = t_id('12')::text),
  jsonb_build_object('nuits', '[]'::jsonb, 'activites', 1, 'principal', null),
  'K7 : un établissement aux activités seules est rendu, sans booking principal');
select is((select pms_reserve_claimed_at = now() from orders where id = t_id('1001')), true,
  'K8 : le bail est posé (orders.pms_reserve_claimed_at)');
select is(public.claim_paid_order_for_pms_booking(t_id('1001')),
  jsonb_build_object('ok', false, 'reason', 'claim_in_progress'),
  'K9 : un second claim pendant le bail → claim_in_progress');

select is(public.claim_paid_order_for_pms_booking('00000000-0000-4000-8000-000000000000'),
  jsonb_build_object('ok', false, 'reason', 'order_not_found'), 'K10 : commande inconnue → order_not_found');
select is(
  array[public.claim_paid_order_for_pms_booking(t_id('1002')) ->> 'reason',
        public.claim_paid_order_for_pms_booking(t_id('1003')) ->> 'reason',
        public.claim_paid_order_for_pms_booking(t_id('1004')) ->> 'reason',
        public.claim_paid_order_for_pms_booking(t_id('1005')) ->> 'reason'],
  array['order_not_paid', 'order_not_paid', 'order_not_paid', 'order_not_paid'],
  'K11 : une commande non payée, en attente, remboursée ou partiellement remboursée → order_not_paid');
select is((select count(*)::int from orders where id in (t_id('1002'), t_id('1003'), t_id('1004'), t_id('1005')) and pms_reserve_claimed_at is not null), 0,
  'K11b : aucun bail posé sur un refus');
select is(public.claim_paid_order_for_pms_booking(t_id('1006')) ->> 'reason', 'claim_in_progress',
  'K12 : bail vivant (1 min) → claim_in_progress');
select is(public.claim_paid_order_for_pms_booking(t_id('1007')) ->> 'ok', 'true',
  'K13 : bail expiré (6 min) → repris');
select is(public.claim_paid_order_for_pms_booking(t_id('1008')) ->> 'reason', 'order_not_active',
  'K14 : plus aucune ligne vivante → order_not_active');
select is(public.claim_paid_order_for_pms_booking(t_id('1009')) ->> 'reason', 'pms_unavailable',
  'K15 : connecteur coupé → pms_unavailable (§4.4)');
select is(public.claim_paid_order_for_pms_booking(t_id('100a')) ->> 'ok', 'true',
  'K16 : aucune échéance de paiement — une commande payée il y a 40 min se réserve');
select is(public.claim_paid_order_for_pms_booking(t_id('100b')),
  jsonb_build_object('ok', true, 'claimed_at', null, 'groups', '[]'::jsonb),
  'K17 : tout est déjà booké → ok, rien à réserver…');
select is((select pms_reserve_claimed_at from orders where id = t_id('100b')), null,
  'K17b : …et aucun bail posé');
create temp table t_claim_c as select public.claim_paid_order_for_pms_booking(t_id('100c')) as r;
select is(
  (select jsonb_build_object('nuits', r->'groups'->0->'lodging_lines', 'activite', r->'groups'->0->'activity_lines'->0->'id',
                             'principal', r->'groups'->0->'primary_booking_id') from t_claim_c),
  jsonb_build_object('nuits', '[]'::jsonb, 'activite', t_id('201b'), 'principal', 'BK-CP-PASS1'),
  'K18 : 2e passage — l''activité restante est rendue avec le booking de la nuit réservée au 1er passage');

-- ── get_pms_check_payload ───────────────────────────────────────────────────────────────────
select is(public.get_pms_check_payload(t_id('1101')),
  jsonb_build_object('ok', true, 'groups', jsonb_build_array(
    jsonb_build_object('establishment_id', t_id('11'), 'api_token', 'tok-cp-1', 'lines', jsonb_build_array(
      jsonb_build_object('id', t_id('2101'), 'lobby_category_id', 7301, 'date', '2029-07-01', 'end_date', '2029-07-03', 'qty', 2))),
    jsonb_build_object('establishment_id', t_id('12'), 'api_token', 'tok-cp-2', 'lines', jsonb_build_array(
      jsonb_build_object('id', t_id('2102'), 'lobby_category_id', 7302, 'date', '2029-07-01', 'end_date', '2029-07-02', 'qty', 1))))),
  'P1 : les nuits PMS sans booking, par établissement avec son jeton (ni la bookée, ni le local, ni l''activité)');
select is(public.get_pms_check_payload(t_id('1102')),
  jsonb_build_object('ok', false, 'reason', 'pms_unavailable'), 'P2 : connecteur coupé → pms_unavailable');
select is(public.get_pms_check_payload(t_id('1103')),
  jsonb_build_object('ok', true, 'groups', '[]'::jsonb), 'P3 : aucune nuit PMS → ok, aucun groupe');
select is(public.get_pms_check_payload(t_id('1104')),
  jsonb_build_object('ok', false, 'reason', 'order_not_active'), 'P4 : aucune ligne vivante → order_not_active');
select is(public.get_pms_check_payload(t_id('1105')),
  jsonb_build_object('ok', false, 'reason', 'order_paid'), 'P5 : commande payée → order_paid');
select is(public.get_pms_check_payload(null),
  jsonb_build_object('ok', false, 'reason', 'order_not_found'), 'P6 : commande nulle → order_not_found');

-- ── record_pms_booking : pms_recorded_at ────────────────────────────────────────────────────
select is(public.record_pms_booking(t_id('1201'), now(), t_id('2201'), 'BK-REC-1'),
  jsonb_build_object('ok', true), 'B1 : booking enregistré');
select is(public.record_pms_booking(t_id('1202'), now(), t_id('2202'), 'BK-REC-2'),
  jsonb_build_object('ok', false, 'reason', 'line_not_reserved'), 'B2 : ligne morte → line_not_reserved (booking gardé, en annulation)');
reset role;
select is(
  (select array_agg(jsonb_build_object('booking', pms_booking_id, 'claim', pms_booked_at = now(),
                                       'enregistre', pms_recorded_at is not null and pms_recorded_at >= now()) order by id)
     from order_lines where id in (t_id('2201'), t_id('2202'))),
  array[jsonb_build_object('booking', 'BK-REC-1', 'claim', true, 'enregistre', true),
        jsonb_build_object('booking', 'BK-REC-2', 'claim', true, 'enregistre', true)],
  'B3 : dans les DEUX branches, pms_recorded_at = l''heure réelle (≥ now()), pms_booked_at = l''heure du claim');

select * from finish();
rollback;
