-- Bandeau d'état des jobs (migration 20261006143045) : job_expectations, admin_jobs_status(),
-- seuils lus dans la table par les deux watchdogs.
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - admin_jobs_status : admin seul (42501 sinon, garde et pas seulement grant ; anon sans
--     EXECUTE) ; une ligne par job attendu MÊME sans aucun heartbeat ; seuils en minutes ;
--     checked_at = now() ;
--   - `state` : never (jamais exécuté, dans sa grâce), failing (a tourné sans jamais réussir, dans
--     sa grâce — 20261007003627), stale (le prédicat des watchdogs — y compris un job jamais vu
--     au-delà de sa grâce, ancré sur la déclaration de l'attente), ok ; `stale` exactement quand le
--     watchdog alerte ;
--   - heartbeat_job date le passage à l'instant réel (clock_timestamp), un seul instant pour
--     last_run_at et last_ok_at ;
--   - le seuil est LU dans la table : le changer fait bouger jobs_watchdog ET la RPC, et
--     payments_reconcile_watchdog (sujet de l'e-mail inchangé à 15 min) ;
--   - alert_active suit le réarmement (alerte partie → vrai ; un succès → faux) ;
--   - payments_reconcile_watchdog recrée sa ligne si elle manque, ancrée sur l'attente ;
--   - job_heartbeats : la policy SELECT réservée aux admins ; job_expectations : RLS sans policy,
--     aucun droit pour anon/authenticated, seuil strictement positif.
-- ⚠️ `now()` est constant dans la transaction : on vieillit la DONNÉE, jamais l'horloge.
begin;
select plan(26);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
  ('6c100000-0000-4000-8000-000000000001', 'jobs-status-admin@test.local'),
  ('6c100000-0000-4000-8000-000000000002', 'jobs-status-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('6c100000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

create temp view alertes as
  select subject, body_html from notification_emails
   where event_type = 'admin_job_stalled' and recipient_email = 'jobs-status-admin@test.local';

-- Point de départ connu : aucun heartbeat, toutes les attentes déclarées maintenant.
delete from job_heartbeats where job_name in (select job_name from job_expectations);
update job_expectations set created_at = now();

-- ── Garde ────────────────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.admin_jobs_status()', 'execute')
  and has_function_privilege('authenticated', 'public.admin_jobs_status()', 'execute'),
  'S1 : anon n''exécute pas admin_jobs_status ; authenticated oui (le garde fait le reste)');

set local role authenticated;
select test_login('6c100000-0000-4000-8000-000000000002');
select throws_ok($$ select * from admin_jobs_status() $$, '42501', 'admin_jobs_status réservé au rôle admin',
  'S2 : un compte non admin est refusé par le garde (42501), pas par un grant manquant');
select throws_ok($$ select * from job_expectations $$, '42501', null,
  'S4 : job_expectations est fermée à authenticated (aucun droit)');

select test_login('6c100000-0000-4000-8000-000000000001');
-- ── Sans aucun heartbeat ─────────────────────────────────────────────────
select is(
  (select array_agg(job_name || ':' || stale_after_minutes || ':' || state || ':' || alert_active order by job_name)
     from admin_jobs_status()),
  array['payments-reconcile:15:never:false', 'pms-cancel-bookings:40:never:false', 'pms-nightly-contract-check:2160:never:false',
        'pms-poll-bookings:45:never:false', 'pms-sync-availability:20:never:false', 'send-notification-emails:20:never:false'],
  'S5 : une ligne par job attendu même sans heartbeat — jamais exécutés, dans leur grâce, seuils en minutes');
select is((select bool_and(checked_at = now() and last_run_at is null) from admin_jobs_status()), true,
  'S6 : checked_at = now() (l''horloge de la base), aucun passage');
reset role;

-- Jamais vu au-delà de sa grâce, avant tout passage du watchdog : stale, ancré sur l'attente.
update job_expectations set created_at = now() - interval '46 minutes' where job_name = 'pms-poll-bookings';
select test_login('6c100000-0000-4000-8000-000000000001');
select is((select state from admin_jobs_status() where job_name = 'pms-poll-bookings'), 'stale',
  'S7 : jamais vu au-delà de sa grâce → stale, sans attendre que le watchdog ait créé sa ligne');
select jobs_watchdog();
select is(
  (select jsonb_build_object('state', state, 'alert_active', alert_active) from admin_jobs_status() where job_name = 'pms-poll-bookings'),
  jsonb_build_object('state', 'stale', 'alert_active', true),
  'S8 : le watchdog alerte exactement ce que la RPC dit stale — et l''alerte est active');
select is((select count(*)::int from alertes), 1,
  'S9 : une seule alerte : les jobs jamais vus encore dans leur grâce ne déclenchent rien');
select is(
  (select array_agg(job_name || ':' || state || ':' || alert_active order by job_name) from admin_jobs_status()),
  array['payments-reconcile:never:false', 'pms-cancel-bookings:never:false', 'pms-nightly-contract-check:never:false',
        'pms-poll-bookings:stale:true', 'pms-sync-availability:never:false', 'send-notification-emails:never:false'],
  'S8b : lignes créées par le watchdog, jamais exécutées, dans leur grâce → never ; seul le hors-grâce est stale');

-- ── Le seuil est lu dans la table ────────────────────────────────────────
select heartbeat_job('pms-sync-availability', true, '{}'::jsonb, null);
update job_heartbeats set last_ok_at = now() - interval '25 minutes', created_at = now() - interval '2 hours'
 where job_name = 'pms-sync-availability';
update job_expectations set stale_after = interval '30 minutes' where job_name = 'pms-sync-availability';
select jobs_watchdog();
select is(
  (select jsonb_build_object('state', state, 'minutes', stale_after_minutes, 'alertes', (select count(*)::int from alertes where subject like '%pms-sync-availability%'))
     from admin_jobs_status() where job_name = 'pms-sync-availability'),
  jsonb_build_object('state', 'ok', 'minutes', 30, 'alertes', 0),
  'S10 : silence de 25 min sous un seuil porté à 30 min dans la table → ok, aucune alerte');
update job_expectations set stale_after = interval '20 minutes' where job_name = 'pms-sync-availability';
select jobs_watchdog();
select is(
  (select jsonb_build_object('state', state, 'minutes', stale_after_minutes, 'alertes', (select count(*)::int from alertes where subject = 'El job pms-sync-availability no responde (sin ejecución exitosa desde hace más de 20 min)'))
     from admin_jobs_status() where job_name = 'pms-sync-availability'),
  jsonb_build_object('state', 'stale', 'minutes', 20, 'alertes', 1),
  'S11 : le même silence sous le seuil ramené à 20 min → stale ET une alerte, au seuil de la table');

-- ── Réarmement ───────────────────────────────────────────────────────────
select is((select alert_active from admin_jobs_status() where job_name = 'pms-sync-availability'), true,
  'S12 : alerte partie, aucun succès depuis → alert_active');
-- Chronologie réelle : l'alerte est partie il y a une minute, le succès arrive maintenant.
update job_heartbeats set alerted_at = now() - interval '1 minute' where job_name = 'pms-sync-availability';
select heartbeat_job('pms-sync-availability', true, '{}'::jsonb, null);
select is(
  (select jsonb_build_object('state', state, 'alert_active', alert_active) from admin_jobs_status() where job_name = 'pms-sync-availability'),
  jsonb_build_object('state', 'ok', 'alert_active', false),
  'S13 : un succès réarme : ok, plus d''alerte active');
select is(
  (select jsonb_build_object('meme_instant', last_ok_at = last_run_at, 'instant_reel', last_run_at > now())
     from admin_jobs_status() where job_name = 'pms-sync-availability'),
  jsonb_build_object('meme_instant', true, 'instant_reel', true),
  'S13b : un passage est daté à l''instant réel (après le début de la transaction), le même pour les deux colonnes');
select heartbeat_job('pms-cancel-bookings', false, '{}'::jsonb, 'timeout');
select is(
  (select jsonb_build_object('state', state, 'erreur', last_error, 'passage', last_run_at > now(), 'jamais_reussi', last_ok_at is null)
     from admin_jobs_status() where job_name = 'pms-cancel-bookings'),
  jsonb_build_object('state', 'failing', 'erreur', 'timeout', 'passage', true, 'jamais_reussi', true),
  'S14 : un job qui a tourné sans jamais réussir, sous son seuil → failing (jamais ok), son erreur visible');
-- Un job qui A DÉJÀ réussi et échoue sous son seuil reste `ok` : seul « jamais réussi » est failing.
select heartbeat_job('pms-sync-availability', false, '{}'::jsonb, 'timeout');
select is((select state from admin_jobs_status() where job_name = 'pms-sync-availability'), 'ok',
  'S14d : un échec après un succès, sous le seuil → ok (le prédicat des watchdogs, inchangé)');
-- Une ligne existante s'ancre sur SON created_at (premier heartbeat en échec, ou ligne pré-créée),
-- jamais sur la déclaration de l'attente — et la RPC le dit au même instant que le watchdog.
update job_heartbeats set created_at = now() - interval '41 minutes' where job_name = 'pms-cancel-bookings';
select is((select state from admin_jobs_status() where job_name = 'pms-cancel-bookings'), 'stale',
  'S14b : une ligne existante s''ancre sur son created_at, pas sur la déclaration de l''attente');
select is(job_watchdog('pms-cancel-bookings', interval '40 minutes'), true,
  'S14c : et le watchdog alerte au même instant');
-- La limite exacte : un silence ÉGAL au seuil n'est pas encore une panne (`<` strict, partout).
select heartbeat_job('send-notification-emails', true, '{}'::jsonb, null);
update job_heartbeats set last_ok_at = now() - interval '20 minutes', alerted_at = null where job_name = 'send-notification-emails';
select is(
  jsonb_build_object('rpc', (select state from admin_jobs_status() where job_name = 'send-notification-emails'),
                     'watchdog', job_watchdog('send-notification-emails', interval '20 minutes')),
  jsonb_build_object('rpc', 'ok', 'watchdog', false),
  'S14d : silence égal au seuil → ok pour la RPC, rien pour le watchdog');

-- ── payments_reconcile_watchdog lit son seuil dans la table ───────────────
select heartbeat_job('payments-reconcile', true, '{}'::jsonb, null);
update job_heartbeats set last_ok_at = now() - interval '20 minutes', created_at = now() - interval '2 hours', alerted_at = null
 where job_name = 'payments-reconcile';
update job_expectations set stale_after = interval '30 minutes' where job_name = 'payments-reconcile';
select payments_reconcile_watchdog();
select is((select count(*)::int from alertes where subject like 'El job de conciliación de pagos%'), 0,
  'S15 : 20 min de silence sous un seuil de 30 min (table) → aucune alerte de paiement');
update job_expectations set stale_after = interval '15 minutes' where job_name = 'payments-reconcile';
select payments_reconcile_watchdog();
select is((select array_agg(subject) from alertes where subject like 'El job de conciliación de pagos%'),
  array['El job de conciliación de pagos no responde desde hace 15 min'],
  'S16 : sous 15 min (la valeur de la table) → une alerte, sujet inchangé');
delete from job_heartbeats where job_name = 'payments-reconcile';
update job_expectations set created_at = now() - interval '5 minutes' where job_name = 'payments-reconcile';
select payments_reconcile_watchdog();
select is(
  (select jsonb_build_object('ancre', created_at = now() - interval '5 minutes', 'jamais', last_run_at is null, 'alerte', alerted_at)
     from job_heartbeats where job_name = 'payments-reconcile'),
  jsonb_build_object('ancre', true, 'jamais', true, 'alerte', null),
  'S17 : sa ligne manquante est recréée, ancrée sur l''attente, sans alerte dans la grâce');

-- ── La policy SELECT de job_heartbeats (des lignes existent maintenant) ───
set local role authenticated;
select test_login('6c100000-0000-4000-8000-000000000002');
create temp table s3_acheteur as select count(*)::int as n from job_heartbeats;
select test_login('6c100000-0000-4000-8000-000000000001');
create temp table s3_admin as select count(*)::int as n from job_heartbeats;
reset role;
select is(
  (select jsonb_build_object('acheteur', a.n, 'admin_voit_tout', d.n = (select count(*)::int from job_heartbeats) and d.n >= 6)
     from s3_acheteur a, s3_admin d),
  jsonb_build_object('acheteur', 0, 'admin_voit_tout', true),
  'S3 : la policy SELECT de job_heartbeats : rien pour un non-admin, tout pour un admin');

-- ── La table ─────────────────────────────────────────────────────────────
select is(
  (select jsonb_build_object('rls', c.relrowsecurity, 'policies', (select count(*)::int from pg_policies p where p.tablename = 'job_expectations'))
     from pg_class c where c.oid = 'public.job_expectations'::regclass),
  jsonb_build_object('rls', true, 'policies', 0),
  'S18 : job_expectations sous RLS, sans aucune policy');
select ok(
  not has_table_privilege('anon', 'public.job_expectations', 'select')
  and not has_table_privilege('anon', 'public.job_expectations', 'insert')
  and not has_table_privilege('authenticated', 'public.job_expectations', 'insert')
  and not has_table_privilege('authenticated', 'public.job_expectations', 'update')
  and not has_table_privilege('authenticated', 'public.job_expectations', 'delete')
  and not has_table_privilege('service_role', 'public.job_expectations', 'insert')
  and not has_table_privilege('service_role', 'public.job_expectations', 'update')
  and not has_table_privilege('service_role', 'public.job_expectations', 'delete'),
  'S19 : ni anon, ni authenticated, ni service_role n''écrivent job_expectations : elle ne bouge que par migration');
select throws_ok($$ update job_expectations set stale_after = interval '0' where job_name = 'pms-poll-bookings' $$, '23514', null,
  'S20 : un seuil nul est refusé');

select * from finish();
rollback;
