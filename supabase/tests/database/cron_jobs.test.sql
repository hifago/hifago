-- Garde-fou (audit P12c, 2026-10-06) : la liste EXACTE des jobs pg_cron actifs — nom, cadence,
-- commande. Rien ne la vérifiait en entier : jobs_watchdog.test.sql (W12) ne compare que les crons
-- qui appellent une Edge Function aux jobs attendus. Un job SQL désactivé (`active = false`),
-- désinscrit par une migration (`cron.unschedule`) ou dont la cadence change en silence passait.
-- La cadence n'est pas un détail : la fréquence du cron PMS est un arbitrage de Jérôme
-- (CLAUDE.md §10). Ajouter, retirer ou recadencer un job = mettre cette liste à jour, dans la même
-- migration que le geste.
begin;
select plan(1);

select is(
  array(
    select jobname || ' | ' || schedule || ' | ' || command
    from cron.job
    where active
    order by jobname
  ),
  array[
    'jobs-watchdog | */15 * * * * | select public.jobs_watchdog();',
    'payments-reconcile | */2 * * * * | select invoke_payments_reconcile();',
    'payments-reconcile-watchdog | */15 * * * * | select payments_reconcile_watchdog();',
    'pms-cancel-bookings | */10 * * * * | select invoke_pms_cancel_bookings();',
    'pms-nightly-contract-check | 0 7 * * * | select invoke_pms_nightly_contract_check();',
    'pms-poll-bookings | */15 * * * * | select invoke_pms_poll_bookings();',
    'pms-sync-availability | */5 * * * * | select invoke_pms_sync_availability();',
    'purge-expired-anonymous-identities | 0 4 * * * | select purge_expired_anonymous_identities();',
    'roll-lodging-availability | 0 8 * * * | select roll_lodging_availability_window();',
    'send-notification-emails | */5 * * * * | select invoke_send_notification_emails();'
  ],
  'jobs pg_cron actifs : exactement la liste attendue (nom | cadence | commande)'
);

select * from finish();
rollback;
