-- Dette SQL relevée pendant P6 et P7 — corrections techniques, aucune règle métier nouvelle.
--
--   1. admin_jobs_status : un job qui a tourné sans jamais réussir rendait `ok` pendant sa grâce ;
--      il rend `failing` (états : ok | failing | stale | never).
--   2. heartbeat_job : clock_timestamp() au lieu de now() — l'instant réel du passage.
--   3. enqueue_pms_cancellations : le `join establishments` inutilisé depuis 20261003223900 est
--      retiré (products.establishment_id est NOT NULL et clé étrangère : aucune ligne n'en dépendait).
--   4. close_order_line_locked : « une commande payée n'expire pas » porte le code HF001 (message
--      inchangé), pour que l'écran le reconnaisse sans lire le texte.
--   5. list_my_orders : chaque ligne porte `deposit_kept_on_cancel`, la règle de
--      close_order_line_locked (acompte encaissé : order_deposit_collected), exposée telle quelle.
--
-- Codes d'erreur propres au projet (premier introduit ici) — classe HF, hors des classes standard
-- de PostgreSQL et de la classe PT que PostgREST réserve aux statuts HTTP :
--   HF001 — transition `expired` refusée sur une commande payée (close_order_line_locked).

create function public.order_deposit_collected(p_payment_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- `partially_refunded` n'a aucun écrivain aujourd'hui : traitée comme payée, par prudence.
  select p_payment_status in ('paid', 'partially_refunded')
$$;
comment on function public.order_deposit_collected(text) is
  'L''acompte d''une commande est encaissé : la règle de close_order_line_locked (acompte acquis si le '
  'client annule, A3 ; `expired` refusé) et du `deposit_kept_on_cancel` de list_my_orders.';
revoke all on function public.order_deposit_collected(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_jobs_status()
 RETURNS TABLE(job_name text, stale_after_minutes integer, last_run_at timestamp with time zone, last_ok_at timestamp with time zone, last_error text, alerted_at timestamp with time zone, state text, alert_active boolean, checked_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (select public.is_admin((select auth.uid()))) then
    raise exception 'admin_jobs_status réservé au rôle admin' using errcode = '42501';
  end if;

  -- Une ligne par job ATTENDU, heartbeat ou pas. Sans ligne de heartbeat (le watchdog la crée à son
  -- prochain passage), l'ancrage est la déclaration de l'attente — celui que le watchdog lui donnera.
  return query
  select
    e.job_name,
    round(extract(epoch from e.stale_after) / 60)::int,
    h.last_run_at,
    h.last_ok_at,
    h.last_error,
    h.alerted_at,
    case
      -- Le prédicat des watchdogs : `stale` exactement quand ils alertent.
      when coalesce(h.last_ok_at, h.created_at, e.created_at) < now() - e.stale_after then 'stale'
      when h.last_run_at is null then 'never'
      -- Migration 20261007003627 : a tourné, n'a encore jamais réussi, dans sa grâce — jamais `ok`.
      when h.last_ok_at is null then 'failing'
      else 'ok'
    end,
    -- Alerte partie, rien de réussi depuis : le watchdog est désarmé jusqu'au prochain succès.
    coalesce(h.alerted_at >= coalesce(h.last_ok_at, h.created_at), false),
    now()
  from public.job_expectations e
  left join public.job_heartbeats h on h.job_name = e.job_name
  order by e.job_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.heartbeat_job(p_job text, p_ok boolean, p_stats jsonb DEFAULT '{}'::jsonb, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- Migration 20261007003627 : l'instant réel du passage, jamais le début de la transaction de
  -- l'appelant. Les jobs l'appellent par PostgREST (transaction propre, les deux se confondent) ;
  -- un appelant SQL dans une transaction plus longue l'aurait daté de son départ. Un seul instant
  -- pour les deux colonnes.
  v_at constant timestamptz := clock_timestamp();
begin
  insert into public.job_heartbeats as h (job_name, last_run_at, last_ok_at, last_error, stats)
  values (p_job, v_at, case when p_ok then v_at end, case when p_ok then null else left(p_error, 500) end, coalesce(p_stats, '{}'::jsonb))
  on conflict (job_name) do update
    set last_run_at = v_at,
        last_ok_at = case when p_ok then v_at else h.last_ok_at end,
        last_error = case when p_ok then null else left(p_error, 500) end,
        stats = coalesce(p_stats, '{}'::jsonb);
end;
$function$;

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

CREATE OR REPLACE FUNCTION public.close_order_line_locked(p_line_id uuid, p_new_status text, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Migration 20261007003627 : la règle vit dans order_deposit_collected, que list_my_orders expose.
  v_paid := public.order_deposit_collected(v_order.payment_status);

  if p_new_status = 'expired' and v_paid then
    -- Code propre au projet (classe HF : hors des classes standard de PostgreSQL et de la classe PT,
    -- réservée par PostgREST aux statuts HTTP), pour qu'un écran reconnaisse ce refus par son code
    -- plutôt que par son texte.
    raise exception 'transition refusée : une commande payée n''expire pas' using errcode = 'HF001';
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
$function$;

CREATE OR REPLACE FUNCTION public.order_jsonb_with_client_cancellable(p_order jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select jsonb_set(
    p_order, '{lines}',
    coalesce(
      (select jsonb_agg(l.value || jsonb_build_object(
                          'cancellable', public.order_line_client_cancellable(l.value ->> 'status'),
                          -- Migration 20261007003627 : l'acompte reste acquis si le client annule —
                          -- la règle de close_order_line_locked, jamais recopiée côté écran.
                          'deposit_kept_on_cancel', public.order_deposit_collected(p_order ->> 'payment_status'))
                        order by l.ord)
         from jsonb_array_elements(p_order -> 'lines') with ordinality as l(value, ord)),
      '[]'::jsonb
    )
  )
$function$;

comment on function public.admin_jobs_status() is
  'État des jobs attendus (bandeau admin) : seuil, derniers passages, state ok | failing | stale | never '
  '(failing : a tourné sans jamais réussir, dans sa grâce — 20261007003627), alerte en cours. Admin '
  'seul (42501 sinon).';
comment on function public.list_my_orders() is
  'La liste « Mis reservas » du compte client (spec 34). Garde = auth.uid(), et REFUS EXPLICITE '
  'd''une session anonyme (décision ⑦ du 2026-09-11) : un invité n''a pas d''espace compte. Rend '
  'le groupe (upcoming/past) et l''ordre DEPUIS LA BASE — le prédicat « à venir » est la fusion '
  'des cas proxima/en_casa de list_clients, pas une seconde définition. Payload = '
  'order_for_client_jsonb, plus access_token et group ; chaque ligne porte `cancellable` '
  '(order_line_client_cancellable, la règle de cancel_order_line — 20261006192424) et '
  '`deposit_kept_on_cancel` (order_deposit_collected, la règle de close_order_line_locked — '
  '20261007003627).';
