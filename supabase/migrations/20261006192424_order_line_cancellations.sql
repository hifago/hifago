-- Annulation d'une prestation (lot validé le 2026-10-06) : une seule règle pour tous les chemins.
--
-- cancel_order_line (le client) et set_order_line_status (admin, operator) closent désormais une
-- ligne par la MÊME fonction interne, close_order_line_locked, sous les mêmes verrous :
--   - `orders` d'abord, puis la ligne, puis relecture du statut (.claude/rules/supabase.md, règle 8)
--     — même ordre qu'expire_payment_order, apply_pms_poll_outcome et le webhook de paiement, qui
--     ne décident donc jamais sur une ligne qu'une annulation est en train de clore ;
--   - la place est RENDUE (cupos, créneau, ressource partagée et blocage d'agenda d'un camp ou d'un
--     evento occupant) par lock_order_capacity_rows + release_order_line_capacity
--     (20260921100000), pour toute annulation, client comme prestataire, commande payée ou non,
--     et pour `expired`. Une nuit adossée au PMS n'a jamais été décrémentée : sa disponibilité
--     revient chez Lobby par la file d'annulation (trigger), le miroir suit ;
--   - l'argent : l'acompte d'une commande payée reste acquis quand le CLIENT annule (A3 : ledger
--     `cancelled_by_client`, compensation de l'établissement) ; rien n'ayant été encaissé sur une
--     commande impayée ou remboursée, le ledger y suit `expired` (aucune compensation). Quand le
--     client retire une ligne d'une commande impayée, ses intents `pending` sont annulés : un
--     paiement de l'ancien montant qui aboutirait quand même suit le chemin EXISTANT du webhook
--     (`paid_after_expiry` « après annulation par le client », ou `superseded_intent`) ;
--   - aucun remboursement n'est ajouté ici (décision du 2026-10-06) : l'établissement qui annule une
--     commande payée laisse l'acompte de la ligne sans traitement automatique, comme avant ;
--   - `expired` est refusé sur une commande payée (une commande payée n'expire pas) ;
--   - toute annulation (client ou établissement) envoie une confirmation au client et une
--     information au prestataire : le FAIT de l'annulation, sans un mot sur l'argent (textes
--     provisoires, valeurs tierces échappées par html_text) ; jamais vers une adresse sentinelle
--     (`@hifago.local` : ligne manuelle, reprise legacy) ;
--   - release_order_line_capacity ne rend plus rien pour un evento qui n'est pas `metered`
--     (`unlimited`, `rsvp` ou sans mode), qui n'a jamais pris de place (prédicat de create_order).
-- Aussi : list_my_orders rend `cancellable` par ligne (même règle que cancel_order_line) ;
-- set_establishment_pms_connector verrouille les lignes AVANT la file (même ordre que le trigger
-- d'une annulation) ; set_order_line_status n'est plus exécutable par anon.

-- Les contraintes ci-dessous prennent un verrou ACCESS EXCLUSIVE : jamais d'attente sans borne
-- derrière une longue transaction (même garde que 20261004005336).
select set_config('lock_timeout', '5s', true);

-- ============================================================================================
-- 1. Types d'e-mail
-- ============================================================================================
alter table public.notification_emails drop constraint notification_emails_event_type_check;
alter table public.notification_emails
  add constraint notification_emails_event_type_check
  check (event_type in (
    'partner_invitation',
    'admin_new_proposal',
    'admin_new_reconciliation_exception',
    'partner_proposal_decided',
    'partner_commission_earned',
    'partner_payment_confirmed',
    'client_order_confirmed',
    'partner_camp_evento_blocked',
    'client_payment_received_not_honored',
    'client_duplicate_payment_refund',
    'admin_job_stalled',
    'client_order_line_cancelled',
    'partner_order_line_cancelled'
  ));


-- ============================================================================================
-- 2. La règle « annulable par son client », en un seul endroit
-- ============================================================================================
create function public.order_line_client_cancellable(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status = 'reserved'
$$;
comment on function public.order_line_client_cancellable(text) is
  'Une prestation que son client peut annuler : la règle de cancel_order_line et du `cancellable` de list_my_orders.';
revoke all on function public.order_line_client_cancellable(text) from public, anon, authenticated;

-- `cancellable` ajouté à chaque ligne d'une commande rendue par order_for_client_jsonb.
create function public.order_jsonb_with_client_cancellable(p_order jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_set(
    p_order, '{lines}',
    coalesce(
      (select jsonb_agg(l.value || jsonb_build_object('cancellable', public.order_line_client_cancellable(l.value ->> 'status'))
                        order by l.ord)
         from jsonb_array_elements(p_order -> 'lines') with ordinality as l(value, ord)),
      '[]'::jsonb
    )
  )
$$;
revoke all on function public.order_jsonb_with_client_cancellable(jsonb) from public, anon, authenticated;

-- ============================================================================================
-- 3. E-mails d'annulation (client et prestataire) — jamais une cause d'échec de l'annulation
-- ============================================================================================
create function public.notify_order_line_cancelled(p_line_id uuid, p_by text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
  v_dates text;
  v_site_url text;
  v_account record;
begin
  -- Appelée APRÈS la mise à jour du statut : la file d'annulation LobbyPMS est déjà à jour.
  select ol.date, ol.end_date, ol.qty, ol.pms_booking_id, p.name ->> 'es' as product_name, p.partner_id,
         p.type as product_type, p.lobby_category_id, o.holder_name, o.holder_email, o.reference, o.access_token
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
                       where q.pms_booking_id = v_line.pms_booking_id and q.status = 'pending')
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
$$;
revoke all on function public.notify_order_line_cancelled(uuid, text) from public, anon, authenticated;

-- ============================================================================================
-- 4. Clore une prestation — sous les verrous de l'APPELANT (`orders`, puis la ligne, relue `reserved`)
-- ============================================================================================
create function public.close_order_line_locked(p_line_id uuid, p_new_status text, p_by text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_order_id uuid;
  v_line_status text;
  v_remaining int;
  v_paid boolean;
begin
  -- Les seuls couples (statut, auteur) des deux appelants — un appelant fautif échoue ici.
  if (p_new_status, p_by) not in (('cancelled_by_client', 'client'), ('cancelled_by_client', 'admin'),
                                  ('cancelled_by_provider', 'provider'), ('expired', 'admin')) then
    raise exception 'close_order_line_locked : transition % par % inconnue', p_new_status, p_by;
  end if;
  select ol.order_id, ol.status into v_order_id, v_line_status from public.order_lines ol where ol.id = p_line_id;
  -- L'appelant a relu `reserved` sous ses verrous ; le revérifier ici coûte une comparaison et
  -- interdit à jamais de rendre une place deux fois.
  if v_line_status is distinct from 'reserved' then
    raise exception 'close_order_line_locked : la ligne % n''est pas reserved (%)', p_line_id, v_line_status;
  end if;
  select o.payment_status, o.reference into v_order from public.orders o where o.id = v_order_id;
  -- `partially_refunded` n'a aucun écrivain aujourd'hui : traitée comme payée, par prudence.
  v_paid := v_order.payment_status in ('paid', 'partially_refunded');

  if p_new_status = 'expired' and v_paid then
    raise exception 'transition refusée : une commande payée n''expire pas';
  end if;

  -- La capacité, dans l'ordre global (product_availability, ressource partagée, créneaux), puis
  -- rendue — plancher 0, avertissement si une place l'avait déjà été.
  perform public.lock_order_capacity_rows(array[p_line_id]);
  perform public.release_order_line_capacity(p_line_id);

  -- UNE instruction : le trigger d'annulation PMS est FOR EACH STATEMENT.
  update public.order_lines set status = p_new_status where id = p_line_id;

  -- A3 : l'acompte reste acquis (compensation de l'établissement) seulement s'il a été encaissé.
  perform public.apply_order_line_ledger_transition(
    array[p_line_id],
    case when p_new_status = 'cancelled_by_client' and not v_paid then 'expired' else p_new_status end
  );

  select count(*) into v_remaining
    from public.order_lines where order_id = v_order_id and status = 'reserved';

  -- Le client retire une ligne d'une commande impayée : l'intent en cours portait l'ancien montant.
  if p_by = 'client' and v_order.payment_status in ('unpaid', 'pending') then
    update public.payments set status = 'cancelled', updated_at = now()
     where order_id = v_order_id and status = 'pending';
    update public.orders set payment_status = 'unpaid' where id = v_order_id and payment_status = 'pending';
  end if;

  if p_new_status in ('cancelled_by_client', 'cancelled_by_provider') then
    perform public.notify_order_line_cancelled(p_line_id, p_by);
  end if;

  return jsonb_build_object('ok', true, 'order_id', v_order_id, 'remaining_active_lines', v_remaining);
end;
$$;
revoke all on function public.close_order_line_locked(uuid, text, text) from public, anon, authenticated;

-- ============================================================================================
-- 5. cancel_order_line — le client (signature et réponses inchangées)
-- ============================================================================================
create or replace function public.cancel_order_line(p_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid := auth.uid();
  v_owner uuid;
  v_status text;
  v_order_id uuid;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if (select public.is_anonymous_session()) then
    return jsonb_build_object('ok', false, 'reason', 'anonymous_session');
  end if;

  -- Lecture non verrouillante : la commande à verrouiller d'abord (règle 8).
  select ol.account_id, ol.order_id into v_owner, v_order_id
    from public.order_lines ol where ol.id = p_line_id;
  if not found or v_owner is distinct from v_account_id then
    return jsonb_build_object('ok', false, 'reason', 'line_not_found');
  end if;

  perform 1 from public.orders where id = v_order_id for update;
  select ol.account_id, ol.status into v_owner, v_status
    from public.order_lines ol where ol.id = p_line_id for update;
  -- Relu sous verrou : le propriétaire (rattachement d'une commande anonyme) et le statut.
  if v_owner is distinct from v_account_id then
    return jsonb_build_object('ok', false, 'reason', 'line_not_found');
  end if;
  if not public.order_line_client_cancellable(v_status) then
    return jsonb_build_object('ok', false, 'reason', 'line_not_active');
  end if;

  return public.close_order_line_locked(p_line_id, 'cancelled_by_client', 'client');
end;
$function$;
comment on function public.cancel_order_line(uuid) is
  'Annule UNE prestation d''une commande, jamais la commande entière (spec 34 décision ⑤). Garde '
  'stricte : account_id = auth.uid(), refus d''une session anonyme (décision ⑨) ; ligne inexistante '
  'ou d''un autre compte → line_not_found. Depuis 20261006192424 : `orders`, puis la ligne, puis la '
  'capacité ; la place est rendue (close_order_line_locked) ; acompte acquis sur une commande payée '
  '(A3), intents `pending` annulés sur une commande impayée. La propagation LobbyPMS passe par le '
  'trigger de 20260827160000, dont la garde par booking empêche qu''annuler une activité annule la '
  'nuit qui partage son booking.';

-- ============================================================================================
-- 6. set_order_line_status — admin et operator (signature et gardes inchangées)
-- ============================================================================================
create or replace function public.set_order_line_status(p_order_line_id uuid, p_new_status text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_before_status text;
  v_is_admin boolean;
  v_establishment_id uuid;
  v_order_id uuid;
begin
  v_is_admin := (select public.is_admin(auth.uid()));

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'motif obligatoire pour une transition manuelle';
  end if;

  if p_new_status not in ('fulfilled', 'no_show', 'cancelled_by_client',
                           'cancelled_by_provider', 'expired') then
    raise exception 'statut cible invalide : %', p_new_status;
  end if;

  -- Lecture non verrouillante : l'établissement (droit de l'operator) et la commande à verrouiller.
  select ol.order_id, p.establishment_id
    into v_order_id, v_establishment_id
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = p_order_line_id;

  if not found then
    raise exception 'ligne de commande introuvable';
  end if;

  if not v_is_admin then
    if p_new_status not in ('no_show', 'cancelled_by_provider')
       or not (select public.has_capability(auth.uid(), 'operator', v_establishment_id)) then
      raise exception
        'set_order_line_status réservé au rôle admin (ou à l''operator du même établissement, pour no_show/cancelled_by_provider uniquement)'
        using errcode = '42501';
    end if;
  end if;

  -- Règle 8 : `orders`, puis la ligne, puis relecture.
  perform 1 from public.orders where id = v_order_id for update;
  select ol.status into v_before_status
    from public.order_lines ol where ol.id = p_order_line_id for update;

  if v_before_status <> 'reserved' then
    raise exception 'transition refusée : la ligne n''est plus reserved (statut actuel : %)', v_before_status;
  end if;

  if p_new_status in ('cancelled_by_client', 'cancelled_by_provider', 'expired') then
    -- Place rendue, ledger, intents, e-mails : la même fonction que cancel_order_line.
    perform public.close_order_line_locked(
      p_order_line_id, p_new_status,
      case when p_new_status = 'cancelled_by_provider' then 'provider' else 'admin' end
    );
  else
    update public.order_lines set status = p_new_status where id = p_order_line_id;
    perform public.apply_order_line_ledger_transition(array[p_order_line_id], p_new_status);
  end if;

  insert into public.audit_log (actor_id, action, entity_table, entity_id, before, after, note)
  values (
    (select auth.uid()), 'order_line.set_status', 'order_lines', p_order_line_id,
    jsonb_build_object('status', v_before_status), jsonb_build_object('status', p_new_status), p_reason
  );

  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.set_order_line_status(uuid, text, text) from public, anon;
grant execute on function public.set_order_line_status(uuid, text, text) to authenticated;

-- ============================================================================================
-- 7. Redéfinitions depuis pg_get_functiondef (signatures inchangées, droits conservés)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.release_order_line_capacity(p_line_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_line record;
  v_block record;
begin
  select ol.id, ol.product_id, ol.date, ol.end_date, ol.slot_start_time, ol.qty, p.lobby_category_id,
         p.type as product_type, p.evento_capacity_mode
    into v_line
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = p_line_id;
  if not found then
    return;
  end if;

  if v_line.end_date is not null then
    -- Séjour par plage. Une ligne PMS-backed n'a JAMAIS été décrémentée (create_order l.632) —
    -- rien à lui rendre ; le drapeau est gelé tant que la ligne est réservée (trigger ci-dessus).
    if v_line.lobby_category_id is null then
      perform 1 from public.product_availability
        where product_id = v_line.product_id and date >= v_line.date and date < v_line.end_date
          and booked < v_line.qty;
      if found then
        raise warning 'release_order_line_capacity: booked < qty sur la plage de la ligne % — une place rendue deux fois ?', p_line_id;
      end if;
      update public.product_availability
         set booked = greatest(0, booked - v_line.qty)
       where product_id = v_line.product_id and date >= v_line.date and date < v_line.end_date;
    end if;
  elsif v_line.slot_start_time is not null then
    perform 1 from public.product_slot_availability
      where product_id = v_line.product_id and slot_date = v_line.date
        and slot_start_time = v_line.slot_start_time and booked < v_line.qty;
    if found then
      raise warning 'release_order_line_capacity: booked < qty sur le créneau de la ligne %', p_line_id;
    end if;
    update public.product_slot_availability
       set booked = greatest(0, booked - v_line.qty)
     where product_id = v_line.product_id and slot_date = v_line.date
       and slot_start_time = v_line.slot_start_time;
  elsif v_line.product_type = 'evento' and v_line.evento_capacity_mode is distinct from 'metered' then
    -- Migration 20261006192424 : seul un evento `metered` prend une place — `unlimited`, `rsvp` ou
    -- sans mode n'en ont jamais pris (create_order, même prédicat ; drapeau gelé tant que la ligne
    -- est réservée). Une ligne product_availability peut pourtant exister (posée par une ancienne
    -- ligne manuelle) : n'y rien rendre.
    null;
  else
    -- Date simple : activité, camp, evento `metered` (les modes unlimited/rsvp n'ont aucune ligne
    -- product_availability — create_order l.286-290 —, l'UPDATE ne touche rien, c'est voulu).
    perform 1 from public.product_availability
      where product_id = v_line.product_id and date = v_line.date and booked < v_line.qty;
    if found then
      raise warning 'release_order_line_capacity: booked < qty sur la date de la ligne %', p_line_id;
    end if;
    update public.product_availability
       set booked = greatest(0, booked - v_line.qty)
     where product_id = v_line.product_id and date = v_line.date;
  end if;

  -- Ressource partagée du prestataire : le FAIT est le blocage d'agenda que create_order a posé
  -- (camp, ou evento occupant) — on rend exactement la plage bloquée, puis on retire le blocage.
  for v_block in
    select id, establishment_id, start_date, end_date
      from public.availability_blocks
     where source_order_line_id = p_line_id
  loop
    update public.provider_resource_calendar
       set booked = greatest(0, booked - v_line.qty)
     where establishment_id = v_block.establishment_id
       and slot_date between v_block.start_date and v_block.end_date;
    delete from public.availability_blocks where id = v_block.id;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_orders()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  -- Résolu UNE fois pour toute la requête, même geste que list_clients : les deux bornes
  -- ci-dessous doivent répondre à la même question au même instant.
  v_today constant date := public.today_in_bogota();
  v_orders jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if (select public.is_anonymous_session()) then
    return jsonb_build_object('ok', false, 'reason', 'anonymous_session');
  end if;

  with agg as (
    select
      o.id as order_id,
      -- « À venir » : au moins une prestation RÉSERVÉE dont la date de fin n'est pas passée.
      -- ⚠️ `coalesce(end_date, date)` et non `date` seule : un séjour commencé hier et fini demain
      -- est à venir, pas passé (c'est le cas 'en_casa' de list_clients). L'oublier est le défaut
      -- que le test pgTAP existe pour attraper.
      min(ol.date) filter (
        where ol.status = 'reserved' and coalesce(ol.end_date, ol.date) >= v_today
      ) as prochaine_date,
      -- « Passées » : la dernière date réellement portée par la commande. `superseded` exclue
      -- comme dans list_clients — une ligne remplacée porte une date qui n'existe plus.
      max(coalesce(ol.end_date, ol.date)) filter (
        where ol.status <> 'superseded'
      ) as derniere_date
    from public.orders o
    -- left join : une commande sans aucune ligne (défensif) reste rendue, en 'past'.
    left join public.order_lines ol on ol.order_id = o.id
    where o.account_id = v_account_id
    group by o.id
  )
  select coalesce(
           jsonb_agg(
             -- Migration 20261006192424 : `cancellable` par ligne, décidé ICI par la même règle que
             -- cancel_order_line (order_line_client_cancellable) — jamais recalculé côté écran.
             public.order_jsonb_with_client_cancellable(public.order_for_client_jsonb(o))
             || jsonb_build_object(
                  -- Le lien vers le DÉTAIL (spec 34 décision ③ : /reserva/<jeton>, jamais un
                  -- second écran de détail). Déjà lisible par le propriétaire en RLS directe —
                  -- CheckoutForm le lit ainsi depuis la spec 33 — donc aucune exposition nouvelle.
                  'access_token', o.access_token,
                  -- Le GROUPE est décidé ICI, jamais côté TypeScript, qui ne fait qu'un filter :
                  -- deux calculs de « à venir » divergeraient (spec 34 invariant 5).
                  'group', case when a.prochaine_date is not null then 'upcoming' else 'past' end
                )
             order by
               (a.prochaine_date is null),          -- false (0) d'abord : « à venir » en tête
               a.prochaine_date asc,                -- la plus proche en haut
               a.derniere_date desc nulls last,     -- passées : la plus récente en haut
               o.created_at desc, o.id asc          -- tiebreak déterministe, comme list_clients
           ),
           '[]'::jsonb
         )
    into v_orders
    from agg a
    join public.orders o on o.id = a.order_id;

  return jsonb_build_object('ok', true, 'orders', v_orders);
end;
$function$;

comment on function public.list_my_orders() is
  'La liste « Mis reservas » du compte client (spec 34). Garde = auth.uid(), et REFUS EXPLICITE '
  'd''une session anonyme (décision ⑦ du 2026-09-11) : un invité n''a pas d''espace compte. Rend '
  'le groupe (upcoming/past) et l''ordre DEPUIS LA BASE — le prédicat « à venir » est la fusion '
  'des cas proxima/en_casa de list_clients, pas une seconde définition. Payload = '
  'order_for_client_jsonb, plus access_token et group ; chaque ligne porte `cancellable` '
  '(order_line_client_cancellable, la règle de cancel_order_line — 20261006192424).';
CREATE OR REPLACE FUNCTION public.set_establishment_pms_connector(p_establishment_id uuid, p_lobby_api_token text DEFAULT NULL::text, p_connector_active boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_same_lobby_account boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_before record;
  v_replaced boolean;
  v_bumped boolean;
  v_changed_at timestamptz;
  v_failed int := 0;
  v_entries int := 0;
  v_name text;
  v_app_base_url text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'set_establishment_pms_connector réservé au rôle admin' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'motif obligatoire pour modifier le connecteur PMS';
  end if;

  -- Migration 20261004005336 : `for no key update`, jamais `for update`. Toute insertion dans la file
  -- d'annulation prend un verrou KEY SHARE sur l'établissement (sa clé étrangère, piège 22) ; un
  -- `for update` la bloquerait — or un écrivain qui tient une ligne bookée (annulation, expiration,
  -- issue du poll) enfile, pendant que le remplacement attend cette ligne pour y accrocher son
  -- entrée de réconciliation : interblocage. NO KEY UPDATE reste incompatible avec le `for share`
  -- des claims de réservation : ils attendent le remplacement (voulu).
  select lobby_connector_active, lobby_has_token, lobby_api_token, name into v_before
    from public.establishments where id = p_establishment_id for no key update;
  if not found then
    raise exception 'établissement introuvable';
  end if;

  -- « Remplacé » se juge sur les jetons normalisés : ni un premier jeton, ni le même jeton recollé
  -- avec des espaces, ni un champ vide. Migration 20261004005336 : un remplacement déclaré sur le MÊME
  -- compte Lobby (rotation du jeton) ne change pas d'époque — par défaut, on suppose un autre compte.
  v_replaced := nullif(btrim(p_lobby_api_token, E' \t\r\n'), '') is not null
     and nullif(btrim(v_before.lobby_api_token, E' \t\r\n'), '') is not null
     and nullif(btrim(p_lobby_api_token, E' \t\r\n'), '') <> nullif(btrim(v_before.lobby_api_token, E' \t\r\n'), '');
  v_bumped := v_replaced and not coalesce(p_same_lobby_account, false);

  update public.establishments
     -- Migration 20261003223900 : un jeton vide ou fait de blancs est ABSENT (jamais écrit), et un jeton
     -- est stocké sans blancs autour (espaces, tabulations, retours à la ligne).
     set lobby_api_token = coalesce(nullif(btrim(p_lobby_api_token, E' \t\r\n'), ''), lobby_api_token),
         lobby_connector_active = p_connector_active,
         -- Migration 20261004005336 : l'instant du remplacement, à l'HORLOGE et après le verrou — un claim
         -- qui a lu l'ancien jeton avant nous date son booking plus tôt, même si notre transaction a
         -- commencé avant la sienne (now() le classerait « nouveau »).
         lobby_token_changed_at = case when v_bumped then clock_timestamp() else lobby_token_changed_at end
   where id = p_establishment_id
  returning lobby_token_changed_at into v_changed_at;

  -- Migration 20261003223900 : un jeton REMPLACÉ peut ouvrir un AUTRE compte Lobby, où un numéro de
  -- booking ne désigne plus la même réservation. Les annulations encore en attente (posées
  -- avec l'ancien jeton, y compris connecteur coupé) passent en échec pour une vérification
  -- manuelle — le contrôle nocturne compte les échecs — au lieu de partir vers ce compte.
  if v_bumped then
    -- Migration 20261004005336 : les bookings VIVANTS posés avec l'ancien jeton ne sont plus jamais
    -- interrogés ni annulés avec le nouveau (claim_pms_poll_batch, claim_pms_cancellation_batch) :
    -- une entrée de réconciliation par booking (commande et numéro, sur sa plus petite ligne) les fait vérifier chez
    -- Lobby et clore à la main. Muette : un seul récapitulatif ci-dessous, au lieu d'un e-mail par
    -- booking et par admin. Aucune en double tant que celle d'un remplacement précédent est ouverte.
    -- Les lignes concernées, en KEY SHARE dans l'ordre des id AVANT l'insertion : ses contrôles
    -- de clé étrangère les prendraient dans l'ordre des bookings, à rebours d'expire_payment_order
    -- et de release_order_after_pms_refusal (lignes par id) — interblocage.
    perform 1
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
     where p.establishment_id = p_establishment_id
       and ol.status = 'reserved'
       and ol.pms_booking_id is not null
       and coalesce(ol.pms_booked_at, ol.created_at) < v_changed_at
     order by ol.id
     for key share of ol;
    -- Migration 20261006192424 : ces verrous de lignes sont pris AVANT la mise en échec de la file
    -- ci-dessous, jamais après. Une annulation tient sa ligne puis son trigger enfile le booking : si
    -- la file était déjà tenue ici, l'insertion attendrait ce remplacement, qui attendrait la ligne —
    -- interblocage. Ordre de tous les écrivains : lignes, puis file.
    update public.pms_cancellation_queue
       set status = 'failed', processed_at = now(),
           last_error = 'jeton Lobby remplacé : annulation à vérifier à la main avant tout renvoi'
     where establishment_id = p_establishment_id and status = 'pending';
    get diagnostics v_failed = row_count;

    insert into public.pms_reconciliation_entries (order_line_id, detail)
    select distinct on (ol.order_id, ol.pms_booking_id) ol.id,
           'jeton Lobby remplacé le ' || to_char(v_changed_at at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI')
             || ' (heure de Colombie) : booking Lobby ' || ol.pms_booking_id
             || ' posé avec l''ancien jeton, plus interrogé ni annulé automatiquement — à vérifier chez '
             || 'Lobby, puis clore la ligne à la main (changement de statut), commande ' || o.reference
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
      join public.orders o on o.id = ol.order_id
     where p.establishment_id = p_establishment_id
       and ol.status = 'reserved'
       and ol.pms_booking_id is not null
       and coalesce(ol.pms_booked_at, ol.created_at) < v_changed_at
       and not exists (
         select 1
           from public.pms_reconciliation_entries r
           join public.order_lines ol2 on ol2.id = r.order_line_id
           join public.products p2 on p2.id = ol2.product_id
          where r.status in ('open', 'retrying')
            and r.detail like 'jeton Lobby remplacé%'
            and strpos(r.detail, ' : booking Lobby ' || ol.pms_booking_id || ' posé ') > 0
            and ol2.order_id = ol.order_id
            and p2.establishment_id = p_establishment_id
       )
     order by ol.order_id, ol.pms_booking_id, ol.id;
    get diagnostics v_entries = row_count;

    -- UN récapitulatif aux admins, seulement si un booking ou une annulation est touché. Sans
    -- related_id : la déduplication des e-mails rendrait muet tout remplacement suivant du même
    -- établissement. Un e-mail en échec ne bloque jamais le remplacement (les entrées restent).
    if v_entries + v_failed > 0 then
      begin
        v_name := coalesce(v_before.name ->> 'es', 'Establecimiento sin nombre');
        select decrypted_secret into v_app_base_url
          from vault.decrypted_secrets where name = 'admin_app_public_url';
        perform public.notify_all_admins(
          'admin_new_reconciliation_exception',
          'Token de Lobby reemplazado: ' || v_entries || ' reserva(s) por verificar — ' || v_name,
          '<p>Se reemplazó el token de Lobby de ' || public.html_text(v_name) || '. ' || v_entries
            || ' reserva(s) hechas con el token anterior ya no se consultan ni se cancelan automáticamente, y '
            || v_failed || ' cancelación(es) pendientes quedaron en error. Revísalas en la conciliación.</p>'
            || '<p><a href="' || coalesce(v_app_base_url, '') || '/admin/reconciliation">Ver reconciliaciones pendientes</a></p>',
          'establishments', null
        );
      exception when others then
        raise warning 'set_establishment_pms_connector : récapitulatif impossible (%) — entrées posées', sqlerrm;
      end;
    end if;
  end if;

  perform public.log_admin_action(
    'establishment.set_pms_connector', 'establishments', p_establishment_id,
    jsonb_build_object('connector_active', v_before.lobby_connector_active, 'had_token', v_before.lobby_has_token),
    jsonb_build_object('connector_active', p_connector_active, 'token_replaced', nullif(btrim(p_lobby_api_token, E' \t\r\n'), '') is not null,
                       'same_lobby_account', coalesce(p_same_lobby_account, false), 'token_epoch_bumped', v_bumped,
                       'reconciliation_entries', v_entries, 'cancellations_failed', v_failed),
    p_reason
  );
  return jsonb_build_object('ok', true);
end;
$function$;
