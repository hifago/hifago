-- Supervision des jobs (migration 20261003223900) : job_watchdog, jobs_watchdog,
-- release_notification_email_claim.
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - un job qui n'a JAMAIS écrit de heartbeat n'est pas surveillé (aucune alerte au déploiement,
--     avant que les Edge Functions n'écrivent le leur) ; un job frais non plus ;
--   - un job en panne depuis plus que son seuil (et pas moins) déclenche UNE alerte admin, son
--     dernier message d'erreur échappé, puis plus rien tant qu'aucun run n'a réussi ; un succès le
--     réarme ; sans aucun admin pour la recevoir, il n'est pas marqué « alerté » ;
--   - jobs_watchdog surveille exactement les crons qui appellent une Edge Function (hors
--     payments-reconcile, qui a son propre watchdog), sous leur nom, et il est planifié ;
--   - release_notification_email_claim rend les e-mails réclamés sans consommer de tentative, garde
--     le motif, et ne touche à aucun e-mail envoyé, abandonné ou déjà en attente ;
--   - service_role seul.
-- ⚠️ `now()` est constant dans la transaction : on vieillit la DONNÉE, jamais l'horloge.
begin;
select plan(17);

insert into auth.users (id, email) values ('9a6b0000-0000-4000-8000-000000000001', 'watchdog-admin@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('9a6b0000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

create temp view alertes as
  select subject, body_html from notification_emails
   where event_type = 'admin_job_stalled' and recipient_email = 'watchdog-admin@test.local';

-- ── job_watchdog ─────────────────────────────────────────────────────────
delete from job_heartbeats where job_name in ('pms-poll-bookings', 'pms-cancel-bookings', 'pms-sync-availability',
                                                'send-notification-emails', 'pms-nightly-contract-check');
select is(job_watchdog('pms-poll-bookings', interval '45 minutes'), false,
  'W1 : un job qui n''a jamais écrit de heartbeat n''est pas surveillé');

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

-- Les noms surveillés sont ceux des crons qui appellent une Edge Function : une coquille dans
-- jobs_watchdog rendrait un job muet pour toujours (« pas de heartbeat » = « pas surveillé »).
select set_eq(
  $$ select (regexp_matches(pg_get_functiondef('public.jobs_watchdog()'::regprocedure), $r$job_watchdog\('([^']+)'$r$, 'g'))[1] $$,
  $$ select jobname from cron.job where command ~ 'invoke_' and jobname <> 'payments-reconcile' $$,
  'W12 : jobs_watchdog surveille exactement les crons qui appellent une Edge Function, sous leur nom');

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
