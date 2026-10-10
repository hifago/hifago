-- Identité d'un booking LobbyPMS : (numéro, établissement), partout.
--
-- Deux établissements — deux comptes Lobby — peuvent porter le même numéro de booking. La
-- réclamation de la file (claim_pms_cancellation_batch) et l'issue du poll (apply_pms_poll_outcome)
-- raisonnaient déjà sur (numéro, établissement) ; le reste, sur le numéro seul :
--   - le trigger enqueue_pms_cancellations n'enfilait pas l'annulation d'un booking tant qu'un AUTRE
--     établissement avait une ligne réservée sous le même numéro ;
--   - l'index pms_cancellation_queue_pending_uniq (numéro seul) absorbait l'entrée en attente du
--     second établissement : son booking restait chez Lobby ;
--   - record_pms_booking et release_order_after_pms_refusal : mêmes contrôles, même index ;
--   - resolve_pms_cancellation étendait la resynchronisation du miroir aux dates de l'autre
--     établissement ;
--   - l'e-mail d'annulation au prestataire (notify_order_line_cancelled) lisait la file par numéro.
-- Aussi : deux commentaires faux depuis 20261003223900 (le trigger ne filtre plus le connecteur).
-- Fonctions redéfinies depuis pg_get_functiondef, signatures et droits inchangés.

-- Le remplacement de l'index prend un verrou ACCESS EXCLUSIVE sur la file : jamais d'attente sans
-- borne derrière une longue transaction (même garde que 20261004005336).
select set_config('lock_timeout', '5s', true);

drop index public.pms_cancellation_queue_pending_uniq;
create unique index pms_cancellation_queue_pending_uniq
  on public.pms_cancellation_queue (pms_booking_id, establishment_id)
  where status = 'pending';

