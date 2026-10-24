-- Lobby après l'acompte (migration 20261023120000) — ce que voient le paiement, le client et le
-- partenaire : apply_payment_webhook (D4), create_payment_intent (D3), order_for_client_jsonb (D9),
-- l'e-mail 8 de create_order, resolve_pms_cancellation_restricted.
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - webhook approved + une nuit PMS sans booking → payée, UNE demande, AUCUN e-mail 5/6/7/8
--     (commande mixte comprise) ; sans nuit PMS à réserver (aucune, ou bookée par l'ancien flux) →
--     les e-mails partent, aucune demande ; une nuit jamais tenue ne fait plus rembourser (l'ancienne
--     garde pms_booking_missing) ; une demande close (done) est réarmée, jamais une demande failed ;
--   - create_payment_intent : une nuit PMS sans booking se paie si elle est tenue depuis 5 min au
--     plus (borne comprise), jamais au-delà ni sans tenue ; une nuit bookée se paie ;
--   - order_for_client_jsonb.pms_confirmation : 'pending' (payée, nuit PMS vivante sans booking,
--     demande absente ou en cours), 'failed' (demande failed / needs_human), null sinon — et le
--     WhatsApp du prestataire masqué sur TOUTE la commande tant qu'il vaut 'pending' ou 'failed' ;
--   - create_order : l'e-mail 8 part à la création d'une commande sans rien à payer en ligne
--     (evento gratuit), jamais quand un acompte est dû ;
--   - resolve_pms_cancellation_restricted : l'annulation refusée (booking payé) est close ET part en
--     réconciliation « annuler à la main dans Lobby », une fois par booking ; sans ligne, close seule.
begin;
select plan(29);

create function t_id(p text) returns uuid language sql as $$
  select ('7e140000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid;
$$;
create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

delete from vault.secrets where name in ('pms_functions_base_url', 'pms_service_role_key');

insert into partners (id, display_name) values (t_id('1'), 'LA Partner');
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token, contact_phone) values
  (t_id('11'), t_id('1'), jsonb_build_object('es', 'LA Hostal PMS'), true, 'tok-la', '+573001112233'),
  (t_id('12'), t_id('1'), jsonb_build_object('es', 'LA Prestador'), false, null, '+573004445566');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id, duration_days) values
  (t_id('31'), t_id('1'), t_id('11'), 'lodging', jsonb_build_object('es', 'LA Noche PMS'), 100000, true, 'la-noche-pms', 7401, null),
  (t_id('32'), t_id('1'), t_id('12'), 'lodging', jsonb_build_object('es', 'LA Cabaña'), 100000, true, 'la-cabana', null, null),
  (t_id('33'), t_id('1'), t_id('12'), 'activity', jsonb_build_object('es', 'LA Actividad'), 50000, true, 'la-actividad', null, null),
  (t_id('34'), t_id('1'), t_id('12'), 'camp', jsonb_build_object('es', 'LA Campamento'), 90000, true, 'la-camp', null, 1);
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                      online_bookable, is_free, evento_capacity_mode, occurrence_type, occurrence_date) values
  (t_id('35'), t_id('1'), t_id('12'), 'evento', jsonb_build_object('es', 'LA Fiesta Gratis'), null, true, 'la-fiesta-gratis',
   true, true, 'unlimited', 'once', '2029-11-20');
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values (t_id('12'), '2029-11-20', 5, 0);
insert into product_availability (product_id, date, capacity, booked) values (t_id('33'), '2029-11-20', 10, 0);
insert into auth.users (id, email) values
  (t_id('21'), 'la-owner@test.local'),
  (t_id('22'), 'la-buyer@test.local'),
  (t_id('23'), 'la-admin@test.local');
update partner_accounts set partner_id = t_id('1') where id = t_id('21');
insert into partner_capabilities (account_id, role, source, status) values (t_id('23'), 'admin', 'migration', 'active');

