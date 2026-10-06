-- Garde-fou permanent : la liste des RPC dont la protection EST le grant, et rien d'autre.
--
-- Ces fonctions n'ont aucun moyen de vérifier en SQL qui les appelle (pas de is_admin(auth.uid()),
-- pas de RLS — elles sont SECURITY DEFINER). Leur seule barrière est l'absence d'EXECUTE pour les
-- rôles de la Data API. Le 2026-08-27, deux d'entre elles l'avaient perdue sans que rien ne le
-- dise : `apply_payment_webhook` ne l'avait jamais eue (revoke `from public` seul, inopérant face
-- aux privilèges par défaut de Supabase qui grantent anon/authenticated explicitement) et
-- `claim_pms_cancellation_batch` l'a reperdue le jour même, recréée sous une nouvelle signature.
--
-- Liste explicite et non déduite : « quelle RPC doit être service_role-seul » est un jugement
-- métier, c'est le point (5) laissé non automatisé dans rls_rpc_only_checklist.test.sql faute de
-- convention machine-lisible. Une liste que l'on tient à la main est la version étroite qui
-- n'oblige pas à en inventer une. AJOUTER ICI toute nouvelle RPC appelée uniquement par une Edge
-- Function, un cron ou un Route Handler serveur, et tout helper interne révoqué.
--
-- Depuis le 2026-10-06 (audit P12c), la liste est tenue UNE fois (table temporaire ci-dessous) et
-- vérifiée dans les deux sens : aucune fonction listée n'est exécutable par anon/authenticated
-- (1), chaque nom existe (2), et toute fonction de public fermée à ces deux rôles est listée (3).
-- Sans (3), une fonction révoquée mais jamais nommée échappait à la garde : un grant rétabli plus
-- tard la rouvrait sans que rien ne rougisse.

begin;
select plan(3);

