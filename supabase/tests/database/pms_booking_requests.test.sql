-- Lobby après l'acompte (migration 20261023120000) — la file pms_booking_requests :
-- resolve_pms_booking_request, claim_pms_booking_requests, notify_order_confirmed (par 'done'), le
-- trigger d'envoi immédiat, le cron et sa supervision.
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - la table est RPC-only (RLS sans policy, aucun droit pour anon/authenticated), une demande par
--     commande, les colonnes neuves existent ;
--   - resolve : 'done' clôt et envoie les e-mails 5/6/7 ET 8 (commande payée seulement) ; 'retry'
--     replanifie (défaut 1 min, plancher 10 s), rend la tentative si demandé, bascule en 'failed' à
--     la 6e tentative consommée ; 'failed' / 'needs_human' posent UNE entrée de réconciliation
--     « commande PAYÉE » (la ligne donnée si elle est de la commande, sinon la première nuit PMS
--     vivante sans booking par date), e-mail admin compris, jamais en double d'une entrée ouverte
--     (hors entrée muette « jeton Lobby remplacé ») ; 'cancelled' clôt sans rien ; une demande qui
--     n'est plus pending → no-op typé ; une issue inconnue → exception ;
--   - claim : seulement les demandes dues, mises sous bail 5 min, attempts + 1, dans l'ordre de leur
--     échéance, limite respectée ; une demande réclamée 6 fois sans résolution → needs_human ;
--   - le trigger appelle pms-book-paid-orders une fois par transaction, seulement pour une demande
--     DUE (insertion, réarmement) — jamais pour une réclamation ni un nouvel essai — et une panne de
--     l'appel ne fait jamais échouer l'écriture ;
--   - cron toutes les minutes, attente de 10 min ; droits.
-- Le compte d'appels se lit dans net.http_request_queue (en file seulement : le rollback l'annule).
begin;
select plan(47);

create function t_id(p text) returns uuid language sql as $$
  select ('7e120000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid;
$$;

-- Sans secrets Vault pendant les fixtures (pile vierge, CI) : le trigger avertit et n'appelle rien.
delete from vault.secrets where name in ('pms_functions_base_url', 'pms_service_role_key');

insert into partners (id, display_name) values
  (t_id('1'), 'BookQ Owner'),
  (t_id('2'), 'BookQ Referrer');
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
  (t_id('11'), t_id('1'), jsonb_build_object('es', 'BookQ'), true, 'tok-bookq');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id, duration_days) values
  (t_id('31'), t_id('1'), t_id('11'), 'lodging', jsonb_build_object('es', 'BookQ Noche'), 100000, true, 'bookq-noche', 7201, null),
  (t_id('32'), t_id('1'), t_id('11'), 'camp', jsonb_build_object('es', 'BookQ Campamento'), 90000, true, 'bookq-camp', null, 2),
  (t_id('33'), t_id('1'), t_id('11'), 'activity', jsonb_build_object('es', 'BookQ Actividad'), 50000, true, 'bookq-act', null, null);
insert into auth.users (id, email) values
  (t_id('21'), 'bookq-owner@test.local'),
  (t_id('22'), 'bookq-referrer@test.local'),
  (t_id('23'), 'bookq-admin@test.local'),
  (t_id('24'), 'bookq-buyer@test.local');
update partner_accounts set partner_id = t_id('1') where id = t_id('21');
update partner_accounts set partner_id = t_id('2') where id = t_id('22');
insert into partner_capabilities (account_id, role, source, status) values (t_id('23'), 'admin', 'migration', 'active');

create function t_order(p text, p_status text) returns void language sql as $$
  insert into orders (id, account_id, holder_name, holder_email, payment_status, reference)
  values (t_id(p), t_id('24'), 'BookQ Holder', 'bookq-client-' || p || '@test.local', p_status, 'BKQ-' || p);
$$;
create function t_line(p text, p_order text, p_product text, p_date date, p_end date,
                       p_case text default 'direct', p_referrer uuid default null) returns void language sql as $$
  insert into order_lines (
    id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
    price_cop, total_cop, commission_case, referrer_partner_id, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop, pms_held_at
  ) values (
    t_id(p), t_id(p_order), t_id('24'), t_id(p_product), p_date, p_end, 1, 'reserved', 'BookQ Holder',
    100000, 100000, p_case, p_referrer, 0.17, case when p_case = 'external_referrer' then 0.08 else 0 end,
    case when p_case = 'external_referrer' then 0.09 else 0.17 end,
    17000, case when p_case = 'external_referrer' then 8000 else 0 end,
    case when p_case = 'external_referrer' then 9000 else 17000 end,
    case when p_product = '31' then now() - interval '10 minutes' end
  );
