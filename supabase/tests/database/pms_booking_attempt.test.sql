-- Lobby après l'acompte, « une issue inconnue n'est jamais retentée » (migration 20261023150000) —
-- le marqueur durable order_lines.pms_attempt_started_at : mark_pms_booking_attempt,
-- clear_pms_booking_attempt, le refus attempt_unresolved de claim_paid_order_for_pms_booking, et la
-- relance admin qui l'efface.
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - mark : refus typés (arguments nuls, commande inconnue, claim d'un autre ou rendu, ligne d'une
--     autre commande, ligne bookée, ligne morte) sans rien écrire ; pose le marqueur (now()) ; un
--     second mark → already_attempted, marqueur inchangé ;
--   - clear : même contrôle du claim ; efface ; idempotent ; la ligne se marque de nouveau (second
--     essai sans `payment` après un refus explicite) ;
--   - claim_paid : une nuit PMS réservée sans booking et marquée → attempt_unresolved (la plus tôt,
--     par date) AVANT le bail, qui n'est pas posé ; sous un bail vivant → claim_in_progress (tentative
--     en cours) ; avant pms_unavailable ; un marqueur sur une nuit bookée, une nuit morte ou une
--     activité ne bloque pas ; une commande non payée reste order_not_paid ;
--   - la relance admin (retry) efface le marqueur : le claim passe de nouveau ;
--   - droits : service_role seul exécute mark et clear.
-- La concurrence (N marks simultanés sur la même ligne → exactement un ok) relève de
-- tests/concurrency/mark_pms_booking_attempt.concurrency.mjs.
-- ⚠️ `now()` est constant dans la transaction : un claim se désigne par une valeur fixe posée sur la
-- commande, un bail « vieux » par une donnée vieillie.
begin;
select plan(29);

create function t_id(p text) returns uuid language sql as $$
  select ('7e170000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid;
$$;
create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
-- Le claim des fixtures : une valeur fixe, distincte de now().
create function t_claim() returns timestamptz language sql as $$
  select '2029-12-01 10:00:00+00'::timestamptz;
$$;

delete from vault.secrets where name in ('pms_functions_base_url', 'pms_service_role_key');

insert into partners (id, display_name) values (t_id('1'), 'Attempt Partner');
-- 011 : connecteur actif ; 012 : connecteur coupé.
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
  (t_id('11'), t_id('1'), jsonb_build_object('es', 'Attempt Uno'), true, 'tok-attempt-1'),
  (t_id('12'), t_id('1'), jsonb_build_object('es', 'Attempt Apagado'), false, 'tok-attempt-2');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id, lobby_product_id) values
  (t_id('31'), t_id('1'), t_id('11'), 'lodging', jsonb_build_object('es', 'Attempt Noche'), 100000, true, 'attempt-noche', 7701, null),
  (t_id('32'), t_id('1'), t_id('11'), 'activity', jsonb_build_object('es', 'Attempt Actividad'), 50000, true, 'attempt-act', null, 8701),
  (t_id('33'), t_id('1'), t_id('12'), 'lodging', jsonb_build_object('es', 'Attempt Apagada'), 100000, true, 'attempt-off', 7702, null);
insert into auth.users (id, email) values
  (t_id('21'), 'attempt-buyer@test.local'),
  (t_id('22'), 'attempt-admin@test.local');
insert into partner_capabilities (account_id, role, source, status) values (t_id('22'), 'admin', 'migration', 'active');

create function t_order(p text, p_status text default 'paid', p_claimed timestamptz default null) returns void language sql as $$
  insert into orders (id, account_id, holder_name, holder_email, payment_status, reference, pms_reserve_claimed_at)
  values (t_id(p), t_id('21'), 'Attempt Holder', 'attempt-' || p || '@test.local', p_status, 'ATT-' || p, p_claimed);
$$;
create function t_line(p text, p_order text, p_product text, p_date date, p_end date,
                       p_status text default 'reserved', p_booking text default null, p_marked boolean default false)