create function t_order(p text, p_status text) returns void language sql as $$
  insert into orders (id, account_id, holder_name, holder_email, payment_status, reference)
  values (t_id(p), t_id('22'), 'LA Holder', 'la-client-' || p || '@test.local', p_status, 'LA-' || p);
$$;
create function t_line(p text, p_order text, p_product text, p_date date, p_end date,
                       p_held timestamptz default null, p_booking text default null,
                       p_status text default 'reserved') returns void language sql as $$
  insert into order_lines (
    id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop, pms_held_at, pms_booking_id
  ) values (
    t_id(p), t_id(p_order), t_id('22'), t_id(p_product), p_date, p_end, 1, p_status, 'LA Holder',
    100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000, p_held, p_booking
  );
$$;
create function t_webhook(p_mp text, p_payment text) returns jsonb language sql as $$
  select public.apply_payment_webhook_checked(p_mp, t_id(p_payment), 'approved', 17000,
    jsonb_build_object('id', p_mp, 'status', 'approved', 'transaction_amount', 17000));
$$;
create function t_emails(p_order text) returns jsonb language sql as $$
  select jsonb_build_object(
    'paiement', (select count(*)::int from notification_emails where event_type = 'partner_payment_confirmed' and related_id = t_id(p_order)),
    'client', (select count(*)::int from notification_emails where event_type = 'client_order_confirmed' and related_id = t_id(p_order)),
    'recurso', (select count(*)::int from notification_emails n join order_lines ol on ol.id = n.related_id
                 where n.event_type = 'partner_camp_evento_blocked' and ol.order_id = t_id(p_order)));
$$;

-- ── Webhook : fixtures (une commande `pending`, un paiement `pending` de 17000 chacune) ────────
-- 1101 : nuit PMS tenue + camp (mixte) ; 1102 : logement local + camp ; 1103 : nuit PMS bookée par
-- l'ancien flux ; 1104 : demande déjà close (done) ; 1105 : demande failed ; 1106 : nuit jamais tenue.
select t_order('1101', 'pending');
select t_line('2101', '1101', '31', '2029-05-01', '2029-05-02', now() - interval '3 minutes');
select t_line('2102', '1101', '34', '2029-05-01', null);
select t_order('1102', 'pending');
select t_line('2103', '1102', '32', '2029-05-01', '2029-05-02');
select t_line('2104', '1102', '34', '2029-05-02', null);
select t_order('1103', 'pending');
select t_line('2105', '1103', '31', '2029-05-03', '2029-05-04', null, 'BK-LA-OLD');
select t_order('1104', 'pending');
select t_line('2106', '1104', '31', '2029-05-05', '2029-05-06', now() - interval '3 minutes');
insert into pms_booking_requests (order_id, status, attempts, processed_at) values (t_id('1104'), 'done', 3, now() - interval '1 day');
select t_order('1105', 'pending');
select t_line('2107', '1105', '31', '2029-05-07', '2029-05-08', now() - interval '3 minutes');
insert into pms_booking_requests (order_id, status, attempts, last_error) values (t_id('1105'), 'failed', 2, 'refus');
select t_order('1106', 'pending');
select t_line('2108', '1106', '31', '2029-05-09', '2029-05-10');
insert into payments (id, order_id, status, amount_cop) values
  (t_id('4101'), t_id('1101'), 'pending', 17000), (t_id('4102'), t_id('1102'), 'pending', 17000),
  (t_id('4103'), t_id('1103'), 'pending', 17000), (t_id('4104'), t_id('1104'), 'pending', 17000),
  (t_id('4105'), t_id('1105'), 'pending', 17000), (t_id('4106'), t_id('1106'), 'pending', 17000);

set local role service_role;
create temp table t_w1 as select t_webhook('mp-la-1', '4101') as r;
create temp table t_w1b as select t_webhook('mp-la-1', '4101') as r;
create temp table t_w2 as select t_webhook('mp-la-2', '4102') as r;
create temp table t_w3 as select t_webhook('mp-la-3', '4103') as r;
create temp table t_w4 as select t_webhook('mp-la-4', '4104') as r;
create temp table t_w5 as select t_webhook('mp-la-5', '4105') as r;
create temp table t_w6 as select t_webhook('mp-la-6', '4106') as r;
reset role;