$$;
create function t_request(p text, p_order text, p_status text default 'pending', p_attempts int default 0,
                          p_next timestamptz default now()) returns void language sql as $$
  insert into pms_booking_requests (id, order_id, status, attempts, next_attempt_at)
  values (t_id(p), t_id(p_order), p_status, p_attempts, p_next);
$$;
create temp view t_entries as
  select e.order_line_id, e.detail, e.status from pms_reconciliation_entries e
   where e.order_line_id::text like '7e120000-%';

-- 1001 : payée, une nuit PMS tenue, un camp, une activité référée — tous les e-mails à 'done'.
select t_order('1001', 'paid');
select t_line('2001', '1001', '31', '2029-05-01', '2029-05-03');
select t_line('2002', '1001', '32', '2029-05-01', null);
select t_line('2003', '1001', '33', '2029-05-01', null, 'external_referrer', t_id('2'));
select t_request('3001', '1001', 'pending', 1);
-- 1002 : pas payée ; 1003 et 1004 : nouveaux essais ; 1005 : sixième tentative.
select t_order('1002', 'pending');
select t_line('2004', '1002', '31', '2029-05-05', '2029-05-06');
select t_request('3002', '1002', 'pending', 1);
select t_order('1003', 'paid');
select t_line('2005', '1003', '31', '2029-05-07', '2029-05-08');
select t_request('3003', '1003', 'pending', 1);
select t_order('1004', 'paid');
select t_line('2006', '1004', '31', '2029-05-09', '2029-05-10');
select t_request('3004', '1004', 'pending', 2);
select t_order('1005', 'paid');
select t_line('2007', '1005', '31', '2029-05-11', '2029-05-12');
select t_request('3005', '1005', 'pending', 6);
-- 1006 : refus sur une ligne donnée ; 1007 : issue inconnue, ligne par défaut (la plus tôt, pas le
-- plus petit id) ; 1008 : ligne d'une AUTRE commande donnée ; 1009 : commande remboursée.
select t_order('1006', 'paid');
select t_line('2008', '1006', '31', '2029-06-02', '2029-06-03');
select t_line('2009', '1006', '31', '2029-06-01', '2029-06-02');
select t_request('3006', '1006', 'pending', 1);
select t_order('1007', 'paid');
select t_line('200a', '1007', '31', '2029-07-05', '2029-07-06');
select t_line('200b', '1007', '31', '2029-07-01', '2029-07-02');
select t_request('3007', '1007', 'pending', 1);
select t_order('1008', 'paid');
select t_line('200c', '1008', '31', '2029-07-10', '2029-07-11');
select t_request('3008', '1008', 'pending', 1);
select t_order('1009', 'refunded');
select t_line('200d', '1009', '31', '2029-07-12', '2029-07-13');
select t_request('3009', '1009', 'pending', 1);
-- 100a : une entrée ouverte existe déjà sur la ligne ; 100b : seulement une entrée muette.
select t_order('100a', 'paid');
select t_line('200e', '100a', '31', '2029-07-14', '2029-07-15');
select t_request('300a', '100a', 'pending', 1);
insert into pms_reconciliation_entries (order_line_id, detail) values (t_id('200e'), 'autre incident ouvert');
select t_order('100b', 'paid');
select t_line('200f', '100b', '31', '2029-07-16', '2029-07-17');
select t_request('300b', '100b', 'pending', 1);
insert into pms_reconciliation_entries (order_line_id, detail) values (t_id('200f'), 'jeton Lobby remplacé le … (muette)');
-- Réclamation : 100c et 100d dues (il y a 10 ans) ; 100e pas encore due ; 100f close ; 1010
-- réclamée 6 fois sans résolution ; 1011 et 1012 dues il y a 20 ans (les plus anciennes de toute la
-- base : la limite les prend dans cet ordre).
select t_order('100c', 'paid');
select t_line('2011', '100c', '31', '2029-08-01', '2029-08-02');
select t_request('300c', '100c', 'pending', 0, now() - interval '10 years');
select t_order('100d', 'paid');
select t_line('2012', '100d', '31', '2029-08-03', '2029-08-04');
select t_request('300d', '100d', 'pending', 0, now() - interval '10 years' + interval '1 second');
select t_order('100e', 'paid');
select t_line('2013', '100e', '31', '2029-08-05', '2029-08-06');
select t_request('300e', '100e', 'pending', 0, now() + interval '1 hour');
select t_order('100f', 'paid');
select t_line('2014', '100f', '31', '2029-08-07', '2029-08-08');
select t_request('300f', '100f', 'done', 0, now() - interval '10 years');
select t_order('1010', 'paid');
select t_line('2015', '1010', '31', '2029-08-09', '2029-08-10');
select t_request('3010', '1010', 'pending', 6, now() - interval '10 years' - interval '1 day');