CREATE OR REPLACE FUNCTION public.enqueue_pms_cancellations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status)
  select distinct on (nr.pms_booking_id, p.establishment_id) nr.pms_booking_id, p.establishment_id, nr.status
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
     -- réservation vivante (spec 25 §3.2). Migration 20261006235357 : un booking, c'est un numéro
     -- DANS un établissement (deux comptes Lobby peuvent porter le même numéro).
     and not exists (
       select 1
         from public.order_lines ol
         join public.products p2 on p2.id = ol.product_id
        where ol.pms_booking_id = nr.pms_booking_id
          and p2.establishment_id = p.establishment_id
          and ol.status = 'reserved'
     )
  on conflict (pms_booking_id, establishment_id) where status = 'pending' do nothing;

  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_pms_booking(p_order_id uuid, p_claimed_at timestamp with time zone, p_order_line_id uuid, p_pms_booking_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claimed_at timestamptz;
  v_reference text;
  v_line record;
  v_establishment_id uuid;
  v_changed_at timestamptz;
  v_old boolean;
  v_reason text;
  v_queue_status text;
begin
  -- Le jeton est obligatoire : sans lui, `null is distinct from null` laisserait enregistrer un
  -- booking hors de tout claim.
  if p_order_id is null or p_claimed_at is null or p_order_line_id is null
     or nullif(btrim(p_pms_booking_id), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_arguments');
  end if;

  -- Règle 8 : `orders` d'abord (on écrit une ligne fille et on peut enfiler).
  select o.pms_reserve_claimed_at, o.reference into v_claimed_at, v_reference
    from public.orders o
   where o.id = p_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- Migration 20261004005336 : l'établissement en `for share` AVANT la ligne (orders → établissement →
  -- ligne) : un remplacement de jeton en cours est attendu, et son instant relu après lui. Jamais
  -- après le verrou de la ligne : le remplacement accroche ses entrées aux lignes bookées (clé
  -- étrangère, KEY SHARE), dont celle-ci quand elle porte déjà un booking — interblocage.
  select p.establishment_id into v_establishment_id
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = p_order_line_id and ol.order_id = p_order_id;
  select e.lobby_token_changed_at into v_changed_at
    from public.establishments e where e.id = v_establishment_id for share;
  -- Un booking posé avec un jeton lu (au claim, p_claimed_at) AVANT le dernier remplacement est
  -- ANCIEN : il ne sera jamais interrogé ni annulé avec le jeton courant.
  v_old := coalesce(p_claimed_at < v_changed_at, false);

  select ol.status, ol.pms_booking_id, ol.end_date, p.establishment_id
    into v_line
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = p_order_line_id and ol.order_id = p_order_id
   for update of ol;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'line_not_found');
  end if;

  if v_line.pms_booking_id = p_pms_booking_id then
    -- Rejeu (réponse perdue) ou activité rattachée au booking principal déjà posé : rien à faire.
    return jsonb_build_object('ok', true, 'idempotent', true);
  elsif v_claimed_at is distinct from p_claimed_at then
    -- Le claim a expiré et un autre appelant a la main : ce booking est surnuméraire.
    v_reason := 'claim_stale';
    v_queue_status := 'superseded';
  elsif v_line.pms_booking_id is not null then
    -- I1 : la ligne porte déjà un AUTRE booking ; celui-ci est un doublon.
    v_reason := 'already_booked';
    v_queue_status := 'superseded';
  elsif v_line.status <> 'reserved' then
    -- La ligne est morte entre le claim et ici (expirée, annulée) : on garde la trace du booking
    -- sur la ligne, puis il part en annulation.
    update public.order_lines set pms_booking_id = p_pms_booking_id, pms_booked_at = p_claimed_at where id = p_order_line_id;
    v_reason := 'line_not_reserved';
    v_queue_status := v_line.status;
  else
    update public.order_lines set pms_booking_id = p_pms_booking_id, pms_booked_at = p_claimed_at where id = p_order_line_id;
    -- Le miroir de disponibilité doit savoir tout de suite que ces nuits sont prises chez Lobby
    -- (migration 20260918170000) — dans la même transaction, plus en best-effort séparé.
    -- Best-effort, comme dans la route avant : un échec ici retarde le reflet du miroir, il ne doit
    -- jamais faire échouer l'enregistrement d'un booking déjà acté chez Lobby.
    -- Migration 20261004005336 : le jeton a été remplacé entre le claim et ici — le booking a été posé
    -- avec l'ancien. Une entrée de réconciliation, muette (le remplacement a envoyé son
    -- récapitulatif), le fait vérifier à la main ; claim_pms_poll_batch ne le prendra jamais.
    if v_old then
      insert into public.pms_reconciliation_entries (order_line_id, detail)
      select p_order_line_id,
             'jeton Lobby remplacé le ' || to_char(v_changed_at at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI')
             || ' (heure de Colombie) : booking Lobby ' || p_pms_booking_id
             || ' posé avec l''ancien jeton, plus interrogé ni annulé automatiquement — à vérifier chez '
             || 'Lobby, puis clore la ligne à la main (changement de statut), commande ' || v_reference
       where not exists (
         select 1
           from public.pms_reconciliation_entries r
           join public.order_lines ol2 on ol2.id = r.order_line_id
           join public.products p2 on p2.id = ol2.product_id
          where r.status in ('open', 'retrying')
            and r.detail like 'jeton Lobby remplacé%'
            and strpos(r.detail, ' : booking Lobby ' || p_pms_booking_id || ' posé ') > 0
            and ol2.order_id = p_order_id
            and p2.establishment_id = v_establishment_id
       )
      ;
    end if;
    if v_line.end_date is not null then
      begin
        perform public.mark_pms_sync_due_for_order_line(p_order_line_id);
      exception when others then
        raise warning 'record_pms_booking : invalidation du miroir impossible (%) — reflet retardé', sqlerrm;
      end;
    end if;
    return jsonb_build_object('ok', true);
  end if;

  -- Un booking qu'aucune ligne vivante ne porte part TOUJOURS en file d'annulation, explicitement.
  -- Jamais délégué au seul trigger enqueue_pms_cancellations : pour un booking surnuméraire
  -- (claim_stale, already_booked), aucune ligne n'est mise à jour et le trigger ne part pas.
  -- L'entrée attend la réactivation d'un connecteur coupé (claim_pms_cancellation_batch ne prend
  -- que les établissements actifs) ; si le trigger l'a déjà posée (line_not_reserved), l'index
  -- partiel absorbe le doublon. Migration 20261006235357 : un booking, c'est un numéro DANS un
  -- établissement — les lignes vivantes et l'index se lisent sur les deux.
  -- Migration 20261004005336 : un booking ANCIEN ne part jamais en annulation avec le jeton courant — il
  -- entre en file directement en échec (vérification manuelle), et l'annulation que le trigger
  -- vient peut-être de poser (line_not_reserved) y passe aussi.
  if v_old then
    update public.pms_cancellation_queue
       set status = 'failed', processed_at = now(), last_error = 'jeton Lobby remplacé : annulation à vérifier à la main avant tout renvoi'
     where pms_booking_id = p_pms_booking_id and establishment_id = v_line.establishment_id
       and status = 'pending';
    insert into public.pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status, status, processed_at, last_error)
    select p_pms_booking_id, v_line.establishment_id, v_queue_status, 'failed', now(), 'jeton Lobby remplacé : annulation à vérifier à la main avant tout renvoi'
     where not exists (
       select 1 from public.order_lines ol
         join public.products p on p.id = ol.product_id
        where ol.pms_booking_id = p_pms_booking_id and p.establishment_id = v_line.establishment_id
          and ol.status = 'reserved'
     )
       and not exists (
       select 1 from public.pms_cancellation_queue q
        where q.pms_booking_id = p_pms_booking_id and q.establishment_id = v_line.establishment_id
          and q.status in ('pending', 'failed')
     );
  else
    insert into public.pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status)
    select p_pms_booking_id, v_line.establishment_id, v_queue_status
     where not exists (
       select 1 from public.order_lines ol
         join public.products p on p.id = ol.product_id
        where ol.pms_booking_id = p_pms_booking_id and p.establishment_id = v_line.establishment_id
          and ol.status = 'reserved'
     )
    on conflict (pms_booking_id, establishment_id) where status = 'pending' do nothing;
  end if;

  return jsonb_build_object('ok', false, 'reason', v_reason);