select is(
  jsonb_build_object('r', (select r from t_w1), 'commande', (select payment_status from orders where id = t_id('1101')),
                     'demande', (select status || '/' || attempts from pms_booking_requests where order_id = t_id('1101')),
                     'emails', t_emails('1101')),
  jsonb_build_object('r', jsonb_build_object('ok', true), 'commande', 'paid', 'demande', 'pending/0',
                     'emails', jsonb_build_object('paiement', 0, 'client', 0, 'recurso', 0)),
  'W1 : nuit PMS sans booking (commande mixte) → payée, UNE demande, AUCUN e-mail (5/6/7 ni 8) avant le booking');
select is(
  jsonb_build_object('r', (select r from t_w1b), 'demandes', (select count(*)::int from pms_booking_requests where order_id = t_id('1101'))),
  jsonb_build_object('r', jsonb_build_object('ok', true, 'reason', 'already_applied'), 'demandes', 1),
  'W2 : le même webhook rejoué → already_applied, toujours UNE demande');
select is(
  jsonb_build_object('r', (select r from t_w2), 'demande', (select count(*)::int from pms_booking_requests where order_id = t_id('1102')),
                     'emails', t_emails('1102')),
  jsonb_build_object('r', jsonb_build_object('ok', true), 'demande', 0,
                     'emails', jsonb_build_object('paiement', 1, 'client', 1, 'recurso', 1)),
  'W3 : aucune nuit PMS → aucune demande, les e-mails partent tout de suite (8 compris, à la confirmation)');
select is(
  jsonb_build_object('r', (select r from t_w3), 'demande', (select count(*)::int from pms_booking_requests where order_id = t_id('1103')),
                     'emails', t_emails('1103')),
  jsonb_build_object('r', jsonb_build_object('ok', true), 'demande', 0,
                     'emails', jsonb_build_object('paiement', 1, 'client', 1, 'recurso', 0)),
  'W4 : nuit déjà bookée (ancien flux) → aucune demande, e-mails comme avant (compatibilité du code en production)');
select is(
  (select jsonb_build_object('statut', status, 'essais', attempts, 'due', next_attempt_at = now(), 'clos', processed_at)
     from pms_booking_requests where order_id = t_id('1104')),
  jsonb_build_object('statut', 'pending', 'essais', 0, 'due', true, 'clos', null),
  'W5 : une demande close (done) est réarmée : pending, 0 tentative, due maintenant');
select is(
  (select jsonb_build_object('statut', status, 'essais', attempts, 'erreur', last_error) from pms_booking_requests where order_id = t_id('1105')),
  jsonb_build_object('statut', 'failed', 'essais', 2, 'erreur', 'refus'),
  'W6 : une demande failed (un humain la tient) n''est jamais réarmée');
select is(
  jsonb_build_object('r', (select r from t_w6), 'commande', (select payment_status from orders where id = t_id('1106')),
                     'demande', (select status from pms_booking_requests where order_id = t_id('1106')),
                     'remboursement', (select count(*)::int from payment_reconciliation_entries where mp_payment_id = 'mp-la-6')),
  jsonb_build_object('r', jsonb_build_object('ok', true), 'commande', 'paid', 'demande', 'pending', 'remboursement', 0),
  'W7 : une nuit jamais tenue n''entraîne plus de remboursement (garde pms_booking_missing retirée) : payée, demande posée');

