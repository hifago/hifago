-- Synchro PMS et jobs : base et supervision (déployée AVANT le code des Edge Functions).
--
-- Trois fonctions redéfinies, une fois chacune, depuis pg_get_functiondef (.claude/rules/supabase.md
-- règle 7, remplacements comptés) :
--   - enqueue_pms_cancellations (trigger) : plus de filtre sur le connecteur actif — un booking ne
--     reste plus orphelin chez Lobby quand sa commande expire connecteur coupé ;
--   - claim_pms_poll_batch : jamais un établissement sans jeton ; un appel Lobby par booking (les
--     activités héritent du booking de l'hébergement), aucune ligne attendue ;
--   - set_establishment_pms_connector : le jeton est normalisé (sans blancs autour ; vide = absent,
--     jamais écrit, et le journal d'audit ne dit « remplacé » que pour un vrai jeton) ; un jeton
--     remplacé fait passer en échec (vérification manuelle) les annulations encore en attente de
--     l'établissement, au lieu de les envoyer à un compte Lobby peut-être différent.
-- Créées (service_role seul, aucun appelant tant que les Edge Functions ne sont pas redéployées) :
--   - apply_pms_poll_outcome(ligne, 'gone'|'realized', détail) : l'issue du poll, sous verrou de la
--     commande — gone : lignes vivantes du booking annulées (cancelled_by_provider), places des
--     activités rendues, ledger, miroir marqué dû, une entrée de réconciliation avec son détail (une
--     commande payée n'est jamais remboursée d'office) ; realized : lignes échues réalisées,
--     commission due ;
--   - release_notification_email_claim(ids, motif) : rend des e-mails réclamés sans consommer de
--     tentative, en gardant le motif ;
--   - job_watchdog(job, seuil) et jobs_watchdog(), planifié toutes les 15 min : une alerte admin par
--     panne pour les jobs PMS et e-mails, seulement pour un job qui a déjà écrit un heartbeat. L'alerte
--     part par e-mail : celle du job d'envoi lui-même n'arrive qu'une fois l'envoi rétabli.

CREATE OR REPLACE FUNCTION public.enqueue_pms_cancellations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status)
  select distinct on (nr.pms_booking_id) nr.pms_booking_id, p.establishment_id, nr.status
    from new_rows nr
    join public.products p on p.id = nr.product_id
    join public.establishments e on e.id = p.establishment_id
   where nr.pms_booking_id is not null
     -- LISTE BLANCHE, jamais « tout sauf reserved » : `fulfilled` et `no_show` ne sont pas des
     -- annulations. Le séjour a eu lieu (ou la nuit reste due) — annuler chez le partenaire
     -- effacerait une réservation légitime.
     and nr.status in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded')
     -- Migration 20261003223900 : PLUS de filtre sur le connecteur actif. Une commande expirée ou
     -- annulée pendant que le connecteur est coupé laissait son booking orphelin chez Lobby ;
     -- l'entrée attend désormais la réactivation (claim_pms_cancellation_batch ne réclame que
     -- les établissements au connecteur actif et au jeton présent).
     -- Le booking est PARTAGÉ entre lignes : on ne l'annule que s'il ne porte plus aucune
     -- réservation vivante (spec 25 §3.2).
     and not exists (
       select 1
         from public.order_lines ol
        where ol.pms_booking_id = nr.pms_booking_id
          and ol.status = 'reserved'
     )
  on conflict (pms_booking_id) where status = 'pending' do nothing;

  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_pms_poll_batch(p_limit integer DEFAULT 20)
 RETURNS TABLE(order_line_id uuid, pms_booking_id text, establishment_id uuid, lobby_api_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Migration 20261003223900 : (1) un établissement sans jeton n'est jamais réclamé (même filtre que
  -- claim_pms_cancellation_batch) — sinon un 401 Lobby à chaque passage ; (2) UN appel Lobby par
  -- BOOKING : les lignes d'activité héritent du booking de l'hébergement. Une ligne représentante
  -- par booking (la plus petite) est rendue ; ses lignes vivantes libres sont marquées interrogées
  -- (une sœur tenue par une autre transaction est laissée au passage suivant).
  -- Un booking est identifié par (numéro, établissement) : deux comptes Lobby peuvent porter le
  -- même numéro. Aucune ligne n'est attendue (skip locked) : jamais d'interblocage.
  return query
    with candidates as (
      select ol.id, ol.pms_booking_id, p.establishment_id
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        join public.establishments e on e.id = p.establishment_id
       where ol.pms_booking_id is not null
         and ol.status = 'reserved'
         and e.lobby_connector_active = true
         and e.lobby_api_token is not null
       order by ol.pms_last_polled_at asc nulls first
       limit p_limit
       for update of ol skip locked
    ),
    siblings as (
      select ol.id
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
       where ol.status = 'reserved'
         and (ol.pms_booking_id, p.establishment_id) in (
           select c.pms_booking_id, c.establishment_id from candidates c
         )
       for update of ol skip locked
    ),
    polled as (
      update public.order_lines ol
         set pms_last_polled_at = now()
        from public.products p
       where p.id = ol.product_id
         and ol.id in (select sb.id from siblings sb)
      returning ol.id, ol.pms_booking_id, p.establishment_id
    )
    select distinct on (pl.pms_booking_id, pl.establishment_id)
           pl.id, pl.pms_booking_id, pl.establishment_id, e.lobby_api_token
      from polled pl
      join public.establishments e on e.id = pl.establishment_id
     order by pl.pms_booking_id, pl.establishment_id, pl.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_establishment_pms_connector(p_establishment_id uuid, p_lobby_api_token text DEFAULT NULL::text, p_connector_active boolean DEFAULT false, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_before record;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'set_establishment_pms_connector réservé au rôle admin' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'motif obligatoire pour modifier le connecteur PMS';
  end if;

  select lobby_connector_active, lobby_has_token, lobby_api_token into v_before
    from public.establishments where id = p_establishment_id for update;
  if not found then
    raise exception 'établissement introuvable';
  end if;

  update public.establishments
     -- Migration 20261003223900 : un jeton vide ou fait de blancs est ABSENT (jamais écrit), et un jeton
     -- est stocké sans blancs autour (espaces, tabulations, retours à la ligne).
     set lobby_api_token = coalesce(nullif(btrim(p_lobby_api_token, E' \t\r\n'), ''), lobby_api_token),
         lobby_connector_active = p_connector_active
   where id = p_establishment_id;

  -- Migration 20261003223900 : un jeton REMPLACÉ peut ouvrir un AUTRE compte Lobby, où un numéro de
  -- booking ne désigne plus la même réservation. Les annulations encore en attente (posées
  -- avec l'ancien jeton, y compris connecteur coupé) passent en échec pour une vérification
  -- manuelle — le contrôle nocturne compte les échecs — au lieu de partir vers ce compte.
  -- « Remplacé » se juge sur les jetons normalisés : ni un premier jeton, ni le même jeton
  -- recollé avec des espaces, ni un champ vide ne déclenchent rien.
  if nullif(btrim(p_lobby_api_token, E' \t\r\n'), '') is not null
     and nullif(btrim(v_before.lobby_api_token, E' \t\r\n'), '') is not null
     and nullif(btrim(p_lobby_api_token, E' \t\r\n'), '') <> nullif(btrim(v_before.lobby_api_token, E' \t\r\n'), '') then
    update public.pms_cancellation_queue
       set status = 'failed', processed_at = now(),
           last_error = 'jeton Lobby remplacé : annulation à vérifier à la main avant tout renvoi'
     where establishment_id = p_establishment_id and status = 'pending';
  end if;

  perform public.log_admin_action(
    'establishment.set_pms_connector', 'establishments', p_establishment_id,
    jsonb_build_object('connector_active', v_before.lobby_connector_active, 'had_token', v_before.lobby_has_token),
    jsonb_build_object('connector_active', p_connector_active, 'token_replaced', nullif(btrim(p_lobby_api_token, E' \t\r\n'), '') is not null),
    p_reason
  );
  return jsonb_build_object('ok', true);
end;
$function$;

create function public.apply_pms_poll_outcome(p_order_line_id uuid, p_outcome text, p_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order_id uuid;
  v_booking text;
  v_establishment_id uuid;
  v_order record;
  v_line_ids uuid[];
  v_due_ids uuid[];
  v_line_id uuid;
  v_entry_line uuid;
  v_from date;
  v_to date;
begin
  if p_outcome is null or p_outcome not in ('gone', 'realized') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_outcome');
  end if;

  -- Lecture non verrouillante de la ligne, puis le verrou de la COMMANDE d'abord (règle 8 de
  -- .claude/rules/supabase.md) — même ordre qu'expire_payment_order et modify_order_line. Ni la
  -- commande ni le booking d'une ligne ne changent (record_pms_booking n'écrit qu'un booking absent).
  select ol.order_id, ol.pms_booking_id, p.establishment_id into v_order_id, v_booking, v_establishment_id
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = p_order_line_id;
  if not found or v_booking is null then
    return jsonb_build_object('ok', false, 'reason', 'line_not_found');
  end if;

  select o.id, o.reference, o.payment_status into v_order
    from public.orders o
   where o.id = v_order_id for update;

  -- Les lignes VIVANTES du booking, relues sous ce verrou : un booking Lobby appartient à une
  -- commande et à un établissement (deux comptes Lobby peuvent porter le même numéro) — la nuit, et
  -- les activités qui en héritent (reserve-nights).
  with l as (
    select ol.id from public.order_lines ol
      join public.products p on p.id = ol.product_id
     where ol.order_id = v_order_id and ol.pms_booking_id = v_booking and ol.status = 'reserved'
       and p.establishment_id = v_establishment_id
     order by ol.id
     for update of ol
  )
  select coalesce(array_agg(id), array[]::uuid[]) into v_line_ids from l;

  -- Idempotent : plus aucune ligne vivante sur ce booking (second appel, ou toutes annulées,
  -- expirées, remplacées entre-temps) → rien. Une ligne passée morte dont des sœurs vivent encore
  -- n'empêche pas de traiter le booking : c'est lui qui a disparu ou a été réalisé.
  if array_length(v_line_ids, 1) is null then
    return jsonb_build_object('ok', false, 'reason', 'no_live_line');
  end if;

  if p_outcome = 'realized' then
    -- Le séjour a eu lieu chez Lobby : la nuit ET les activités du même booking sont réalisées
    -- (commission due), mais seulement celles dont la date est passée — une excursion prévue après
    -- le départ reste réservée, et un poll suivant la réalisera à sa date. Aucune place ne revient.
    select coalesce(array_agg(ol.id order by ol.id), array[]::uuid[]) into v_due_ids
      from public.order_lines ol
     where ol.id = any(v_line_ids)
       and coalesce(ol.end_date, ol.date) <= public.today_in_bogota();
    if array_length(v_due_ids, 1) is not null then
      update public.order_lines set status = 'fulfilled' where id = any(v_due_ids);
      perform public.apply_order_line_ledger_transition(v_due_ids, 'fulfilled');
    end if;
    return jsonb_build_object('ok', true, 'outcome', 'realized', 'lines', coalesce(array_length(v_due_ids, 1), 0));
  end if;

  -- 'gone' : le booking n'existe plus chez Lobby.
  perform public.lock_order_capacity_rows(v_line_ids);
  -- G2 : les places des lignes d'ACTIVITÉ reviennent (une nuit PMS n'a jamais été
  -- décrémentée : release_order_line_capacity ne lui rend rien).
  foreach v_line_id in array v_line_ids loop
    perform public.release_order_line_capacity(v_line_id);
  end loop;

  -- UNE SEULE instruction : le trigger d'annulation PMS est FOR EACH STATEMENT.
  update public.order_lines set status = 'cancelled_by_provider' where id = any(v_line_ids);

  perform public.apply_order_line_ledger_transition(v_line_ids, 'cancelled_by_provider');

  -- Le miroir, en UN appel sur la plage du booking : mark_pms_sync_due parcourt les mois dans
  -- l'ordre, jamais un verrou de mois pris à rebours.
  select min(ol.date), max(coalesce(ol.end_date, ol.date)) into v_from, v_to
    from public.order_lines ol
   where ol.id = any(v_line_ids);
  perform public.mark_pms_sync_due(v_establishment_id, v_from, v_to);

  -- La trace de l'admin. Une commande PAYÉE n'est jamais remboursée d'office (pas de
  -- refund_required automatique sur un booking disparu) : l'entrée le dit, et payment_status ne
  -- bouge pas.
  v_entry_line := case when p_order_line_id = any(v_line_ids) then p_order_line_id else v_line_ids[1] end;
  insert into public.pms_reconciliation_entries (order_line_id, detail)
  values (
    v_entry_line,
    'booking Lobby ' || v_booking || ' introuvable chez Lobby'
      || coalesce(' (' || nullif(btrim(p_detail), '') || ')', '')
      || ' — ' || array_length(v_line_ids, 1) || ' ligne(s) annulée(s), commande ' || v_order.reference
      || case when v_order.payment_status in ('paid', 'partially_refunded')
            then ' — commande PAYÉE : remboursement à décider'
            when v_order.payment_status = 'pending'
            then ' — un paiement est en cours : s''il aboutit, il sera à rembourser'
            else '' end
  );

  return jsonb_build_object('ok', true, 'outcome', 'gone', 'lines', array_length(v_line_ids, 1));