end;
$function$;

CREATE OR REPLACE FUNCTION public.release_order_after_pms_refusal(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_released_ids uuid[];
  v_line_id uuid;
  v_payment_status text;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'order_required');
  end if;

  select payment_status into v_payment_status from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- Ajout de la migration 20260930221837 (I3) : une commande payée n'est JAMAIS défaite par un
  -- refus Lobby (le `payment_status = 'unpaid'` plus bas ne concerne que les commandes non
  -- payées). La route garde alors la commande et l'envoie en réconciliation (chemin
  -- « relâchement impossible »).
  if v_payment_status in ('paid', 'partially_refunded', 'refunded') then
    return jsonb_build_object('ok', false, 'reason', 'order_paid');
  end if;

  with l as (
    select ol.id from public.order_lines ol
     where ol.order_id = p_order_id and ol.status = 'reserved'
     order by ol.id
     for update
  )
  select coalesce(array_agg(id), array[]::uuid[]) into v_released_ids from l;

  if array_length(v_released_ids, 1) is null then
    return jsonb_build_object('ok', true, 'released_lines', 0);
  end if;

  perform public.lock_order_capacity_rows(v_released_ids);

  foreach v_line_id in array v_released_ids loop
    perform public.release_order_line_capacity(v_line_id);
  end loop;

  -- UNE SEULE instruction UPDATE : le trigger order_lines_enqueue_pms_cancellation est FOR EACH
  -- STATEMENT et doit voir toutes les lignes mortes d'un coup.
  update public.order_lines
     set status = 'cancelled_by_provider'
   where id = any(v_released_ids);

  -- Ajout de la migration 20260930221837 : les bookings Lobby des lignes relâchées partent EXPLICITEMENT
  -- en file d'annulation. Depuis 20261003223900, le trigger enqueue_pms_cancellations les enfile
  -- déjà (il ne filtre plus le connecteur) : cette insertion reste une défense, et l'index partiel
  -- absorbe le doublon. L'entrée attend la réactivation d'un connecteur coupé
  -- (claim_pms_cancellation_batch). Migration 20261006235357 : un booking, c'est un numéro DANS un
  -- établissement.
  insert into public.pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status)
  select distinct on (ol.pms_booking_id, p.establishment_id) ol.pms_booking_id, p.establishment_id, 'cancelled_by_provider'
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = any(v_released_ids)
     and ol.pms_booking_id is not null
     and not exists (
       select 1 from public.order_lines o2
         join public.products p2 on p2.id = o2.product_id
        where o2.pms_booking_id = ol.pms_booking_id and p2.establishment_id = p.establishment_id
          and o2.status = 'reserved'
     )
  on conflict (pms_booking_id, establishment_id) where status = 'pending' do nothing;

  perform public.apply_order_line_ledger_transition(v_released_ids, 'cancelled_by_provider');

  update public.payments
     set status = 'cancelled', updated_at = now()
   where order_id = p_order_id and status = 'pending';

  update public.orders set payment_status = 'unpaid' where id = p_order_id;

  return jsonb_build_object('ok', true, 'released_lines', array_length(v_released_ids, 1));
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_pms_cancellation(p_entry_id uuid, p_outcome text, p_lobby_status_code integer DEFAULT NULL::integer, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_establishment_id uuid;
  v_pms_booking_id text;
  v_from date;
  v_to date;
begin
  if p_outcome not in ('done', 'failed') then
    raise exception 'resolve_pms_cancellation : issue invalide %', p_outcome;
  end if;

  update public.pms_cancellation_queue
     set status = p_outcome,
         lobby_status_code = p_lobby_status_code,
         last_error = p_error,
         processed_at = now()
   where id = p_entry_id
  returning establishment_id, pms_booking_id into v_establishment_id, v_pms_booking_id;

  -- 'done' couvre trois cas (annulée, déjà annulée côté Lobby, refus terminal comme
  -- RESTRICTED_RESERVATION) — seuls les deux premiers libèrent réellement des nuits. Ne pas les
  -- distinguer ici est un choix délibéré : le troisième cas est rare, et marquer le mois dû à tort
  -- coûte un sync de plus dans les 5 minutes, jamais une incohérence. L'inverse (rater une vraie
  -- libération) coûterait jusqu'à 24 h de miroir faux.
  if p_outcome = 'done' and v_establishment_id is not null then
    -- Migration 20261006235357 : les lignes de CE booking — même numéro, même établissement.
    select min(ol.date), max(coalesce(ol.end_date, ol.date))
      into v_from, v_to
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
     where ol.pms_booking_id = v_pms_booking_id and p.establishment_id = v_establishment_id;

    if v_from is not null then
      perform public.mark_pms_sync_due(v_establishment_id, v_from, v_to);
    end if;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_order_line_cancelled(p_line_id uuid, p_by text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_line record;
  v_dates text;
  v_site_url text;
  v_account record;
begin
  -- Appelée APRÈS la mise à jour du statut : la file d'annulation LobbyPMS est déjà à jour.
  select ol.date, ol.end_date, ol.qty, ol.pms_booking_id, p.name ->> 'es' as product_name, p.partner_id,
         p.establishment_id, p.type as product_type, p.lobby_category_id, o.holder_name, o.holder_email,
         o.reference, o.access_token
    into v_line
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
    join public.orders o on o.id = ol.order_id
   where ol.id = p_line_id;
  if not found then
    return;
  end if;
  -- Des dates civiles, jamais des instants : aucun fuseau n'entre en jeu.
  v_dates := case when v_line.end_date is not null
                  then 'del ' || to_char(v_line.date, 'DD/MM/YYYY') || ' al ' || to_char(v_line.end_date, 'DD/MM/YYYY')
                  else 'del ' || to_char(v_line.date, 'DD/MM/YYYY') end;

  -- Le client : le FAIT de l'annulation, sans un mot sur l'argent (décision du 2026-10-06). Jamais
  -- vers une adresse sentinelle (`@hifago.local` : ligne manuelle, reprise legacy).
  if v_line.holder_email is not null and v_line.holder_email not like '%@hifago.local' then
    begin
      select decrypted_secret into v_site_url
        from vault.decrypted_secrets where name = 'web_app_public_url';
      perform public.enqueue_notification_email(
        'client_order_line_cancelled', v_line.holder_email, null,
        'Anulación en tu reserva ' || v_line.reference,
        '<p>Hola ' || coalesce(public.html_text(v_line.holder_name), '') || ',</p>'
          || '<p>' || case p_by when 'client' then 'Anulaste' when 'admin' then 'Anulamos, a tu pedido,' else 'El establecimiento anuló' end
          || ' «' || coalesce(public.html_text(v_line.product_name), 'tu prestación') || '» ' || v_dates
          || ' en tu reserva <strong>' || public.html_text(v_line.reference) || '</strong>.</p>'
          || coalesce('<p><a href="' || v_site_url || '/reserva/' || v_line.access_token || '">Ver tu reserva</a></p>', ''),
        'order_lines', p_line_id
      );
    exception
      when query_canceled then
        raise warning 'notify_order_line_cancelled : e-mail client annulé (query_canceled) pour la ligne % — %', p_line_id, sqlerrm;
      when others then
        raise warning 'notify_order_line_cancelled : échec de l''e-mail client pour la ligne % — %', p_line_id, sqlerrm;
    end;
  end if;

  -- Le prestataire : un e-mail par compte de connexion du partenaire (spec 23 §8.2), chacun isolé.
  -- Ce que devient la disponibilité est dit sur les FAITS : la file LobbyPMS n'enfile un booking qu'à
  -- sa dernière prestation vivante ; une nuit adossée au PMS n'a jamais pris de place locale.
  for v_account in
    select pa.id as account_id, au.email
      from public.partner_accounts pa
      join auth.users au on au.id = pa.id
     where pa.partner_id = v_line.partner_id
  loop
    begin
      perform public.enqueue_notification_email(
        'partner_order_line_cancelled', v_account.email, v_account.account_id,
        'Reserva anulada: ' || coalesce(v_line.product_name, 'tu producto'),
        '<p>Se anuló «' || coalesce(public.html_text(v_line.product_name), 'tu producto') || '» ' || v_dates
          || ' (cantidad: ' || v_line.qty || '), reserva <strong>' || public.html_text(v_line.reference) || '</strong>.</p>'
          || '<p>Anulada por ' || case p_by when 'client' then 'el cliente'
                                       when 'admin' then 'la administración de Hifago, a pedido del cliente'
                                       else 'el establecimiento' end || '.</p>'
          || case
               when v_line.pms_booking_id is not null and exists (
                      select 1 from public.pms_cancellation_queue q
                       where q.pms_booking_id = v_line.pms_booking_id
                         and q.establishment_id = v_line.establishment_id and q.status = 'pending')
                 then '<p>La anulación se transmite a LobbyPMS.</p>'
               when v_line.pms_booking_id is not null
                 then '<p>La reserva sigue activa en LobbyPMS: otras prestaciones de la misma reserva siguen vigentes.</p>'
               when v_line.product_type = 'lodging' and v_line.lobby_category_id is not null
                 then ''
               else '<p>La disponibilidad quedó liberada.</p>'
             end,
        'order_lines', p_line_id
      );
    exception
      when query_canceled then
        raise warning 'notify_order_line_cancelled : e-mail prestataire annulé (query_canceled) pour le compte % — %', v_account.account_id, sqlerrm;
      when others then
        raise warning 'notify_order_line_cancelled : échec de l''e-mail prestataire pour le compte % — %', v_account.account_id, sqlerrm;
    end;
  end loop;
end;
$function$;