-- ── create_payment_intent (D3) ──────────────────────────────────────────────────────────────
-- 1201 tenue maintenant ; 1202 il y a 4 min 59 s ; 1203 il y a 5 min pile ; 1204 il y a 5 min 1 s ;
-- 1205 bookée sans tenue (ancien flux) ; 1206 deux nuits, l'une tenue, l'autre non.
select t_order('1201', 'unpaid');
select t_line('2201', '1201', '31', '2029-06-01', '2029-06-02', now());
select t_order('1202', 'unpaid');
select t_line('2202', '1202', '31', '2029-06-03', '2029-06-04', now() - interval '4 minutes 59 seconds');
select t_order('1203', 'unpaid');
select t_line('2203', '1203', '31', '2029-06-05', '2029-06-06', now() - interval '5 minutes');
select t_order('1204', 'unpaid');
select t_line('2204', '1204', '31', '2029-06-07', '2029-06-08', now() - interval '5 minutes 1 second');
select t_order('1205', 'unpaid');
select t_line('2205', '1205', '31', '2029-06-09', '2029-06-10', null, 'BK-LA-1205');
select t_order('1206', 'unpaid');
select t_line('2206', '1206', '31', '2029-06-11', '2029-06-12', now());
select t_line('2207', '1206', '31', '2029-06-13', '2029-06-14');
set local role authenticated;
select test_login(t_id('22'));
select is(
  array[create_payment_intent(t_id('1201')) ->> 'ok', create_payment_intent(t_id('1202')) ->> 'ok', create_payment_intent(t_id('1203')) ->> 'ok'],
  array['true', 'true', 'true'],
  'P1 : une nuit tenue maintenant, il y a 4 min 59 s, il y a 5 min pile → payable');
select is(create_payment_intent(t_id('1204')) ->> 'reason', 'pms_booking_missing',
  'P2 : tenue il y a plus de 5 min → pms_booking_missing (Lobby à revérifier)');
select is(create_payment_intent(t_id('1205')) ->> 'ok', 'true',
  'P3 : une nuit bookée (ancien flux) reste payable');
select is(create_payment_intent(t_id('1206')) ->> 'reason', 'pms_booking_missing',
  'P4 : une seule nuit non tenue suffit à refuser');
reset role;
select is((select count(*)::int from payments where order_id in (t_id('1204'), t_id('1206'))), 0,
  'P5 : un refus ne crée aucun paiement');

-- ── order_for_client_jsonb : pms_confirmation et WhatsApp (D9) ──────────────────────────────
-- Chaque commande porte une ligne locale (WhatsApp de 012) en plus de sa nuit PMS (WhatsApp de 011).
select t_order('1301', 'paid');        -- payée, nuit sans booking, aucune demande
select t_line('2301', '1301', '31', '2029-07-01', '2029-07-02', now());
select t_line('2302', '1301', '32', '2029-07-01', '2029-07-02');
select t_order('1302', 'paid');        -- demande en cours
select t_line('2303', '1302', '31', '2029-07-03', '2029-07-04', now());
select t_line('2304', '1302', '32', '2029-07-03', '2029-07-04');
insert into pms_booking_requests (order_id) values (t_id('1302'));
select t_order('1303', 'paid');        -- demande failed
select t_line('2305', '1303', '31', '2029-07-05', '2029-07-06', now());
select t_line('2306', '1303', '32', '2029-07-05', '2029-07-06');
insert into pms_booking_requests (order_id, status) values (t_id('1303'), 'failed');
select t_order('1304', 'paid');        -- demande needs_human
select t_line('2307', '1304', '31', '2029-07-07', '2029-07-08', now());
insert into pms_booking_requests (order_id, status) values (t_id('1304'), 'needs_human');
select t_order('1305', 'paid');        -- bookée, demande done
select t_line('2308', '1305', '31', '2029-07-09', '2029-07-10', now(), 'BK-LA-1305');
select t_line('2309', '1305', '32', '2029-07-09', '2029-07-10');
insert into pms_booking_requests (order_id, status) values (t_id('1305'), 'done');
select t_order('1306', 'unpaid');      -- pas payée
select t_line('2310', '1306', '31', '2029-07-11', '2029-07-12', now());
select t_order('1307', 'partially_refunded'); -- partiellement remboursée, nuit sans booking
select t_line('2311', '1307', '31', '2029-07-13', '2029-07-14', now());
select t_order('1308', 'paid');        -- nuit PMS annulée, ligne locale vivante
select t_line('2312', '1308', '31', '2029-07-15', '2029-07-16', now(), null, 'cancelled_by_client');
select t_line('2313', '1308', '32', '2029-07-15', '2029-07-16');