end;
$function$;

comment on function public.apply_pms_poll_outcome(uuid, text, text) is
  'Issue du poll Lobby pour le booking d''une ligne : gone → lignes vivantes du booking annulées (places des activités rendues, ledger, miroir, entrée de réconciliation), realized → lignes échues réalisées. Sous verrou de la commande. service_role seul.';

revoke all on function public.apply_pms_poll_outcome(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_pms_poll_outcome(uuid, text, text) to service_role;

create function public.release_notification_email_claim(p_ids uuid[], p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  -- Rend aux e-mails réclamés ce que la réclamation leur a pris (claim_notification_email_batch :
  -- statut `sending`, une tentative de plus) et garde le motif. Un refus au niveau de la CLÉ ou du
  -- COMPTE du fournisseur ne dit rien de l'e-mail : il ne doit pas consommer une de ses 5
  -- tentatives. Seules les lignes encore `sending` sont rendues (jamais un envoyé ou un abandonné).
  update public.notification_emails
     set status = 'pending', attempts = greatest(attempts - 1, 0), last_error = coalesce(p_reason, last_error)
   where id = any(p_ids) and status = 'sending';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.release_notification_email_claim(uuid[], text) from public, anon, authenticated;
grant execute on function public.release_notification_email_claim(uuid[], text) to service_role;

create function public.job_watchdog(p_job text, p_stale interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hb record;
  v_subject text;
  v_sent integer;
begin
  -- Verrouillée : un heartbeat en cours d'écriture est attendu, jamais lu dans son état d'avant.
  select * into v_hb from public.job_heartbeats where job_name = p_job for update;
  -- Un job qui n'a JAMAIS écrit de heartbeat n'a pas de ligne (heartbeat_job la crée) : il
  -- n'est pas surveillé. Le watchdog ne crie donc pas au déploiement, avant que la fonction
  -- n'écrive son premier heartbeat.
  if not found then
    return false;
  end if;

  -- Une alerte par panne : rien de plus tant qu'aucun run n'a réussi depuis la dernière alerte.
  if coalesce(v_hb.last_ok_at, v_hb.created_at) < now() - p_stale
     and (v_hb.alerted_at is null or v_hb.alerted_at < coalesce(v_hb.last_ok_at, v_hb.created_at)) then
    v_subject := 'El job ' || p_job || ' no responde (sin ejecución exitosa desde hace más de '
      || case when p_stale >= interval '1 hour'
              then round(extract(epoch from p_stale) / 3600)::int || ' h'
              else round(extract(epoch from p_stale) / 60)::int || ' min' end
      || ')';
    perform public.notify_all_admins(
      'admin_job_stalled',
      v_subject,
      '<p>Job: ' || public.html_text(p_job) || '.</p>'
        || '<p>Última ejecución exitosa: '
        || coalesce(to_char(v_hb.last_ok_at at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') || ' (hora de Colombia)', 'nunca')
        || '.</p>'
        || '<p>Último error: ' || coalesce(public.html_text(v_hb.last_error), '—') || '.</p>',
      'job_heartbeats', null
    );
    -- « Alertée » seulement si un e-mail est réellement parti en file (aucun admin actif, ou
    -- tous les envois en échec → on réessaiera au prochain passage).
    select count(*) into v_sent from public.notification_emails
     where event_type = 'admin_job_stalled' and related_table = 'job_heartbeats'
       and subject = v_subject and created_at = now();
    if v_sent = 0 then
      return false;
    end if;
    update public.job_heartbeats set alerted_at = now() where job_name = p_job;
    return true;
  end if;
  return false;
end;
$function$;

revoke all on function public.job_watchdog(text, interval) from public, anon, authenticated;
grant execute on function public.job_watchdog(text, interval) to service_role;

create function public.jobs_watchdog()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Les noms sont ceux des crons qui appellent les Edge Functions (jobs_watchdog.test.sql vérifie
  -- l'égalité avec cron.job) ; les fonctions devront passer ces mêmes noms à heartbeat_job. Seuils : 3 à 4 passages
  -- manqués (le quotidien : 36 h, une alerte environ 12 h après un passage manqué). payments-reconcile
  -- garde son propre watchdog (payments_reconcile_watchdog). ⚠️ L'alerte part par e-mail : celle du
  -- job send-notification-emails lui-même ne part qu'une fois l'envoi rétabli.
  perform public.job_watchdog('pms-poll-bookings', interval '45 minutes');
  perform public.job_watchdog('pms-cancel-bookings', interval '40 minutes');
  perform public.job_watchdog('pms-sync-availability', interval '20 minutes');
  perform public.job_watchdog('send-notification-emails', interval '20 minutes');
  perform public.job_watchdog('pms-nightly-contract-check', interval '36 hours');
end;
$function$;

revoke all on function public.jobs_watchdog() from public, anon, authenticated;
grant execute on function public.jobs_watchdog() to service_role;

select cron.schedule('jobs-watchdog', '*/15 * * * *', $$select public.jobs_watchdog();$$);