-- ── La table et les droits ──────────────────────────────────────────────────────────────────
select is(
  (select jsonb_build_object('rls', c.relrowsecurity, 'policies', (select count(*)::int from pg_policies p where p.tablename = 'pms_booking_requests'))
     from pg_class c where c.oid = 'public.pms_booking_requests'::regclass),
  jsonb_build_object('rls', true, 'policies', 0),
  'Q1 : pms_booking_requests sous RLS, sans aucune policy (RPC-only)');
select ok(
  not has_table_privilege('anon', 'public.pms_booking_requests', 'select')
  and not has_table_privilege('anon', 'public.pms_booking_requests', 'insert')
  and not has_table_privilege('authenticated', 'public.pms_booking_requests', 'select')
  and not has_table_privilege('authenticated', 'public.pms_booking_requests', 'insert')
  and not has_table_privilege('authenticated', 'public.pms_booking_requests', 'update')
  and not has_table_privilege('authenticated', 'public.pms_booking_requests', 'delete')
  and has_table_privilege('service_role', 'public.pms_booking_requests', 'select'),
  'Q2 : aucun droit pour anon ni authenticated ; service_role garde les droits par défaut du projet');
set local role authenticated;
select throws_ok($$ select * from pms_booking_requests $$, '42501', null, 'Q3 : un SELECT sous authenticated échoue en permission denied');
reset role;
select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'pms_checked_at')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_lines' and column_name = 'pms_held_at')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_lines' and column_name = 'pms_recorded_at'),
  'Q4 : orders.pms_checked_at, order_lines.pms_held_at et order_lines.pms_recorded_at existent');
select throws_ok($$ select t_request('30ff', '1001') $$, '23505', null, 'Q5 : une seule demande par commande');
select throws_ok($$ insert into pms_booking_requests (order_id, status) values (t_id('1002'), 'ouverte') $$, '23514', null,
  'Q6 : un statut inconnu est refusé');
select ok(
  not has_function_privilege('anon', 'public.claim_pms_booking_requests(int)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_pms_booking_requests(int)', 'execute')
  and has_function_privilege('service_role', 'public.claim_pms_booking_requests(int)', 'execute')
  and not has_function_privilege('anon', 'public.resolve_pms_booking_request(uuid, text, text, uuid, interval, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.resolve_pms_booking_request(uuid, text, text, uuid, interval, boolean)', 'execute')
  and has_function_privilege('service_role', 'public.resolve_pms_booking_request(uuid, text, text, uuid, interval, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.invoke_pms_book_paid_orders()', 'execute'),
  'G1 : claim et resolve exécutables par service_role seul ; invoke fermée aux rôles de la Data API');
select ok(
  not has_function_privilege('service_role', 'public.notify_order_confirmed(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.notify_order_confirmed(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.notify_partner_camp_evento_blocked(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.notify_partner_camp_evento_blocked(uuid)', 'execute'),
  'G2 : notify_order_confirmed et notify_partner_camp_evento_blocked : internes, exécutables par personne');

set local role service_role;
-- ── resolve_pms_booking_request ─────────────────────────────────────────────────────────────
select throws_ok($$ select resolve_pms_booking_request(t_id('3001'), 'peut-être') $$, 'P0001', null,
  'R1 : une issue inconnue lève une exception');
select is(resolve_pms_booking_request('00000000-0000-4000-8000-000000000000', 'done'),
  jsonb_build_object('ok', false, 'reason', 'request_not_found'), 'R2 : demande inconnue → request_not_found');
select is(resolve_pms_booking_request(t_id('3001'), 'done'),
  jsonb_build_object('ok', true, 'status', 'done'), 'R3 : done → ok');