create function t_vue(p text) returns jsonb language sql as $$
  select jsonb_build_object(
    'confirmation', o2.j -> 'pms_confirmation',
    'whatsapp', (select jsonb_agg(l -> 'establishment_contact_phone' order by l ->> 'id') from jsonb_array_elements(o2.j -> 'lines') l))
    from (select order_for_client_jsonb(o) as j from orders o where o.id = t_id(p)) o2;
$$;
select is(t_vue('1301'), jsonb_build_object('confirmation', 'pending', 'whatsapp', jsonb_build_array(null, null)),
  'O1 : payée, nuit sans booking, aucune demande → pending ; AUCUN WhatsApp, même celui de la ligne locale');
select is(t_vue('1302') -> 'confirmation', '"pending"'::jsonb, 'O2 : demande en cours → pending');
select is(t_vue('1303'), jsonb_build_object('confirmation', 'failed', 'whatsapp', jsonb_build_array(null, null)),
  'O3 : demande failed → failed, WhatsApp masqué');
select is(t_vue('1304') -> 'confirmation', '"failed"'::jsonb, 'O4 : demande needs_human → failed');
select is(t_vue('1305'), jsonb_build_object('confirmation', null, 'whatsapp', jsonb_build_array('+573001112233', '+573004445566')),
  'O5 : bookée, demande done → null, chaque WhatsApp visible');
select is(t_vue('1306') -> 'confirmation', 'null'::jsonb, 'O6 : commande non payée → null (jamais pending)');
select is(t_vue('1307') -> 'confirmation', '"pending"'::jsonb, 'O7 : partiellement remboursée, nuit sans booking → pending');
select is(t_vue('1308'), jsonb_build_object('confirmation', null, 'whatsapp', jsonb_build_array(null, '+573004445566')),
  'O8 : la nuit PMS annulée ne compte plus → null, le WhatsApp de la ligne vivante visible');