create temp table tmp_grant_only (name text primary key);
insert into tmp_grant_only (name) values
  ('apply_payment_webhook'),
  ('claim_notification_email_batch'),
  ('claim_pms_cancellation_batch'),
  ('claim_pms_poll_batch'),
  ('mark_notification_email_failed'),
  ('mark_notification_email_sent'),
  ('requeue_pms_cancellation'),
  ('resolve_pms_cancellation'),
  -- Deuxième vague (20260828010000) : appelée uniquement par set_order_line_status, écrit
  -- dans ledger_entries sans aucun contrôle propre.
  ('apply_order_line_ledger_transition'),
  -- Réordonnancement PMS (20260829100000) : appelée uniquement par /api/pms/reserve-nights,
  -- qui seul sait que LobbyPMS a refusé. Elle REND DES PLACES et annule des lignes — donc
  -- directement monnayable si un client pouvait l'appeler avec l'UUID d'une commande.
  ('release_order_after_pms_refusal'),
  -- Fonctions de cron (`cron.schedule`) : aucun appelant humain légitime.
  -- 'expire_stale_payment_orders' : supprimée le 2026-09-21 (20260921100100), remplacée par
  -- expire_payment_order ci-dessous.
  ('invoke_pms_poll_bookings'),
  ('invoke_pms_cancel_bookings'),
  ('invoke_pms_nightly_contract_check'),
  ('invoke_pms_sync_availability'),
  ('invoke_send_notification_emails'),
  -- Miroir de disponibilité LobbyPMS (20260917140000). `claim_pms_sync_batch` renvoie le
  -- JETON LOBBY EN CLAIR — c'est la plus sensible des trois. Les deux autres écrivent le
  -- miroir et son état de synchronisation, que rien d'autre que le cron n'a à toucher.
  ('claim_pms_sync_batch'),
  ('sync_pms_availability_month'),
  ('fail_pms_sync'),
  -- Invalidation du miroir depuis un événement hifago (20260918170000). Ni l'une ni l'autre
  -- ne vérifie l'appelant en SQL — leur seule barrière est le grant.
  ('mark_pms_sync_due'),
  ('mark_pms_sync_due_for_order_line'),
  -- Réconciliation Mercado Pago (20260921100000, spec 39). `release_order_line_capacity` et
  -- `lock_order_capacity_rows` RENDENT DES PLACES sur simple UUID de ligne — les plus
  -- monnayables du lot ; `expire_payment_order` et `reconcile_order` défont des commandes ;
  -- les claims exposent l'état des paiements ; le wrapper et le watchdog sont du cron.
  ('heartbeat_job'),
  ('lock_order_capacity_rows'),
  ('release_order_line_capacity'),
  ('expire_payment_order'),
  ('apply_payment_webhook_checked'),
  ('claim_orders_to_reconcile'),
  ('claim_payments_to_watch'),
  ('reconcile_order'),
  ('mark_mp_cancel_attempt'),
  ('record_mp_payment_status'),
  ('invoke_payments_reconcile'),
  ('payments_reconcile_watchdog'),
  -- Remboursements (20260922100000, D3) : exécutés par le job, jamais par un humain.
  ('claim_payment_refunds'),
  ('finalize_payment_refund'),
  ('fail_payment_refund'),
  -- Lobby avant paiement (20260930221837) : appelées uniquement par /api/pms/reserve-nights.
  -- Le claim renvoie le JETON LOBBY en clair ; record et release écrivent la commande.
  ('claim_order_for_pms_booking'),
  ('record_pms_booking'),
  ('release_pms_reserve_claim'),
  -- Échéance de paiement (migration 20261001194704) : lue par les RPC qui en ont besoin.
  ('order_payment_deadline'),
  -- Synchro PMS et supervision (migration 20261003223900) : l'issue du poll REND DES PLACES et
  -- annule des lignes sur simple UUID ; la libération touche la file d'e-mails ; les watchdogs
  -- sont du cron.
  ('apply_pms_poll_outcome'),
  ('release_notification_email_claim'),
  ('job_watchdog'),
  ('jobs_watchdog'),
  -- Rendu des réclamations non traitées par les jobs (migration 20261006124933).
  ('release_pms_cancellation_claim'),
  ('release_pms_poll_claim'),
  -- Annulation d'une prestation (migration 20261006192424) : la clôture commune et son e-mail,
  -- SANS garde, appelés sous les verrous de cancel_order_line / set_order_line_status ; la règle
  -- `cancellable` et sa projection, lues par cancel_order_line et list_my_orders.
  ('close_order_line_locked'),
  ('notify_order_line_cancelled'),
  ('order_line_client_cancellable'),
  ('order_jsonb_with_client_cancellable'),
  -- Helpers INTERNES (audit P12c, 2026-10-06) : appelés uniquement par d'autres fonctions SECURITY
  -- DEFINER (exécutées en propriétaire) ou par des triggers, jamais par un client. Aucun garde
  -- propre : leur seule barrière est le grant, exactement comme les RPC ci-dessus.
  ('enqueue_notification_email'),      -- file d'e-mails : create_order, moderate_*, apply_payment_webhook…
  ('notify_all_admins'),               -- une alerte par admin : watchdogs, triggers de propositions
  ('html_text'),                       -- échappement des corps d'e-mails (révoquée par P5c)
  ('order_for_client_jsonb'),          -- projection client : get_order_by_token, list_my_orders
  ('establishment_slug_from_name'),    -- trigger set_establishment_slug (sondait les slugs, 20260922110000)
  ('product_slug_from_name'),          -- trigger set_product_slug (20261001235031)
  ('open_default_lodging_availability'), -- create_product_from_proposal et le roulement nocturne
  ('create_product_from_proposal'),    -- moderate_product_proposal seule (20261006182227)
  -- Crons sans Edge Function : aucun appelant humain légitime.
  ('purge_expired_anonymous_identities'), -- cron purge-expired-anonymous-identities
  ('roll_lodging_availability_window');   -- cron roll-lodging-availability

select is(
  (
    select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.proname), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (select name from tmp_grant_only)
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ),
  '',
  'aucune RPC service_role-seul n''est exécutable par anon ou authenticated (le grant EST la protection)'
);

-- Revue adversariale (P4a) : la requête ci-dessus ignore silencieusement un nom ABSENT ou mal
-- orthographié — une RPC renommée sortirait de la garde sans que rien ne rougisse. Chaque nom de la
-- liste doit exister.
select is(
  (
    select coalesce(string_agg(t.name, ', ' order by t.name), '')
    from tmp_grant_only t
    where not exists (
      select 1 from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = t.name
    )
  ),
  '',
  'chaque RPC de la liste existe (aucun nom absent ou mal orthographié)'
);

-- Sens inverse : toute fonction de public qu'aucun rôle de la Data API ne peut exécuter est
-- listée. Hors champ, comme dans rls_rpc_only_checklist : fonctions d'extension, en C ou
-- internes, et `returns trigger` (jamais appelables directement).
select is(
  (
    select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.proname), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.prokind = 'f'
      and l.lanname not in ('c', 'internal')
      and pg_get_function_result(p.oid) <> 'trigger'
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and p.proname not in (select name from tmp_grant_only)
  ),
  '',
  'toute fonction de public fermée à anon et authenticated est nommée dans la liste'
);

select * from finish();
rollback;