reset role;
select is(
  (select jsonb_build_object('statut', status, 'clos', processed_at = now()) from pms_booking_requests where id = t_id('3001')),
  jsonb_build_object('statut', 'done', 'clos', true), 'R3b : la demande est close (done, processed_at)');
select is(
  jsonb_build_object(
    'commission', (select count(*)::int from notification_emails where event_type = 'partner_commission_earned' and related_id = t_id('1001') and recipient_account_id = t_id('22')),
    'paiement', (select count(*)::int from notification_emails where event_type = 'partner_payment_confirmed' and related_id = t_id('1001') and recipient_account_id = t_id('21')),
    'client', (select count(*)::int from notification_emails where event_type = 'client_order_confirmed' and related_id = t_id('1001') and recipient_email = 'bookq-client-1001@test.local'),
    'recurso', (select count(*)::int from notification_emails where event_type = 'partner_camp_evento_blocked' and related_table = 'order_lines' and related_id = t_id('2002') and recipient_account_id = t_id('21'))),
  jsonb_build_object('commission', 1, 'paiement', 1, 'client', 1, 'recurso', 1),
  'R3c : done → les e-mails différés partent : 5 (référent), 6 (propriétaire), 7 (client) et 8 (camp)');
select ok(
  strpos((select body_html from notification_emails where event_type = 'partner_camp_evento_blocked' and related_id = t_id('2002')),
         '<p>Período bloqueado: 2029-05-01 a 2029-05-02.</p>') > 0,
  'R3d : l''e-mail 8 garde son corps (période du camp de 2 jours)');
