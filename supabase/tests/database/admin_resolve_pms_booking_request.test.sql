-- Lobby après l'acompte, reprise admin (migration 20261023150000) — admin_resolve_pms_booking_request
-- (retry / confirm / cancel d'une demande pms_booking_requests failed / needs_human) et
-- admin_pms_booking_requests (la lecture de /admin/reconciliation).
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - droits : anon refusé par le grant, authenticated non admin (même l'operator de l'établissement)
--     refusé par le garde (42501), admin accepté ; has_function_privilege des deux fonctions ;
--   - lecture : les demandes des commandes demandées, et seulement elles, colonnes exactes ;
--   - refus typés, rien d'écrit : demande inconnue, demande qui n'est ni failed ni needs_human
--     (pending, done, cancelled), bookings mal formés, ligne d'une autre commande, ligne déjà bookée
--     par un AUTRE id, ligne morte, ligne sans lien Lobby ; action inconnue et bookings hors confirm
--     lèvent ;
--   - confirm : chaque id saisi posé sur sa ligne (pms_booked_at jamais antérieur à l'époque du jeton,
--     pms_recorded_at), un id identique idempotent ; les nuits PMS restées sans booking ne sont plus
--     tenues ni marquées et ne comptent plus « en vol » (un second hold sur la dernière unité passe) ;
--     demande done (erreur gardée) ; e-mails 5/6/7/8 UNE fois (un second confirm → not_resolvable,
--     resolve 'done' → not_pending, toujours une) ; pms_confirmation failed → null ; entrées
--     « commande PAYÉE — Lobby a refusé » ouvertes résolues ; « remise à saisir » et « issue inconnue »
--     restent ouvertes (tâches à part) ; jamais « jeton Lobby remplacé » ni une entrée d'activité ; journal d'audit ;
--   - cancel : demande cancelled (erreur gardée), lignes sans booking plus tenues ni marquées, AUCUNE
--     ligne annulée, aucun e-mail, entrées résolues, pms_confirmation null, journal ;
--   - retry : demande pending, 0 tentative, due, erreur et clôture effacées ; marqueur effacé sur les
--     seules lignes réservées sans booking, nuits toujours tenues ; entrées laissées ouvertes ; UN
--     appel de pms-book-paid-orders (trigger) ; pms_confirmation pending ; journal ; la demande est
--     réclamée de nouveau (claim_pms_booking_requests) et le claim de la commande passe.
begin;
select plan(50);

create function t_id(p text) returns uuid language sql as $$
  select ('7e150000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid;
$$;
create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Sans secrets Vault pendant les fixtures : le trigger de la file avertit et n'appelle rien.
delete from vault.secrets where name in ('pms_functions_base_url', 'pms_service_role_key');

insert into partners (id, display_name) values
  (t_id('1'), 'Reprise Owner'),
  (t_id('2'), 'Reprise Referrer');
-- 011 : connecteur actif ; 012 : sans connecteur (logement local) ; 013 : actif, son époque de jeton
-- sera datée juste avant le confirm (pms_booked_at ne doit jamais la précéder).
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
  (t_id('11'), t_id('1'), jsonb_build_object('es', 'Reprise Uno'), true, 'tok-reprise-1'),
  (t_id('12'), t_id('1'), jsonb_build_object('es', 'Reprise Local'), false, null),
  (t_id('13'), t_id('1'), jsonb_build_object('es', 'Reprise Tres'), true, 'tok-reprise-3');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id, lobby_product_id, duration_days) values
  (t_id('31'), t_id('1'), t_id('11'), 'lodging', jsonb_build_object('es', 'Reprise Noche'), 100000, true, 'reprise-noche', 7601, null, null),
  (t_id('32'), t_id('1'), t_id('11'), 'camp', jsonb_build_object('es', 'Reprise Campamento'), 90000, true, 'reprise-camp', null, null, 2),
  (t_id('33'), t_id('1'), t_id('11'), 'activity', jsonb_build_object('es', 'Reprise Actividad'), 50000, true, 'reprise-act', null, 8601, null),
  (t_id('34'), t_id('1'), t_id('12'), 'lodging', jsonb_build_object('es', 'Reprise Cabaña'), 100000, true, 'reprise-cabana', null, null, null),
  (t_id('35'), t_id('1'), t_id('11'), 'lodging', jsonb_build_object('es', 'Reprise Noche Dos'), 100000, true, 'reprise-noche-dos', 7602, null, null),
  (t_id('36'), t_id('1'), t_id('13'), 'lodging', jsonb_build_object('es', 'Reprise Noche Tres'), 100000, true, 'reprise-noche-tres', 7603, null, null);
insert into auth.users (id, email) values
  (t_id('21'), 'reprise-owner@test.local'),
  (t_id('22'), 'reprise-referrer@test.local'),
  (t_id('23'), 'reprise-admin@test.local'),
  (t_id('24'), 'reprise-buyer@test.local'),
  (t_id('25'), 'reprise-other@test.local');
update partner_accounts set partner_id = t_id('1') where id = t_id('21');
update partner_accounts set partner_id = t_id('2') where id = t_id('22');
insert into partner_capabilities (account_id, role, source, status) values (t_id('23'), 'admin', 'migration', 'active');
-- Le compte du propriétaire est aussi l'operator de l'établissement des commandes : refusé quand même.
insert into partner_capabilities (partner_id, role, establishment_id, source, status) values
  (t_id('1'), 'referrer', null, 'migration', 'active'),
  (t_id('1'), 'operator', t_id('11'), 'migration', 'active');

create function t_order(p text, p_status text default 'paid') returns void language sql as $$
  insert into orders (id, account_id, holder_name, holder_email, payment_status, reference)
  values (t_id(p), t_id('24'), 'Reprise Holder', 'reprise-client-' || p || '@test.local', p_status, 'RPR-' || p);
$$;
-- p_held : tenue il y a 20 min ; p_marked : marqueur de tentative posé il y a 19 min.
create function t_line(p text, p_order text, p_product text, p_date date, p_end date,
                       p_status text default 'reserved', p_held boolean default true,
                       p_booking text default null, p_marked boolean default false,
                       p_case text default 'direct', p_referrer uuid default null) returns void language sql as $$
  insert into order_lines (
    id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
    price_cop, total_cop, commission_case, referrer_partner_id, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop, pms_held_at, pms_booking_id, pms_attempt_started_at
  ) values (
    t_id(p), t_id(p_order), t_id('24'), t_id(p_product), p_date, p_end, 1, p_status, 'Reprise Holder',
    100000, 100000, p_case, p_referrer, 0.17,
    case when p_case = 'external_referrer' then 0.08 else 0 end,
    case when p_case = 'external_referrer' then 0.09 else 0.17 end,
    17000, case when p_case = 'external_referrer' then 8000 else 0 end,
    case when p_case = 'external_referrer' then 9000 else 17000 end,
    case when p_held then now() - interval '20 minutes' end, p_booking,
    case when p_marked then now() - interval '19 minutes' end
  );
$$;
-- Une demande close a son processed_at ; une demande pending n'est due que dans 1 h (aucun appel).
create function t_request(p text, p_order text, p_status text, p_attempts int default 1, p_error text default null)
returns void language sql as $$
  insert into pms_booking_requests (id, order_id, status, attempts, last_error, next_attempt_at, processed_at)
  values (t_id(p), t_id(p_order), p_status, p_attempts, p_error, now() + interval '1 hour',
          case when p_status <> 'pending' then now() - interval '10 minutes' end);
$$;
create function t_entry(p text, p_line text, p_detail text, p_status text default 'open') returns void language sql as $$
  insert into pms_reconciliation_entries (id, order_line_id, detail, status) values (t_id(p), t_id(p_line), p_detail, p_status);
$$;
create function t_emails(p_order text) returns jsonb language sql as $$
  select jsonb_build_object(
    'commission', (select count(*)::int from notification_emails where event_type = 'partner_commission_earned' and related_id = t_id(p_order)),
    'paiement', (select count(*)::int from notification_emails where event_type = 'partner_payment_confirmed' and related_id = t_id(p_order)),
    'client', (select count(*)::int from notification_emails where event_type = 'client_order_confirmed' and related_id = t_id(p_order)),
    'recurso', (select count(*)::int from notification_emails n join order_lines ol on ol.id = n.related_id
                 where n.event_type = 'partner_camp_evento_blocked' and n.related_table = 'order_lines' and ol.order_id = t_id(p_order)));
$$;
create function t_confirmation(p_order text) returns text language sql as $$
  select order_for_client_jsonb(o) ->> 'pms_confirmation' from orders o where o.id = t_id(p_order);
$$;
create function t_hold_b() returns jsonb language sql as $$
  select public.hold_pms_nights(t_id('1010'),
    jsonb_build_object(t_id('11')::text, jsonb_build_object('7602', jsonb_build_object('2030-05-01', 1))), now());
$$;

-- 1001 — confirm avec bookings : une nuit marquée qui reçoit 880001 (établissement 013), une nuit déjà
-- bookée 880002 (rejouée à l'identique), une nuit marquée relogée hors Lobby, un camp (e-mail 8), une
-- activité référée (e-mail 5). Entrées : « issue inconnue », « remise à saisir », « commande PAYÉE »
-- en retrying → résolues ; « jeton Lobby remplacé », une entrée d'activité → ouvertes ; une entrée
-- déjà résolue → intacte.
select t_order('1001');
select t_line('2001', '1001', '36', '2030-01-10', '2030-01-12', 'reserved', true, null, true);
select t_line('2015', '1001', '36', '2030-01-12', '2030-01-13', 'reserved', true, '880002', false);
select t_line('2002', '1001', '31', '2030-01-10', '2030-01-12', 'reserved', true, null, true);
select t_line('2003', '1001', '32', '2030-01-10', null, 'reserved', false);
select t_line('2004', '1001', '33', '2030-01-11', null, 'reserved', false, null, false, 'external_referrer', t_id('2'));
select t_request('3001', '1001', 'needs_human', 3, 'POST /bookings sans réponse');
select t_entry('4001', '2001', 'commande PAYÉE — issue inconnue — booking PEUT-ÊTRE créé chez Lobby, à vérifier par la note « hifago order_line … »');
select t_entry('4002', '2002', 'remise à saisir à la main dans Lobby : le booking 1 a été créé SANS le paiement de 17000 COP');
select t_entry('4003', '2001', 'jeton Lobby remplacé le 2030-01-01 00:00 (heure de Colombie) : booking Lobby 1 posé avec l''ancien jeton');
select t_entry('4004', '2004', 'add-product-service refusé — HTTP 422');
select t_entry('4005', '2002', 'commande PAYÉE — Lobby a refusé — reloger ou rembourser à la main : 422 (commande RPR-1001)', 'resolved');
select t_entry('4006', '2002', 'commande PAYÉE — Lobby a refusé — reloger ou rembourser à la main : 422 bis (commande RPR-1001)', 'retrying');
-- 1002 — cancel : une nuit marquée sans booking, une nuit bookée (marquée), une nuit morte tenue.
select t_order('1002');
select t_line('2005', '1002', '31', '2030-02-10', '2030-02-11', 'reserved', true, null, true);
select t_line('2006', '1002', '31', '2030-02-12', '2030-02-13', 'reserved', true, '880003', true);
select t_line('2007', '1002', '31', '2030-02-14', '2030-02-15', 'cancelled_by_client', true, null, false);
select t_request('3002', '1002', 'failed', 2, '422 refus');
select t_entry('4007', '2005', 'commande PAYÉE — Lobby a refusé — reloger ou rembourser à la main : 422 refus (commande RPR-1002)');
-- 1003 — retry : une nuit marquée sans booking ; une nuit morte marquée et une nuit bookée marquée
-- (marqueurs gardés).
select t_order('1003');
select t_line('2008', '1003', '31', '2030-03-10', '2030-03-11', 'reserved', true, null, true);
select t_line('2009', '1003', '31', '2030-03-12', '2030-03-13', 'cancelled_by_client', true, null, true);
select t_line('2010', '1003', '31', '2030-03-14', '2030-03-15', 'reserved', true, '880004', true);
select t_request('3003', '1003', 'failed', 6, 'aucun booking après 6 tentatives — dernière erreur : panne');
select t_entry('4008', '2008', 'commande PAYÉE — Lobby a refusé — reloger ou rembourser à la main : panne (commande RPR-1003)');
-- 1004 à 1006 : demandes qu'aucun humain ne tient.
select t_order('1004');
select t_request('3004', '1004', 'pending', 1);
select t_order('1005');
select t_request('3005', '1005', 'done', 1);
select t_order('1006');
select t_request('3006', '1006', 'cancelled', 1);
-- 1007 — refus de validation : une nuit libre, une nuit bookée 770001, une nuit expirée, un logement
-- local ; 1008 : une autre commande.
select t_order('1007');
select t_line('2011', '1007', '31', '2030-04-10', '2030-04-11');
select t_line('2012', '1007', '31', '2030-04-12', '2030-04-13', 'reserved', true, '770001', false);
select t_line('2013', '1007', '31', '2030-04-14', '2030-04-15', 'expired', true, null, false);
select t_line('2014', '1007', '34', '2030-04-10', '2030-04-11', 'reserved', false);
select t_request('3007', '1007', 'needs_human', 1, 'issue inconnue');
select t_order('1008');
select t_line('2016', '1008', '31', '2030-04-20', '2030-04-21');
-- 1009 / 1010 — « en vol » : A (1009) tient la dernière unité de 7602 le 2030-05-01, sans booking,
-- demande needs_human ; B (1010), non payée, la demande.
select t_order('1009');
select t_line('2017', '1009', '35', '2030-05-01', '2030-05-02', 'reserved', true, null, true);
select t_request('3009', '1009', 'needs_human', 1, 'POST /bookings sans réponse');
select t_order('1010', 'unpaid');
select t_line('2018', '1010', '35', '2030-05-01', '2030-05-02', 'reserved', false);

-- ── Droits ───────────────────────────────────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.admin_resolve_pms_booking_request(uuid, text, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_resolve_pms_booking_request(uuid, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.admin_pms_booking_requests(uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.admin_pms_booking_requests(uuid[])', 'execute'),
  'G1 : les deux RPC admin sont exécutables par authenticated (garde interne), jamais par anon');
set local role anon;
select throws_ok($$ select public.admin_resolve_pms_booking_request('7e150000-0000-4000-8000-000000003001', 'confirm') $$,
  '42501', null, 'G2 : un appel anonyme est refusé par le grant (42501)');
reset role;
set local role authenticated;
select test_login(t_id('25'));
select throws_ok($$ select admin_resolve_pms_booking_request(t_id('3001'), 'confirm') $$,
  '42501', 'admin_resolve_pms_booking_request réservé au rôle admin', 'G3 : un compte authentifié non admin est refusé (42501)');
select test_login(t_id('21'));
select throws_ok($$ select admin_resolve_pms_booking_request(t_id('3001'), 'cancel') $$,
  '42501', 'admin_resolve_pms_booking_request réservé au rôle admin', 'G4 : l''operator de l''établissement de la commande aussi');
select throws_ok($$ select * from admin_pms_booking_requests(array[t_id('1001')]) $$,
  '42501', 'admin_pms_booking_requests réservé au rôle admin', 'G5 : la lecture des demandes est refusée à un non admin');
reset role;
select is(
  jsonb_build_object('statut', (select status from pms_booking_requests where id = t_id('3001')),
                     'audit', (select count(*)::int from audit_log where entity_id = t_id('3001'))),
  jsonb_build_object('statut', 'needs_human', 'audit', 0),
  'G6 : un refus de droit n''écrit rien');

-- ── Lecture (admin) ──────────────────────────────────────────────────────────────────────────
set local role authenticated;
select test_login(t_id('23'));
select is(
  (select jsonb_agg(jsonb_build_object('demande', request_id, 'commande', order_id, 'statut', status, 'essais', attempts,
                                       'erreur', last_error) order by order_id)
     from admin_pms_booking_requests(array[t_id('1001'), t_id('1004'), t_id('1008'), '00000000-0000-4000-8000-000000000000'::uuid])),
  jsonb_build_array(
    jsonb_build_object('demande', t_id('3001'), 'commande', t_id('1001'), 'statut', 'needs_human', 'essais', 3, 'erreur', 'POST /bookings sans réponse'),
    jsonb_build_object('demande', t_id('3004'), 'commande', t_id('1004'), 'statut', 'pending', 'essais', 1, 'erreur', null)),
  'L1 : les demandes des commandes demandées, et seulement elles (une commande sans demande ne rend rien)');
reset role;
select is(
  (select array_agg(a.n order by a.o)
     from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
    where p.oid = 'public.admin_pms_booking_requests(uuid[])'::regprocedure and a.m = 't'),
  array['request_id', 'order_id', 'status', 'attempts', 'last_error', 'updated_at']::text[],
  'L2 : les colonnes rendues, exactement');

-- ── Refus typés ──────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select test_login(t_id('23'));
select is(
  array[admin_resolve_pms_booking_request('00000000-0000-4000-8000-000000000000', 'confirm'),
        admin_resolve_pms_booking_request(null, 'retry')],
  array[jsonb_build_object('ok', false, 'reason', 'request_not_found'), jsonb_build_object('ok', false, 'reason', 'request_not_found')],
  'R1 : une demande inconnue (ou nulle) → request_not_found');
select is(
  array[admin_resolve_pms_booking_request(t_id('3004'), 'retry'),
        admin_resolve_pms_booking_request(t_id('3005'), 'confirm'),
        admin_resolve_pms_booking_request(t_id('3006'), 'cancel')],
  array[jsonb_build_object('ok', false, 'reason', 'not_resolvable', 'status', 'pending'),
        jsonb_build_object('ok', false, 'reason', 'not_resolvable', 'status', 'done'),
        jsonb_build_object('ok', false, 'reason', 'not_resolvable', 'status', 'cancelled')],
  'R2 : une demande en cours ou close ne se reprend pas → not_resolvable, avec son statut');
select throws_ok($$ select admin_resolve_pms_booking_request(t_id('3007'), 'reintentar') $$,
  'P0001', null, 'R3 : une action inconnue lève');
select throws_ok(
  $$ select admin_resolve_pms_booking_request(t_id('3007'), 'retry',
       jsonb_build_array(jsonb_build_object('order_line_id', t_id('2011'), 'pms_booking_id', '1'))) $$,
  'P0001', null, 'R4 : des bookings hors confirm lèvent');
select is(
  array[admin_resolve_pms_booking_request(t_id('3007'), 'confirm', jsonb_build_object('order_line_id', t_id('2011'), 'pms_booking_id', '1')) ->> 'reason',
        admin_resolve_pms_booking_request(t_id('3007'), 'confirm', jsonb_build_array(jsonb_build_object('order_line_id', t_id('2011')))) ->> 'reason',
        admin_resolve_pms_booking_request(t_id('3007'), 'confirm', jsonb_build_array(jsonb_build_object('order_line_id', t_id('2011'), 'pms_booking_id', '   '))) ->> 'reason',
        admin_resolve_pms_booking_request(t_id('3007'), 'confirm', jsonb_build_array(jsonb_build_object('order_line_id', t_id('2011'), 'pms_booking_id', 'BK-12'))) ->> 'reason',
        admin_resolve_pms_booking_request(t_id('3007'), 'confirm', jsonb_build_array(jsonb_build_object('order_line_id', 'pas-un-uuid', 'pms_booking_id', '12'))) ->> 'reason',
        admin_resolve_pms_booking_request(t_id('3007'), 'confirm', jsonb_build_array(jsonb_build_object('order_line_id', t_id('2011'), 'pms_booking_id', 12))) ->> 'reason',
        admin_resolve_pms_booking_request(t_id('3007'), 'confirm', jsonb_build_array('12')) ->> 'reason',
        admin_resolve_pms_booking_request(t_id('3007'), 'confirm', jsonb_build_array(
          jsonb_build_object('order_line_id', t_id('2011'), 'pms_booking_id', '12'),
          jsonb_build_object('order_line_id', t_id('2011'), 'pms_booking_id', '13'))) ->> 'reason'],
  array['invalid_bookings', 'invalid_bookings', 'invalid_bookings', 'invalid_bookings',
        'invalid_bookings', 'invalid_bookings', 'invalid_bookings', 'invalid_bookings'],
  'R5 : bookings mal formés (pas un tableau, sans id, id vide, id non numérique, ligne non uuid, id non texte, élément non objet, ligne en double) → invalid_bookings');
select is(admin_resolve_pms_booking_request(t_id('3007'), 'confirm',
            jsonb_build_array(jsonb_build_object('order_line_id', t_id('2016'), 'pms_booking_id', '12'))),
  jsonb_build_object('ok', false, 'reason', 'line_not_in_order', 'order_line_id', t_id('2016')),
  'R6 : la ligne d''une autre commande → line_not_in_order');
select is(admin_resolve_pms_booking_request(t_id('3007'), 'confirm',
            jsonb_build_array(jsonb_build_object('order_line_id', t_id('2011'), 'pms_booking_id', '12'),
                              jsonb_build_object('order_line_id', t_id('2012'), 'pms_booking_id', '770002'))),
  jsonb_build_object('ok', false, 'reason', 'already_booked', 'order_line_id', t_id('2012'), 'pms_booking_id', '770001'),
  'R7 : une ligne qui porte un AUTRE booking → already_booked (jamais écrasé), même après une ligne valide');
select is(admin_resolve_pms_booking_request(t_id('3007'), 'confirm',
            jsonb_build_array(jsonb_build_object('order_line_id', t_id('2013'), 'pms_booking_id', '12'))),
  jsonb_build_object('ok', false, 'reason', 'line_not_reserved', 'order_line_id', t_id('2013'), 'status', 'expired'),
  'R8 : une ligne morte → line_not_reserved');
select is(admin_resolve_pms_booking_request(t_id('3007'), 'confirm',
            jsonb_build_array(jsonb_build_object('order_line_id', t_id('2014'), 'pms_booking_id', '12'))),
  jsonb_build_object('ok', false, 'reason', 'line_not_pms', 'order_line_id', t_id('2014')),
  'R9 : une ligne sans lien Lobby (logement local) → line_not_pms');
reset role;
select is(
  jsonb_build_object('statut', (select status from pms_booking_requests where id = t_id('3007')),
                     'ligne', (select jsonb_build_object('booking', pms_booking_id, 'tenue', pms_held_at is not null) from order_lines where id = t_id('2011')),
                     'audit', (select count(*)::int from audit_log where entity_id = t_id('3007'))),
  jsonb_build_object('statut', 'needs_human', 'ligne', jsonb_build_object('booking', null, 'tenue', true), 'audit', 0),
  'R10 : aucun refus n''écrit quoi que ce soit (demande, ligne, journal)');

-- ── Avant les reprises ───────────────────────────────────────────────────────────────────────
select is(array[t_confirmation('1001'), t_confirmation('1002'), t_confirmation('1003')],
  array['failed', 'failed', 'failed'], 'B1 : avant reprise, chaque commande payée est « failed » pour le client');
select is(t_emails('1001'), jsonb_build_object('commission', 0, 'paiement', 0, 'client', 0, 'recurso', 0),
  'B2 : avant reprise, aucun e-mail de confirmation');
set local role service_role;
select is(t_hold_b(),
  jsonb_build_object('ok', false, 'reason', 'full', 'line_id', t_id('2018'), 'night', '2030-05-01',
                     'available', 1, 'in_flight', 1, 'requested', 1, 'lobby_category_id', 7602),
  'B3 : la nuit needs_human de A compte « en vol » : B est refusée sur la dernière unité');
reset role;

-- ── confirm (1001) ───────────────────────────────────────────────────────────────────────────
-- L'époque du jeton de 013 est datée APRÈS le début de la transaction (un remplacement commité
-- pendant notre attente) : le booking saisi ne doit jamais passer pour « ancien ».
update establishments set lobby_token_changed_at = clock_timestamp() where id = t_id('13');
set local role authenticated;
select test_login(t_id('23'));
select is(admin_resolve_pms_booking_request(t_id('3001'), 'confirm', jsonb_build_array(
            jsonb_build_object('order_line_id', t_id('2001'), 'pms_booking_id', '880001'),
            jsonb_build_object('order_line_id', t_id('2015'), 'pms_booking_id', ' 880002 '))),
  jsonb_build_object('ok', true, 'status', 'done', 'bookings_recorded', 1, 'lines_released', 1,
                     'markers_cleared', 0, 'entries_resolved', 1),
  'C1 : confirm → done ; un booking posé, un identique idempotent, une nuit relâchée, trois entrées résolues');
reset role;
select is(
  (select jsonb_build_object('booking', ol.pms_booking_id, 'epoque', ol.pms_booked_at > e.lobby_token_changed_at,
                             'enregistre', ol.pms_recorded_at >= now(), 'tenue', ol.pms_held_at is not null,
                             'pas_ancien', not (coalesce(ol.pms_booked_at, ol.created_at) < e.lobby_token_changed_at))
     from order_lines ol join products p on p.id = ol.product_id join establishments e on e.id = p.establishment_id
    where ol.id = t_id('2001')),
  jsonb_build_object('booking', '880001', 'epoque', true, 'enregistre', true, 'tenue', true, 'pas_ancien', true),
  'C2 : l''id saisi est posé par le chemin de record_pms_booking — jamais antérieur à l''époque du jeton, heure réelle notée');
select is(
  (select jsonb_build_object('booking', pms_booking_id, 'claim', pms_booked_at, 'enregistre', pms_recorded_at) from order_lines where id = t_id('2015')),
  jsonb_build_object('booking', '880002', 'claim', null, 'enregistre', null),
  'C2b : le booking identique (espaces autour) n''est pas réécrit');
select is(
  (select jsonb_build_object('statut', status, 'booking', pms_booking_id, 'tenue', pms_held_at, 'marqueur', pms_attempt_started_at)
     from order_lines where id = t_id('2002')),
  jsonb_build_object('statut', 'reserved', 'booking', null, 'tenue', null, 'marqueur', null),
  'C3 : la nuit relogée hors Lobby n''est plus tenue ni marquée, et reste réservée');
select is(
  (select jsonb_build_object('statut', status, 'essais', attempts, 'erreur', last_error, 'clos', processed_at = now())
     from pms_booking_requests where id = t_id('3001')),
  jsonb_build_object('statut', 'done', 'essais', 3, 'erreur', 'POST /bookings sans réponse', 'clos', true),
  'C4 : la demande est close (done), son erreur gardée');
select is(t_emails('1001'), jsonb_build_object('commission', 1, 'paiement', 1, 'client', 1, 'recurso', 1),
  'C5 : les e-mails 5 (référent), 6 (propriétaire), 7 (client) et 8 (camp) partent, une fois chacun');
select is(
  (select jsonb_object_agg(right(id::text, 4), jsonb_build_object('statut', status, 'par', resolved_by, 'note', resolution_note,
                                                                  'quand', resolved_at = now()))
     from pms_reconciliation_entries where id in (t_id('4001'), t_id('4002'), t_id('4006'))),
  jsonb_build_object(
    -- « issue inconnue » et « remise à saisir » : vraies tâches séparées, elles RESTENT ouvertes.
    '4001', jsonb_build_object('statut', 'open', 'par', null, 'note', null, 'quand', null),
    '4002', jsonb_build_object('statut', 'open', 'par', null, 'note', null, 'quand', null),
    '4006', jsonb_build_object('statut', 'resolved', 'par', t_id('23'), 'note', 'résolue par confirm de la demande ' || t_id('3001') || ' (reprise admin, commande RPR-1001)', 'quand', true)),
  'C6 : seule « commande PAYÉE — Lobby a refusé » (retrying) est résolue ; « remise à saisir » et « issue inconnue » restent ouvertes');
select is(
  (select jsonb_object_agg(right(id::text, 4), jsonb_build_object('statut', status, 'par', resolved_by))
     from pms_reconciliation_entries where id in (t_id('4003'), t_id('4004'), t_id('4005'))),
  jsonb_build_object('4003', jsonb_build_object('statut', 'open', 'par', null),
                     '4004', jsonb_build_object('statut', 'open', 'par', null),
                     '4005', jsonb_build_object('statut', 'resolved', 'par', null)),
  'C7 : jamais « jeton Lobby remplacé » ni une entrée d''activité ; une entrée déjà résolue reste intacte');
select is(t_confirmation('1001'), null, 'C8 : pms_confirmation n''est plus « failed » (null : confirmée)');
select is(
  (select jsonb_build_object('n', count(*), 'acteur', min(actor_id::text), 'action', min(action), 'table', min(entity_table),
                             'avant', min(before::text)::jsonb, 'apres', min(after ->> 'status'),
                             'note', bool_and(note like 'réservation résolue à la main%RPR-1001'))
     from audit_log where entity_id = t_id('3001')),
  jsonb_build_object('n', 1, 'acteur', t_id('23')::text, 'action', 'pms_booking_request.confirm', 'table', 'pms_booking_requests',
                     'avant', jsonb_build_object('status', 'needs_human', 'attempts', 3, 'last_error', 'POST /bookings sans réponse'),
                     'apres', 'done', 'note', true),
  'C9 : une ligne d''audit nominative, ciblant la demande');
set local role authenticated;
select test_login(t_id('23'));
select is(admin_resolve_pms_booking_request(t_id('3001'), 'confirm'),
  jsonb_build_object('ok', false, 'reason', 'not_resolvable', 'status', 'done'), 'C10 : un second confirm → not_resolvable');
reset role;
set local role service_role;
select is(resolve_pms_booking_request(t_id('3001'), 'done'),
  jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', 'done'),
  'C11 : un passage tardif de l''Edge Function (done) → not_pending');
reset role;
select is(t_emails('1001'), jsonb_build_object('commission', 1, 'paiement', 1, 'client', 1, 'recurso', 1),
  'C12 : toujours UN e-mail de chaque après ces deux tentatives');

-- ── confirm sans booking (1009) : la nuit ne compte plus « en vol » ──────────────────────────
set local role authenticated;
select test_login(t_id('23'));
select is(admin_resolve_pms_booking_request(t_id('3009'), 'confirm'),
  jsonb_build_object('ok', true, 'status', 'done', 'bookings_recorded', 0, 'lines_released', 1,
                     'markers_cleared', 0, 'entries_resolved', 0),
  'H1 : confirm sans booking saisi (relogée hors Lobby) → done, une nuit relâchée');
reset role;
select is(
  (select jsonb_build_object('tenue', pms_held_at, 'marqueur', pms_attempt_started_at) from order_lines where id = t_id('2017')),
  jsonb_build_object('tenue', null, 'marqueur', null), 'H2 : la nuit de A n''est plus tenue ni marquée');
set local role service_role;
select is(t_hold_b() ->> 'ok', 'true', 'H3 : un second hold sur la dernière unité passe (A ne compte plus « en vol »)');
reset role;

-- ── cancel (1002) ────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select test_login(t_id('23'));
select is(admin_resolve_pms_booking_request(t_id('3002'), 'cancel'),
  jsonb_build_object('ok', true, 'status', 'cancelled', 'bookings_recorded', 0, 'lines_released', 2,
                     'markers_cleared', 0, 'entries_resolved', 1),
  'X1 : cancel → cancelled, les deux lignes sans booking relâchées, l''entrée résolue');
reset role;
select is(
  (select jsonb_build_object('statut', status, 'erreur', last_error, 'clos', processed_at = now()) from pms_booking_requests where id = t_id('3002')),
  jsonb_build_object('statut', 'cancelled', 'erreur', '422 refus', 'clos', true),
  'X2 : la demande est close (cancelled), son erreur gardée');
select is(
  (select jsonb_object_agg(right(id::text, 4), jsonb_build_object('statut', status, 'tenue', pms_held_at is not null,
                                                                  'marqueur', pms_attempt_started_at is not null))
     from order_lines where order_id = t_id('1002')),
  jsonb_build_object('2005', jsonb_build_object('statut', 'reserved', 'tenue', false, 'marqueur', false),
                     '2006', jsonb_build_object('statut', 'reserved', 'tenue', true, 'marqueur', true),
                     '2007', jsonb_build_object('statut', 'cancelled_by_client', 'tenue', false, 'marqueur', false)),
  'X3 : aucune ligne n''est annulée ; les lignes sans booking ne sont plus tenues ni marquées, la bookée ne bouge pas');
select is(
  (select jsonb_build_object('statut', status, 'note', resolution_note) from pms_reconciliation_entries where id = t_id('4007')),
  jsonb_build_object('statut', 'resolved', 'note', 'résolue par cancel de la demande ' || t_id('3002') || ' (reprise admin, commande RPR-1002)'),
  'X4 : l''entrée « commande PAYÉE » est résolue par le cancel');
select is(
  jsonb_build_object('confirmation', t_confirmation('1002'), 'emails', t_emails('1002'),
                     'audit', (select action from audit_log where entity_id = t_id('3002'))),
  jsonb_build_object('confirmation', null, 'emails', jsonb_build_object('commission', 0, 'paiement', 0, 'client', 0, 'recurso', 0),
                     'audit', 'pms_booking_request.cancel'),
  'X5 : pms_confirmation null, aucun e-mail, une ligne d''audit');

-- ── retry (1003) ─────────────────────────────────────────────────────────────────────────────
select vault.create_secret('https://fonctions.reprise.test', 'pms_functions_base_url');
select vault.create_secret('cle-factice-reprise', 'pms_service_role_key');
select set_config('hifago.reservas_pms_demandees', '', true);
set local role authenticated;
select test_login(t_id('23'));
select is(admin_resolve_pms_booking_request(t_id('3003'), 'retry'),
  jsonb_build_object('ok', true, 'status', 'pending', 'bookings_recorded', 0, 'lines_released', 0,
                     'markers_cleared', 1, 'entries_resolved', 0),
  'T1 : retry → pending, un marqueur effacé');
reset role;
select is(
  (select jsonb_build_object('statut', status, 'essais', attempts, 'due', next_attempt_at = now(), 'erreur', last_error, 'clos', processed_at)
     from pms_booking_requests where id = t_id('3003')),
  jsonb_build_object('statut', 'pending', 'essais', 0, 'due', true, 'erreur', null, 'clos', null),
  'T2 : la demande repart : 0 tentative, due maintenant, erreur et clôture effacées');
select is(
  (select jsonb_object_agg(right(id::text, 4), jsonb_build_object('tenue', pms_held_at is not null, 'marqueur', pms_attempt_started_at is not null))
     from order_lines where order_id = t_id('1003')),
  jsonb_build_object('2008', jsonb_build_object('tenue', true, 'marqueur', false),
                     '2009', jsonb_build_object('tenue', true, 'marqueur', true),
                     '2010', jsonb_build_object('tenue', true, 'marqueur', true)),
  'T3 : seul le marqueur de la ligne réservée sans booking est effacé ; la nuit reste tenue (elle va être réservée)');
select is((select status from pms_reconciliation_entries where id = t_id('4008')), 'open',
  'T4 : les entrées restent ouvertes (l''issue de la relance n''est pas connue)');
select is(
  (select count(*)::int from net.http_request_queue where url = 'https://fonctions.reprise.test/functions/v1/pms-book-paid-orders'),
  1, 'T5 : la demande due déclenche UN appel de pms-book-paid-orders (trigger de la file)');
select is(
  jsonb_build_object('confirmation', t_confirmation('1003'),
                     'audit', (select jsonb_build_object('action', action, 'note', note like 'relance vers Lobby — l''admin atteste%RPR-1003')
                                 from audit_log where entity_id = t_id('3003'))),
  jsonb_build_object('confirmation', 'pending', 'audit', jsonb_build_object('action', 'pms_booking_request.retry', 'note', true)),
  'T6 : pms_confirmation repasse « pending » ; une ligne d''audit dit ce que l''admin atteste');
set local role service_role;
create temp table t_claim_retry as select * from claim_pms_booking_requests(1000);
create temp table t_claim_order as select public.claim_paid_order_for_pms_booking(t_id('1003')) as r;
reset role;
select is((select attempts from t_claim_retry where request_id = t_id('3003')), 1,
  'T7 : la demande est réclamée de nouveau par claim_pms_booking_requests');
select is(
  (select jsonb_build_object('ok', r -> 'ok', 'bail', r ->> 'claimed_at' is not null,
                             'nuits', (select jsonb_agg(l -> 'id') from jsonb_array_elements(r -> 'groups' -> 0 -> 'lodging_lines') l))
     from t_claim_order),
  jsonb_build_object('ok', true, 'bail', true, 'nuits', jsonb_build_array(t_id('2008'))),
  'T8 : le claim de la commande passe (marqueur effacé) et rend la nuit à réserver');

select * from finish();
rollback;