returns void language sql as $$
  insert into order_lines (
    id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop, pms_held_at, pms_booking_id, pms_attempt_started_at
  ) values (
    t_id(p), t_id(p_order), t_id('21'), t_id(p_product), p_date, p_end, 1, p_status, 'Attempt Holder',
    100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000,
    case when p_end is not null then now() - interval '20 minutes' end, p_booking,
    case when p_marked then now() - interval '19 minutes' end
  );
$$;
create function t_marker(p text) returns timestamptz language sql as $$
  select pms_attempt_started_at from order_lines where id = t_id(p);
$$;

-- 1001 : le claim t_claim() ; une nuit libre, une nuit bookée, une nuit morte. 1002 : une autre commande.
select t_order('1001', 'paid', t_claim());
select t_line('2001', '1001', '31', '2030-01-01', '2030-01-02');
select t_line('2002', '1001', '31', '2030-01-03', '2030-01-04', 'reserved', '990001');
select t_line('2003', '1001', '31', '2030-01-05', '2030-01-06', 'cancelled_by_client');
select t_order('1002', 'paid', t_claim());
select t_line('2004', '1002', '31', '2030-01-07', '2030-01-08');
-- claim_paid. 1003 : bail expiré, deux nuits marquées (la plus tôt par date n'a pas le plus petit id),
-- une activité marquée. 1004 : bail vivant, nuit marquée. 1005 : nuit marquée sur un connecteur coupé.
-- 1006 : marqueurs sur une nuit bookée, une nuit morte et une activité ; une nuit libre non marquée.
-- 1007 : nuit marquée, demande needs_human (relance admin). 1008 : non payée, nuit marquée.
select t_order('1003', 'paid', now() - interval '10 minutes');
select t_line('2005', '1003', '31', '2030-02-05', '2030-02-06', 'reserved', null, true);
select t_line('2006', '1003', '31', '2030-02-03', '2030-02-04', 'reserved', null, true);
select t_line('2007', '1003', '32', '2030-02-03', null, 'reserved', null, true);
select t_order('1004', 'paid', now() - interval '1 minute');
select t_line('2008', '1004', '31', '2030-02-07', '2030-02-08', 'reserved', null, true);
select t_order('1005');
select t_line('2009', '1005', '33', '2030-02-09', '2030-02-10', 'reserved', null, true);
select t_order('1006');
select t_line('2010', '1006', '31', '2030-02-11', '2030-02-12', 'reserved', '990002', true);
select t_line('2011', '1006', '31', '2030-02-13', '2030-02-14', 'cancelled_by_client', null, true);
select t_line('2012', '1006', '32', '2030-02-11', null, 'reserved', null, true);
select t_line('2013', '1006', '31', '2030-02-15', '2030-02-16');
select t_order('1007');
select t_line('2014', '1007', '31', '2030-02-17', '2030-02-18', 'reserved', null, true);
insert into pms_booking_requests (id, order_id, status, attempts, last_error, processed_at)
values (t_id('3007'), t_id('1007'), 'needs_human', 1, 'tentative précédente sans issue connue', now());
select t_order('1008', 'unpaid');
select t_line('2015', '1008', '31', '2030-02-19', '2030-02-20', 'reserved', null, true);

-- ── Droits ───────────────────────────────────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.mark_pms_booking_attempt(uuid, timestamptz, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.mark_pms_booking_attempt(uuid, timestamptz, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.mark_pms_booking_attempt(uuid, timestamptz, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.clear_pms_booking_attempt(uuid, timestamptz, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.clear_pms_booking_attempt(uuid, timestamptz, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.clear_pms_booking_attempt(uuid, timestamptz, uuid)', 'execute'),
  'D1 : mark et clear exécutables par service_role seul');
set local role authenticated;
select throws_ok(
  $$ select public.mark_pms_booking_attempt('7e170000-0000-4000-8000-000000001001', '2029-12-01 10:00:00+00', '7e170000-0000-4000-8000-000000002001') $$,
  '42501', null, 'D2 : un appel authentifié de mark_pms_booking_attempt est refusé (42501)');
set local role anon;
select throws_ok(
  $$ select public.clear_pms_booking_attempt('7e170000-0000-4000-8000-000000001001', '2029-12-01 10:00:00+00', '7e170000-0000-4000-8000-000000002001') $$,
  '42501', null, 'D3 : un appel anonyme de clear_pms_booking_attempt est refusé (42501)');
reset role;

-- ── mark_pms_booking_attempt ────────────────────────────────────────────────────────────────
set local role service_role;
select is(
  array[public.mark_pms_booking_attempt(t_id('1001'), null, t_id('2001')) ->> 'reason',
        public.mark_pms_booking_attempt(null, t_claim(), t_id('2001')) ->> 'reason',
        public.mark_pms_booking_attempt(t_id('1001'), t_claim(), null) ->> 'reason'],
  array['invalid_arguments', 'invalid_arguments', 'invalid_arguments'],
  'M1 : un argument nul → invalid_arguments (jamais un marqueur hors claim)');
select is(public.mark_pms_booking_attempt('00000000-0000-4000-8000-000000000000', t_claim(), t_id('2001')),
  jsonb_build_object('ok', false, 'reason', 'order_not_found'), 'M2 : commande inconnue → order_not_found');
select is(public.mark_pms_booking_attempt(t_id('1001'), t_claim() + interval '1 second', t_id('2001')),
  jsonb_build_object('ok', false, 'reason', 'claim_stale'), 'M3 : le claim d''un autre appelant → claim_stale');
select is(public.mark_pms_booking_attempt(t_id('1001'), t_claim(), t_id('2004')),
  jsonb_build_object('ok', false, 'reason', 'line_not_found'), 'M4 : la ligne d''une autre commande → line_not_found');
select is(public.mark_pms_booking_attempt(t_id('1001'), t_claim(), t_id('2002')),
  jsonb_build_object('ok', false, 'reason', 'already_booked'), 'M5 : une ligne déjà bookée → already_booked');
select is(public.mark_pms_booking_attempt(t_id('1001'), t_claim(), t_id('2003')),
  jsonb_build_object('ok', false, 'reason', 'line_not_reserved'), 'M6 : une ligne morte → line_not_reserved');
reset role;
select is(
  (select array_agg(pms_attempt_started_at order by id) from order_lines where id in (t_id('2001'), t_id('2002'), t_id('2003'), t_id('2004'))),
  array[null, null, null, null]::timestamptz[],
  'M7 : aucun refus n''écrit le marqueur');
set local role service_role;
select is(public.mark_pms_booking_attempt(t_id('1001'), t_claim(), t_id('2001')),
  jsonb_build_object('ok', true), 'M8 : claim, ligne réservée sans booking, aucun marqueur → posé');
reset role;
select is(t_marker('2001'), now(), 'M9 : le marqueur vaut now()');
update order_lines set pms_attempt_started_at = now() - interval '3 minutes' where id = t_id('2001');
set local role service_role;
select is(public.mark_pms_booking_attempt(t_id('1001'), t_claim(), t_id('2001')),
  jsonb_build_object('ok', false, 'reason', 'already_attempted'),
  'M10 : un second mark → already_attempted (une issue inconnue n''est jamais rejouée)');
reset role;
select is(t_marker('2001'), now() - interval '3 minutes', 'M11 : …et le marqueur n''est pas réécrit');

-- ── clear_pms_booking_attempt ───────────────────────────────────────────────────────────────
set local role service_role;
select is(
  array[public.clear_pms_booking_attempt(t_id('1001'), t_claim() - interval '1 second', t_id('2001')),
        public.clear_pms_booking_attempt(t_id('1001'), t_claim(), t_id('2004'))],
  array[jsonb_build_object('ok', false, 'reason', 'claim_stale'), jsonb_build_object('ok', false, 'reason', 'line_not_found')],
  'K1 : clear contrôle le claim et la commande de la ligne');
reset role;
select isnt(t_marker('2001'), null, 'K2 : un clear refusé n''efface rien');
set local role service_role;
select is(public.clear_pms_booking_attempt(t_id('1001'), t_claim(), t_id('2001')),
  jsonb_build_object('ok', true, 'cleared', true), 'K3 : clear (l''appel n''a pas pu créer de booking) → effacé');
select is(public.clear_pms_booking_attempt(t_id('1001'), t_claim(), t_id('2001')),
  jsonb_build_object('ok', true, 'cleared', false), 'K4 : clear rejoué → idempotent');
select is(public.mark_pms_booking_attempt(t_id('1001'), t_claim(), t_id('2001')),
  jsonb_build_object('ok', true), 'K5 : la ligne se marque de nouveau (second essai sans `payment` après un refus explicite)');
update orders set pms_reserve_claimed_at = null where id = t_id('1001');
select is(public.mark_pms_booking_attempt(t_id('1001'), t_claim(), t_id('2001')) ->> 'reason', 'claim_stale',
  'K6 : un bail rendu (release_pms_reserve_claim) → claim_stale');

-- ── claim_paid_order_for_pms_booking : attempt_unresolved ───────────────────────────────────
select is(public.claim_paid_order_for_pms_booking(t_id('1003')),
  jsonb_build_object('ok', false, 'reason', 'attempt_unresolved', 'order_line_id', t_id('2006')),
  'A1 : une nuit marquée sans booking → attempt_unresolved, la nuit la plus tôt (par date) désignée');
reset role;
select is((select pms_reserve_claimed_at = now() - interval '10 minutes' from orders where id = t_id('1003')), true,
  'A2 : …AVANT le bail : le bail expiré n''est pas repris');
set local role service_role;
select is(public.claim_paid_order_for_pms_booking(t_id('1004')),
  jsonb_build_object('ok', false, 'reason', 'claim_in_progress'),
  'A3 : sous un bail vivant, le marqueur est une tentative EN COURS → claim_in_progress');
select is(public.claim_paid_order_for_pms_booking(t_id('1005')) ->> 'reason', 'attempt_unresolved',
  'A4 : avant pms_unavailable — un connecteur coupé ne maquille pas une issue inconnue en panne');
create temp table t_claim_1006 as select public.claim_paid_order_for_pms_booking(t_id('1006')) as r;
select is(
  (select jsonb_build_object('ok', r -> 'ok', 'nuits', (select jsonb_agg(l -> 'id') from jsonb_array_elements(r -> 'groups' -> 0 -> 'lodging_lines') l),
                             'activites', (select jsonb_agg(a -> 'id') from jsonb_array_elements(r -> 'groups' -> 0 -> 'activity_lines') a))
     from t_claim_1006),
  jsonb_build_object('ok', true, 'nuits', jsonb_build_array(t_id('2013')), 'activites', jsonb_build_array(t_id('2012'))),
  'A5 : un marqueur sur une nuit bookée, une nuit morte ou une activité ne bloque pas (seules les nuits sont marquées)');
select is(public.claim_paid_order_for_pms_booking(t_id('1008')) ->> 'reason', 'order_not_paid',
  'A6 : une commande non payée reste order_not_paid');
select is(public.claim_paid_order_for_pms_booking(t_id('1007')) ->> 'reason', 'attempt_unresolved',
  'A7 : avant la relance admin, la commande est refusée');
reset role;

-- ── La relance admin efface le marqueur, le claim passe ─────────────────────────────────────
set local role authenticated;
select test_login(t_id('22'));
select is(admin_resolve_pms_booking_request(t_id('3007'), 'retry') ->> 'markers_cleared', '1',
  'A8 : retry admin (l''admin atteste qu''aucun booking n''existe chez Lobby) → marqueur effacé');
reset role;
set local role service_role;
create temp table t_claim_1007 as select public.claim_paid_order_for_pms_booking(t_id('1007')) as r;
reset role;
select is(
  (select jsonb_build_object('ok', r -> 'ok', 'bail', r ->> 'claimed_at' is not null,
                             'nuits', (select jsonb_agg(l -> 'id') from jsonb_array_elements(r -> 'groups' -> 0 -> 'lodging_lines') l))
     from t_claim_1007),
  jsonb_build_object('ok', true, 'bail', true, 'nuits', jsonb_build_array(t_id('2014'))),
  'A9 : après la relance, le claim passe et rend la nuit (bail posé)');

select * from finish();
rollback;
