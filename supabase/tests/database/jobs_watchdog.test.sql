-- Supervision des jobs (migrations 20261003223900 et 20261006143045) : job_watchdog, jobs_watchdog,
-- release_notification_email_claim.
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - un job attendu qui n'a JAMAIS écrit de heartbeat reçoit sa ligne, datée de la déclaration de
--     l'attente : rien pendant sa grâce (son seuil), puis UNE alerte qui dit « nunca se ejecutó »
--     (des noms seulement, échappés), puis plus rien ; un job frais ne déclenche rien ;
--   - un job en panne depuis plus que son seuil (et pas moins) déclenche UNE alerte admin, son
--     dernier message d'erreur échappé, puis plus rien tant qu'aucun run n'a réussi ; un succès le
--     réarme ; sans aucun admin pour la recevoir, il n'est pas marqué « alerté » ;
--   - les jobs attendus (job_expectations) sont exactement les crons qui appellent une Edge Function,
--     sous leur nom ; jobs_watchdog les surveille (hors payments-reconcile, qui a son propre
--     watchdog) et il est planifié ;
--   - release_notification_email_claim rend les e-mails réclamés sans consommer de tentative, garde
--     le motif, et ne touche à aucun e-mail envoyé, abandonné ou déjà en attente ;
--   - service_role seul.
-- ⚠️ `now()` est constant dans la transaction : on vieillit la DONNÉE, jamais l'horloge.
begin;
select plan(25);