set local role service_role;
select is(resolve_pms_booking_request(t_id('3001'), 'done'),
  jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', 'done'), 'R4 : rejoué → no-op typé (not_pending)');
select is(resolve_pms_booking_request(t_id('3002'), 'done') ->> 'status', 'done', 'R5 : done sur une commande non payée → close…');
reset role;
select is((select count(*)::int from notification_emails where related_id in (t_id('1002'), t_id('2004'))), 0,
  'R5b : …mais aucun e-mail de confirmation (notify_order_confirmed exige une commande payée)');

set local role service_role;
select is(resolve_pms_booking_request(t_id('3003'), 'retry', 'panne Lobby', null, interval '2 minutes'),
  jsonb_build_object('ok', true, 'status', 'pending'), 'R6 : retry → reste pending');
reset role;
select is(
  (select jsonb_build_object('statut', status, 'essais', attempts, 'prochain', next_attempt_at = now() + interval '2 minutes', 'erreur', last_error)
     from pms_booking_requests where id = t_id('3003')),
  jsonb_build_object('statut', 'pending', 'essais', 1, 'prochain', true, 'erreur', 'panne Lobby'),
  'R6b : retry consommé → nouvel essai dans p_retry_after, tentative gardée, erreur notée');
set local role service_role;
select resolve_pms_booking_request(t_id('3003'), 'retry', 'panne', null, interval '0 seconds');
reset role;
select is((select next_attempt_at = now() + interval '10 seconds' from pms_booking_requests where id = t_id('3003')), true,
  'R7 : jamais un nouvel essai immédiat (plancher de 10 s)');
set local role service_role;
select resolve_pms_booking_request(t_id('3003'), 'retry');
reset role;
select is((select next_attempt_at = now() + interval '1 minute' from pms_booking_requests where id = t_id('3003')), true,
  'R7b : sans délai donné → 1 min');
set local role service_role;
select resolve_pms_booking_request(t_id('3004'), 'retry', 'bail occupé', null, interval '1 minute', false);
reset role;
select is((select attempts from pms_booking_requests where id = t_id('3004')), 1,
  'R8 : p_keep_attempt = false → la tentative est rendue (2 → 1)');
set local role service_role;
select is(resolve_pms_booking_request(t_id('3005'), 'retry', 'panne Lobby'),
  jsonb_build_object('ok', true, 'status', 'failed'), 'R9 : la 6e tentative consommée → failed');
reset role;
select is(
  (select detail from t_entries where order_line_id = t_id('2007')),
  'commande PAYÉE — Lobby a refusé — reloger ou rembourser à la main : aucun booking après 6 tentatives — dernière erreur : panne Lobby (commande BKQ-1005)',
  'R9b : …avec son entrée de réconciliation « commande PAYÉE »');

set local role service_role;
select is(resolve_pms_booking_request(t_id('3006'), 'failed', '422 refus', t_id('2008')),
  jsonb_build_object('ok', true, 'status', 'failed'), 'R10 : failed → ok');
reset role;
select is(
  (select jsonb_build_object('ligne', order_line_id, 'detail', detail, 'statut', status) from t_entries where order_line_id in (t_id('2008'), t_id('2009'))),
  jsonb_build_object('ligne', t_id('2008'), 'detail', 'commande PAYÉE — Lobby a refusé — reloger ou rembourser à la main : 422 refus (commande BKQ-1006)', 'statut', 'open'),
  'R10b : UNE entrée ouverte, sur la ligne donnée');
select is(
  (select jsonb_build_object('statut', r.status, 'erreur', r.last_error, 'clos', r.processed_at = now()) from pms_booking_requests r where r.id = t_id('3006')),
  jsonb_build_object('statut', 'failed', 'erreur', '422 refus', 'clos', true),
  'R10c : la demande est close en failed, son erreur gardée');
select is(
  (select count(*)::int from notification_emails n join pms_reconciliation_entries e on e.id = n.related_id
    where n.event_type = 'admin_new_reconciliation_exception' and n.related_table = 'pms_reconciliation_entries'
      and e.order_line_id = t_id('2008') and n.recipient_account_id = t_id('23')),
  1, 'R10d : l''admin reçoit l''e-mail 3 (trigger de la file de réconciliation)');
set local role service_role;
select resolve_pms_booking_request(t_id('3007'), 'needs_human', 'POST /bookings sans réponse');
select resolve_pms_booking_request(t_id('3008'), 'needs_human', 'coupure', t_id('200b'));
reset role;
select is(
  (select array_agg(order_line_id::text || ' | ' || detail order by order_line_id) from t_entries where order_line_id in (t_id('200a'), t_id('200b'))),
  array[t_id('200b')::text || ' | commande PAYÉE — issue inconnue — vérifier chez Lobby par la note « hifago order_line '
        || t_id('200b') || ' », puis reloger ou rembourser à la main : POST /bookings sans réponse (commande BKQ-1007)'],
  'R11 : needs_human sans ligne donnée → la première nuit PMS sans booking PAR DATE, avec la clé de la note Lobby');
select is((select count(*)::int from t_entries where order_line_id = t_id('200c')), 1,
  'R12 : une ligne donnée qui n''est pas de la commande est ignorée — l''entrée va sur sa propre nuit');
set local role service_role;
select is(resolve_pms_booking_request(t_id('3009'), 'cancelled', 'order_not_paid'),
  jsonb_build_object('ok', true, 'status', 'cancelled'), 'R13 : cancelled → ok');
reset role;
select is(
  jsonb_build_object('statut', (select status from pms_booking_requests where id = t_id('3009')),
                     'entrees', (select count(*)::int from t_entries where order_line_id = t_id('200d')),
                     'emails', (select count(*)::int from notification_emails where related_id in (t_id('1009'), t_id('200d')))),
  jsonb_build_object('statut', 'cancelled', 'entrees', 0, 'emails', 0),
  'R13b : cancelled → close, aucune entrée, aucun e-mail');
set local role service_role;
select resolve_pms_booking_request(t_id('300a'), 'failed', 'refus');
select resolve_pms_booking_request(t_id('300b'), 'failed', 'refus');
reset role;
select is(
  jsonb_build_object('deja_ouverte', (select count(*)::int from t_entries where order_line_id = t_id('200e')),
                     'muette_seule', (select count(*)::int from t_entries where order_line_id = t_id('200f'))),
  jsonb_build_object('deja_ouverte', 1, 'muette_seule', 2),
  'R14 : jamais en double d''une entrée ouverte sur la même ligne — une entrée muette « jeton remplacé » ne compte pas');

-- ── claim_pms_booking_requests ──────────────────────────────────────────────────────────────
set local role service_role;
create temp table t_claim1 as select * from claim_pms_booking_requests(1000);
reset role;
select is(
  (select array_agg(request_id::text || ':' || attempts order by request_id) from t_claim1 where request_id::text like '7e120000-%'),
  array[t_id('300c')::text || ':1', t_id('300d')::text || ':1'],
  'C1 : les demandes dues et seulement elles (pas la future, pas la close, pas l''épuisée), attempts + 1');
select is(
  (select bool_and(next_attempt_at = now() + interval '5 minutes') from pms_booking_requests where id in (t_id('300c'), t_id('300d'))),
  true, 'C2 : une demande réclamée est sous bail de 5 min (plus due tant qu''elle n''est pas résolue)');
set local role service_role;
select is((select count(*)::int from claim_pms_booking_requests(1000) where request_id in (t_id('300c'), t_id('300d'))), 0,
  'C3 : réclamée aussitôt une seconde fois → rien (le bail l''écarte)');
reset role;
select is(
  jsonb_build_object('statut', (select status from pms_booking_requests where id = t_id('3010')),
                     'entree', (select detail like 'commande PAYÉE — issue inconnue — %demande réclamée 6 fois sans résolution%' from t_entries where order_line_id = t_id('2015'))),
  jsonb_build_object('statut', 'needs_human', 'entree', true),
  'C4 : réclamée 6 fois sans résolution → needs_human, entrée « issue inconnue »');
select t_order('1011', 'paid');
select t_request('3011', '1011', 'pending', 0, now() - interval '20 years');
select t_order('1012', 'paid');
select t_request('3012', '1012', 'pending', 0, now() - interval '20 years' + interval '1 second');
set local role service_role;
select is((select array_agg(request_id) from claim_pms_booking_requests(1)), array[t_id('3011')],
  'C5 : la limite est respectée, dans l''ordre de l''échéance');
reset role;

-- ── Le trigger d'appel immédiat ─────────────────────────────────────────────────────────────
create function nb_appels() returns int language sql as $$
  select count(*)::int from net.http_request_queue
   where url = 'https://fonctions.bookq.test/functions/v1/pms-book-paid-orders';
$$;
select t_order('1013', 'paid');
select set_config('hifago.reservas_pms_demandees', '', true);
select lives_ok($$ select t_request('3013', '1013') $$, 'T1 : sans secrets Vault, la demande s''écrit (le cron reprendra)');
select is(nb_appels(), 0, 'T1b : sans secrets Vault, aucun appel');
select vault.create_secret('https://fonctions.bookq.test', 'pms_functions_base_url');
select vault.create_secret('cle-factice-bookq', 'pms_service_role_key');
select t_order('1014', 'paid');
select t_order('1015', 'paid');
select set_config('hifago.reservas_pms_demandees', '', true);
select t_request('3014', '1014');
select is(
  (select jsonb_build_object('n', count(*), 'cle', min(headers ->> 'Authorization'), 'delai', min(timeout_milliseconds))
     from net.http_request_queue where url = 'https://fonctions.bookq.test/functions/v1/pms-book-paid-orders'),
  jsonb_build_object('n', 1, 'cle', 'Bearer cle-factice-bookq', 'delai', 55000),
  'T2 : une demande due → UN appel de pms-book-paid-orders, avec la clé du Vault et 55 s de délai');
select t_request('3015', '1015');
select is(nb_appels(), 1, 'T3 : une seconde demande dans la MÊME transaction → pas de second appel');
select set_config('hifago.reservas_pms_demandees', '', true);
update pms_booking_requests set next_attempt_at = now() + interval '1 minute' where id = t_id('3014');
select t_order('1016', 'paid');
select t_request('3016', '1016', 'done');
set local role service_role;
select * from claim_pms_booking_requests(1000);
reset role;
select is(nb_appels(), 1, 'T4 : un nouvel essai daté dans le futur, une demande close, une réclamation (mise sous bail) → aucun appel');
update pms_booking_requests set status = 'pending', next_attempt_at = now() where id = t_id('3016');
select is(nb_appels(), 2, 'T5 : un réarmement (demande due) → un appel');
select set_config('hifago.reservas_pms_demandees', '', true);
create or replace function public.invoke_pms_book_paid_orders() returns void
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'panne simulée';
end;
$$;
select t_order('1017', 'paid');
select lives_ok($$ select t_request('3017', '1017') $$, 'T6 : appel en panne → la demande s''écrit quand même');

-- ── Cron et supervision ─────────────────────────────────────────────────────────────────────
select is(
  (select schedule || ' | ' || command from cron.job where jobname = 'pms-book-paid-orders' and active),
  '* * * * * | select invoke_pms_book_paid_orders();',
  'J1 : le cron pms-book-paid-orders tourne toutes les minutes');
select is((select stale_after from job_expectations where job_name = 'pms-book-paid-orders'), interval '10 minutes',
  'J2 : attendu par la supervision, 10 min sans passage réussi');

select * from finish();
rollback;