select is(
  (select order_for_client_jsonb(o) #>> '{lines,0,id}' from orders o where o.id = t_id('1305')),
  t_id('2308')::text,
  'O9 : l''ordre des lignes est inchangé (`lines,0`)');

-- ── create_order : l'e-mail 8 sans rien à payer ─────────────────────────────────────────────
insert into cart_items (account_id, product_id, date, qty) values (t_id('22'), t_id('35'), '2029-11-20', 2);
set local role authenticated;
select test_login(t_id('22'));
create temp table t_co1 as select create_order('LA Holder Gratis', 'la-gratis@test.local') as r;
reset role;
select is(
  (select count(*)::int from notification_emails n join order_lines ol on ol.id = n.related_id
    where n.event_type = 'partner_camp_evento_blocked' and ol.order_id = ((select r ->> 'order_id' from t_co1))::uuid
      and n.recipient_account_id = t_id('21')),
  1,
  'C1 : un evento gratuit qui occupe la ressource → l''e-mail 8 part dès la création (rien à payer en ligne)');
insert into cart_items (account_id, product_id, date, qty) values
  (t_id('22'), t_id('35'), '2029-11-20', 1),
  (t_id('22'), t_id('33'), '2029-11-20', 1);
set local role authenticated;
select test_login(t_id('22'));
create temp table t_co2 as select create_order('LA Holder Mixta', 'la-mixta@test.local') as r;
reset role;
select is(
  jsonb_build_object('ok', (select r ->> 'ok' from t_co2),
                     'recurso', (select count(*)::int from notification_emails n join order_lines ol on ol.id = n.related_id
                                  where n.event_type = 'partner_camp_evento_blocked'
                                    and ol.order_id = ((select r ->> 'order_id' from t_co2))::uuid)),
  jsonb_build_object('ok', 'true', 'recurso', 0),
  'C2 : evento gratuit + activité payante → un acompte est dû, l''e-mail 8 attend la confirmation');

-- ── resolve_pms_cancellation_restricted ─────────────────────────────────────────────────────
select t_order('1401', 'paid');
select t_line('2401', '1401', '31', '2029-08-01', '2029-08-02', now(), 'BK-LA-R1', 'cancelled_by_client');
insert into pms_cancellation_queue (id, pms_booking_id, establishment_id, hifago_status)
values (t_id('5001'), 'BK-LA-R1', t_id('11'), 'cancelled_by_client'),
       (t_id('5003'), 'BK-LA-NONE', t_id('11'), 'cancelled_by_client');
select ok(
  not has_function_privilege('anon', 'public.resolve_pms_cancellation_restricted(uuid, int, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.resolve_pms_cancellation_restricted(uuid, int, text)', 'execute')
  and has_function_privilege('service_role', 'public.resolve_pms_cancellation_restricted(uuid, int, text)', 'execute'),
  'X1 : resolve_pms_cancellation_restricted à service_role seul');
set local role service_role;
select resolve_pms_cancellation_restricted(t_id('5001'), 422, '422 RESTRICTED_RESERVATION');
reset role;
select is(
  (select jsonb_build_object('statut', status, 'code', lobby_status_code, 'erreur', last_error, 'clos', processed_at = now())
     from pms_cancellation_queue where id = t_id('5001')),
  jsonb_build_object('statut', 'done', 'code', 422, 'erreur', '422 RESTRICTED_RESERVATION', 'clos', true),
  'X2 : l''entrée de file est close (done), le refus de Lobby gardé');
select is(
  (select array_agg(detail) from pms_reconciliation_entries where order_line_id = t_id('2401') and status = 'open'),
  array['annuler à la main dans Lobby : le booking BK-LA-R1 porte un paiement (RESTRICTED_RESERVATION) — commande LA-1401 — 422 RESTRICTED_RESERVATION'],
  'X3 : UNE entrée de réconciliation « annuler à la main dans Lobby » sur la ligne qui porte le booking');
select is(
  (select count(*)::int from notification_emails n join pms_reconciliation_entries e on e.id = n.related_id
    where n.event_type = 'admin_new_reconciliation_exception' and e.order_line_id = t_id('2401') and n.recipient_account_id = t_id('23')),
  1, 'X4 : l''admin reçoit l''e-mail 3');
insert into pms_cancellation_queue (id, pms_booking_id, establishment_id, hifago_status)
values (t_id('5002'), 'BK-LA-R1', t_id('11'), 'cancelled_by_client');
set local role service_role;
select resolve_pms_cancellation_restricted(t_id('5002'), 422, '422 RESTRICTED_RESERVATION');
select resolve_pms_cancellation_restricted(t_id('5003'), 422, '422 RESTRICTED_RESERVATION');
select lives_ok($$ select resolve_pms_cancellation_restricted('00000000-0000-4000-8000-000000000000', 422, 'x') $$,
  'X5 : une entrée inconnue → rien, sans erreur');
reset role;
select is(
  jsonb_build_object(
    'entrees_r1', (select count(*)::int from pms_reconciliation_entries where order_line_id = t_id('2401')),
    'file_r1', (select status from pms_cancellation_queue where id = t_id('5002')),
    'file_sans_ligne', (select status from pms_cancellation_queue where id = t_id('5003'))),
  jsonb_build_object('entrees_r1', 1, 'file_r1', 'done', 'file_sans_ligne', 'done'),
  'X6 : jamais une seconde entrée ouverte pour le même booking ; sans ligne qui le porte, la file seule est close');

select * from finish();
rollback;