insert into auth.users (id, email) values ('9a6b0000-0000-4000-8000-000000000001', 'watchdog-admin@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('9a6b0000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

create temp view alertes as
  select subject, body_html from notification_emails
   where event_type = 'admin_job_stalled' and recipient_email = 'watchdog-admin@test.local';

-- ── job_watchdog ─────────────────────────────────────────────────────────
delete from job_heartbeats where job_name in ('pms-poll-bookings', 'pms-cancel-bookings', 'pms-sync-availability',
                                                'send-notification-emails', 'pms-nightly-contract-check');
-- Les attentes sont déclarées MAINTENANT : sur une base dont la migration date, un job sans
-- heartbeat serait déjà hors de sa grâce, et jobs_watchdog (W7) alerterait ceux que ce fichier vide.
update job_expectations set created_at = now();
update job_expectations set created_at = now() - interval '44 minutes' where job_name = 'pms-poll-bookings';
select is(job_watchdog('pms-poll-bookings', interval '45 minutes'), false,
  'W1a : un job attendu jamais vu, dans sa grâce (son seuil), ne déclenche rien');
select is(
  (select jsonb_build_object('ancre', created_at = now() - interval '44 minutes', 'jamais', last_run_at is null, 'alerte', alerted_at)
     from job_heartbeats where job_name = 'pms-poll-bookings'),
  jsonb_build_object('ancre', true, 'jamais', true, 'alerte', null),
  'W1b : sa ligne de heartbeat est créée, datée de la déclaration de l''attente, sans passage ni alerte');

select heartbeat_job('pms-poll-bookings', true, '{}'::jsonb, null);
select is(job_watchdog('pms-poll-bookings', interval '45 minutes'), false,
  'W2 : un job frais ne déclenche rien');

update job_heartbeats
   set last_ok_at = now() - interval '1 hour', created_at = now() - interval '2 hours',
       last_error = '<b>lobby</b> & ''401''', alerted_at = null
 where job_name = 'pms-poll-bookings';
select is(job_watchdog('pms-poll-bookings', interval '45 minutes'), true,
  'W3 : un job sans run réussi depuis plus que son seuil déclenche une alerte');
select is((select count(*)::int from alertes), 1, 'W4 : une alerte admin');
select ok(strpos((select body_html from alertes), 'Último error: &lt;b&gt;lobby&lt;/b&gt; &amp; &#39;401&#39;.') > 0,
  'W5 : le dernier message d''erreur du job est échappé');
select is(job_watchdog('pms-poll-bookings', interval '45 minutes'), false,
  'W6 : une seule alerte par panne — rien tant qu''aucun run n''a réussi');

-- ── jobs_watchdog ────────────────────────────────────────────────────────
select heartbeat_job('pms-cancel-bookings', false, '{}'::jsonb, 'timeout');
update job_heartbeats set created_at = now() - interval '2 hours' where job_name = 'pms-cancel-bookings';
select jobs_watchdog();
select is((select count(*)::int from alertes where subject like '%pms-cancel-bookings%'), 1,
  'W7 : jobs_watchdog surveille aussi l''annulation PMS (jamais réussie depuis 2 h)');
select set_eq(
  $$ select job_name from job_heartbeats where job_name in (select job_name from job_expectations where job_name <> 'payments-reconcile') $$,
  $$ select job_name from job_expectations where job_name <> 'payments-reconcile' $$,
  'W7b : jobs_watchdog donne sa ligne de heartbeat à chaque job attendu, même jamais vu');
-- payments-reconcile a son propre watchdog (message dédié) : jobs_watchdog ne l'alerte jamais.
insert into job_heartbeats (job_name, created_at) values ('payments-reconcile', now() - interval '2 hours')
on conflict (job_name) do update set created_at = excluded.created_at, last_ok_at = null, alerted_at = null;
select jobs_watchdog();
select is((select count(*)::int from alertes where subject like '%payments-reconcile%'), 0,
  'W7c : jobs_watchdog laisse payments-reconcile à son propre watchdog (aucune alerte générique)');
select is((select count(*)::int from cron.job where jobname = 'jobs-watchdog' and command like '%jobs_watchdog()%'), 1,
  'W8 : jobs_watchdog est planifié');

-- Réarmement : un run réussi APRÈS l'alerte, puis une nouvelle panne → une nouvelle alerte.
update job_heartbeats
   set last_ok_at = now() - interval '50 minutes', alerted_at = now() - interval '55 minutes'
 where job_name = 'pms-poll-bookings';
select is(job_watchdog('pms-poll-bookings', interval '45 minutes'), true,
  'W9 : un succès après l''alerte réarme le job — la panne suivante réalerte');

-- Le seuil, et pas une constante : 19 min sous un seuil de 20 min → rien ; 21 min → alerte.
select heartbeat_job('send-notification-emails', true, '{}'::jsonb, null);
update job_heartbeats set last_ok_at = now() - interval '19 minutes', created_at = now() - interval '2 hours'
 where job_name = 'send-notification-emails';
select is(job_watchdog('send-notification-emails', interval '20 minutes'), false, 'W10a : sous le seuil, rien');
update job_heartbeats set last_ok_at = now() - interval '21 minutes' where job_name = 'send-notification-emails';
select is(job_watchdog('send-notification-emails', interval '20 minutes'), true, 'W10b : au-delà du seuil, une alerte');

-- Les jobs attendus sont ceux des crons qui appellent une Edge Function : une coquille rendrait un
-- job muet pour toujours (son heartbeat sous un autre nom ne serait jamais lu).
select set_eq(
  $$ select job_name from job_expectations $$,
  $$ select jobname from cron.job where command ~ 'invoke_' $$,
  'W12 : les jobs attendus sont exactement les crons qui appellent une Edge Function, sous leur nom');

-- ── Jamais exécuté, au-delà de la grâce ──────────────────────────────────
-- Aucune ligne (W7 en a créé une, ancrée à maintenant) : le job n'a jamais été vu.
delete from job_heartbeats where job_name = 'pms-nightly-contract-check';
update job_expectations set created_at = now() - interval '37 hours' where job_name = 'pms-nightly-contract-check';
select is(job_watchdog('pms-nightly-contract-check', interval '36 hours'), true,
  'N1 : un job attendu jamais vu, au-delà de sa grâce (36 h), déclenche une alerte');
select is(
  (select count(*)::int from alertes
    where subject like '%pms-nightly-contract-check%'
      and strpos(body_html, '<p>Última ejecución exitosa: nunca.</p>') > 0
      and strpos(body_html, '<p>El job nunca se ejecutó: revisar el despliegue de la Edge Function pms-nightly-contract-check, los secretos pms_service_role_key y pms_functions_base_url del Vault y net._http_response.</p>') > 0),
  1,
  'N2 : une alerte, qui dit « nunca se ejecutó » et nomme ce qu''il faut vérifier (des noms, aucune valeur)');
select is(job_watchdog('pms-nightly-contract-check', interval '36 hours'), false,
  'N3 : une seule alerte — rien de plus tant que le job ne s''est pas exécuté avec succès');
select is(
  (select jsonb_build_object('ancre', created_at = now() - interval '37 hours', 'jamais', last_run_at is null, 'alerte', alerted_at = now())
     from job_heartbeats where job_name = 'pms-nightly-contract-check'),
  jsonb_build_object('ancre', true, 'jamais', true, 'alerte', true),
  'N4 : la ligne créée par le watchdog porte l''ancrage de l''attente et l''alerte');
-- Les noms du paragraphe « jamais exécuté » passent par html_text : un nom de job balisé (aucun ne
-- l'est aujourd'hui) n'entrerait jamais tel quel dans le HTML.
insert into job_heartbeats (job_name, created_at) values ('<b>job</b>', now() - interval '2 hours');
select job_watchdog('<b>job</b>', interval '1 hour');
select is(
  (select jsonb_build_object('echappe', strpos(body_html, 'Edge Function &lt;b&gt;job&lt;/b&gt;, los secretos') > 0, 'brut', strpos(body_html, '<b>job</b>') > 0)
     from alertes where subject like 'El job <b>job</b>%'),
  jsonb_build_object('echappe', true, 'brut', false),
  'N5 : le paragraphe « jamais exécuté » échappe le nom du job');

-- ── release_notification_email_claim ─────────────────────────────────────
insert into notification_emails (id, event_type, recipient_email, subject, body_html, status, attempts) values
  ('9a6b0000-0000-4000-8000-000000000011', 'partner_invitation', 'release-1@test.local', 's', '<p>c</p>', 'sending', 3),
  ('9a6b0000-0000-4000-8000-000000000012', 'partner_invitation', 'release-2@test.local', 's', '<p>c</p>', 'sending', 1),
  ('9a6b0000-0000-4000-8000-000000000013', 'partner_invitation', 'release-3@test.local', 's', '<p>c</p>', 'pending', 2),
  ('9a6b0000-0000-4000-8000-000000000014', 'partner_invitation', 'release-4@test.local', 's', '<p>c</p>', 'sent', 1),
  ('9a6b0000-0000-4000-8000-000000000015', 'partner_invitation', 'release-5@test.local', 's', '<p>c</p>', 'abandoned', 5);
select is(
  release_notification_email_claim(array['9a6b0000-0000-4000-8000-000000000011', '9a6b0000-0000-4000-8000-000000000012',
                                         '9a6b0000-0000-4000-8000-000000000013', '9a6b0000-0000-4000-8000-000000000014',
                                         '9a6b0000-0000-4000-8000-000000000015']::uuid[], 'clé refusée'),
  2, 'E1 : seuls les e-mails en cours d''envoi sont rendus');
select is(
  (select array_agg(status || ':' || attempts order by id) from notification_emails where id::text like '9a6b0000-%'),
  array['pending:2', 'pending:0', 'pending:2', 'sent:1', 'abandoned:5'],
  'E2 : rendus en attente, la tentative de la réclamation rendue ; envoyé, abandonné et déjà en attente ne bougent pas');
select is(
  (select array_agg(coalesce(last_error, '-') order by id) from notification_emails where id::text like '9a6b0000-%'),
  array['clé refusée', 'clé refusée', '-', '-', '-'],
  'E3 : le motif est gardé sur les e-mails rendus, et seulement sur eux');

select ok(
  not has_function_privilege('anon', 'public.job_watchdog(text, interval)', 'execute')
  and not has_function_privilege('authenticated', 'public.job_watchdog(text, interval)', 'execute')
  and not has_function_privilege('anon', 'public.jobs_watchdog()', 'execute')
  and not has_function_privilege('authenticated', 'public.jobs_watchdog()', 'execute')
  and not has_function_privilege('anon', 'public.release_notification_email_claim(uuid[], text)', 'execute')
  and not has_function_privilege('authenticated', 'public.release_notification_email_claim(uuid[], text)', 'execute'),
  'D1 : ni anon ni authenticated n''exécutent les fonctions de supervision');

-- Sans AUCUN admin pour la recevoir, l'alerte n'est pas marquée envoyée : on réessaiera.
update partner_capabilities set status = 'suspended' where role = 'admin';
select heartbeat_job('pms-sync-availability', false, '{}'::jsonb, 'timeout');
update job_heartbeats set created_at = now() - interval '2 hours' where job_name = 'pms-sync-availability';
create temp table w11 as select job_watchdog('pms-sync-availability', interval '20 minutes') as r;
select is(
  (select jsonb_build_object('r', r, 'alerte', (select alerted_at from job_heartbeats where job_name = 'pms-sync-availability'))
     from w11),
  jsonb_build_object('r', false, 'alerte', null),
  'W11 : aucun admin actif → aucun e-mail, le job n''est pas marqué alerté');

select * from finish();
rollback;
