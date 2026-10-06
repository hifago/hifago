-- Modification d'une prestation (modify_order_line) : refus explicites, libération commune.
--
--   - une prestation adossée à LobbyPMS (pms_booking_id renseigné, ou logement PMS) est refusée en
--     `pms_line_not_modifiable` : la ligne de remplacement perdait le booking, que le passage de
--     l'ancienne à `superseded` mettait en file d'annulation ;
--   - une ligne qui porte un blocage d'agenda (camp, evento occupant) est refusée en
--     `resource_line_not_modifiable` : la ressource et le blocage ne suivaient pas ;
--   - un evento `rsvp`/`unlimited` ne matérialise ni ne compte de place (prédicat de create_order) ;
--   - l'ancienne ligne rend sa place par release_order_line_capacity (plancher 0) au lieu d'un
--     `booked - qty` qui heurtait booked >= 0 ; le contrôle de capacité suit le même plancher ;
--   - pas de min_qty pour un logement (comme create_order) ;
--   - EXECUTE retiré à anon (la garde interne refusait déjà un appelant sans droits).
-- Signature inchangée. Les refus existants restent des exceptions.

CREATE OR REPLACE FUNCTION public.modify_order_line(p_order_line_id uuid, p_new_date date, p_new_qty integer, p_reason text, p_new_end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old_line record;
  -- Ajout 20260921100200 : la commande est verrouillée AVANT la ligne (règle 8).
  v_order_id uuid;
  v_product record;
  v_lock_row record;
  v_same_slot boolean;
  v_calendar_open boolean;
  v_capacity int;
  v_booked int;
  v_effective_booked int;
  v_new_price_cop bigint;
  v_new_total_cop bigint;
  v_new_line_id uuid;
  v_old_nights date[];
  v_new_nights date[];
  v_night date;
  v_bound_max_qty int;
  v_bound_price_tiers jsonb;
  v_bound_price_cop bigint;
  v_tier_price bigint;
  v_sum_nightly bigint;
  v_stay_rates jsonb;
  v_counts_capacity boolean;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'motif obligatoire pour modifier une réservation';
  end if;
  if p_new_qty is null or p_new_qty < 1 then
    raise exception 'quantité cible invalide : %', p_new_qty;
  end if;

  -- Ajout 20260921100200 — `orders` D'ABORD, TOUJOURS (règle 8 de .claude/rules/supabase.md).
  -- Mesuré le 2026-09-21 (tests/concurrency/reconcile_order_vs_webhook.concurrency.mjs, scénario
  -- 2) : 3 interblocages `40P01` sur 12 entre cette fonction et expire_payment_order. Le cycle
  -- n'était pas un `update orders` explicite (il n'y en a aucun ici) mais l'`insert into
  -- order_lines` de la ligne de remplacement, qui prend un verrou de clé étrangère (KEY SHARE) sur
  -- `orders` — pendant que l'expiration tenait `orders` en FOR UPDATE et attendait la ligne que
  -- cette fonction tenait déjà. Verrouiller la commande en premier casse le cycle ; lecture non
  -- verrouillante de l'order_id d'abord, puis le verrou, puis la ligne comme avant.
  select ol.order_id into v_order_id from public.order_lines ol where ol.id = p_order_line_id;
  if not found then
    raise exception 'ligne de commande introuvable';
  end if;
  perform 1 from public.orders where id = v_order_id for update;

  select ol.*, p.establishment_id as establishment_id
    into v_old_line
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = p_order_line_id
   for update of ol;
  if not found then
    raise exception 'ligne de commande introuvable';
  end if;

  if not (select public.is_admin(auth.uid())) then
    if not (select public.has_capability(auth.uid(), 'operator', v_old_line.establishment_id)) then
      raise exception
        'modify_order_line réservé au rôle admin (ou à l''operator du même établissement)'
        using errcode = '42501';
    end if;
  end if;

  if v_old_line.status <> 'reserved' then
    raise exception 'seule une ligne au statut reserved peut être modifiée (statut actuel : %)', v_old_line.status;
  end if;

  -- Migration 20261006204938 : deux refus métier, rendus en `reason` (rien n'est encore écrit).
  -- Une prestation adossée à LobbyPMS : la ligne de remplacement n'hériterait pas du booking, et
  -- le passage de l'ancienne à `superseded` le mettrait en file d'annulation
  -- (enqueue_pms_cancellations). Un logement PMS n'a, lui, jamais pris de capacité locale
  -- (release_order_line_capacity n'a rien à lui rendre) : LobbyPMS est sa seule disponibilité.
  if v_old_line.pms_booking_id is not null or exists (
    select 1 from public.products p
     where p.id = v_old_line.product_id and p.type = 'lodging' and p.lobby_category_id is not null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'pms_line_not_modifiable');
  end if;
  -- Une ligne qui tient la ressource partagée de l'établissement (camp, evento occupant) : son
  -- blocage d'agenda ne suit pas une modification — annuler puis recréer.
  if exists (select 1 from public.availability_blocks where source_order_line_id = p_order_line_id) then
    return jsonb_build_object('ok', false, 'reason', 'resource_line_not_modifiable');
  end if;

  if v_old_line.end_date is not null then
    if p_new_end_date is null then
      raise exception 'p_new_end_date obligatoire pour modifier une ligne à plage (alojamiento)';
    end if;
  elsif p_new_end_date is not null then
    raise exception 'p_new_end_date doit rester null pour une ligne à date unique — transformer une ligne à date unique en ligne à plage (ou l''inverse) est hors périmètre';
  end if;

  if v_old_line.slot_start_time is not null then
    raise exception 'modify_order_line ne gère pas encore les réservations par créneau horaire — annuler puis recréer manuellement';
  end if;

  if v_old_line.end_date is not null then
    ------------------------------------------------------------------------------------------
    -- Branche alojamiento par plage (end_date non null) --------------------------------------
    ------------------------------------------------------------------------------------------
    if p_new_end_date <= p_new_date then
      raise exception 'la date de check-out doit être postérieure à la date de check-in';
    end if;

    -- Migration 20261006204938 : pas de min_qty pour un logement, comme create_order — la vitrine le
    -- réserve à partir de 1 (apps/web/lib/reservas/cantidad.ts).
    select max_qty, price_tiers, price_cop, stay_rates
      into v_bound_max_qty, v_bound_price_tiers, v_bound_price_cop, v_stay_rates
      from public.products where id = v_old_line.product_id;
    v_bound_price_tiers := public.normalize_price_tiers(v_bound_price_tiers);

    if p_new_qty > coalesce(v_bound_max_qty, 20) then
      raise exception 'quantité % hors bornes [%, %] pour ce produit',
        p_new_qty, 1, coalesce(v_bound_max_qty, 20);
    end if;
    if v_bound_price_tiers is not null and not exists (
      select 1 from jsonb_to_recordset(v_bound_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
       where p_new_qty between t.min_qty and t.max_qty
    ) then
      raise exception 'aucun palier de prix ne couvre la quantité %', p_new_qty;
    end if;

    v_old_nights := array(
      select v_old_line.date + gs from generate_series(0, (v_old_line.end_date - v_old_line.date) - 1) as gs
    );
    v_new_nights := array(
      select p_new_date + gs from generate_series(0, (p_new_end_date - p_new_date) - 1) as gs
    );

    for v_lock_row in
      select date from public.product_availability
       where product_id = v_old_line.product_id and date = any(v_old_nights || v_new_nights)
       order by date
       for update
    loop
      null;
    end loop;

    foreach v_night in array v_new_nights loop
      select coalesce(pc.open, p.calendar_default_open) into v_calendar_open
        from public.products p
        left join public.product_calendar pc on pc.product_id = p.id and pc.date = v_night
       where p.id = v_old_line.product_id;
      if not v_calendar_open then
        raise exception 'nuit % fermée pour ce produit', v_night;
      end if;

      select capacity, booked into v_capacity, v_booked
        from public.product_availability
       where product_id = v_old_line.product_id and date = v_night;
      if not found then
        raise exception 'aucune disponibilité définie pour la nuit %', v_night;
      end if;
      -- Au plancher 0, comme la libération (release_order_line_capacity) qui précède l'écriture.
      v_effective_booked := greatest(0, v_booked - (case when v_night = any(v_old_nights) then v_old_line.qty else 0 end));
      if v_effective_booked + p_new_qty > v_capacity then
        raise exception 'capacité insuffisante pour la nuit % (% déjà réservé(s) sur %)',
          v_night, v_effective_booked, v_capacity;
      end if;
    end loop;

    select public.resolve_tier_price(v_bound_price_tiers, v_bound_price_cop, p_new_qty) into v_tier_price;
    v_sum_nightly := 0;
    foreach v_night in array v_new_nights loop
      v_sum_nightly := v_sum_nightly + public.resolve_date_price(v_old_line.product_id, v_night, v_tier_price, v_stay_rates);
    end loop;
    v_new_price_cop := v_sum_nightly;
    v_new_total_cop := v_sum_nightly * p_new_qty;

    -- Migration 20261006204938 : l'ancienne ligne rend sa place par la fonction commune (plancher 0,
    -- avertissement si une place manque), puis la nouvelle prend la sienne.
    perform public.release_order_line_capacity(p_order_line_id);
    foreach v_night in array v_new_nights loop
      update public.product_availability set booked = booked + p_new_qty
       where product_id = v_old_line.product_id and date = v_night;
    end loop;

    update public.order_lines set status = 'superseded' where id = p_order_line_id;

    insert into public.order_lines (
      order_id, account_id, product_id, date, end_date, qty, status,
      referrer_partner_id, holder_name, holder_phone, holder_email, replaces_order_line_id,
      price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
      acompte_cop, referrer_commission_cop, app_commission_cop
    ) values (
      v_old_line.order_id, v_old_line.account_id, v_old_line.product_id, p_new_date, p_new_end_date,
      p_new_qty, 'reserved',
      v_old_line.referrer_partner_id, v_old_line.holder_name, v_old_line.holder_phone,
      v_old_line.holder_email, p_order_line_id,
      v_new_price_cop, v_new_total_cop, v_old_line.commission_case,
      v_old_line.acompte_pct, v_old_line.referrer_pct, v_old_line.app_pct,
      round(v_new_total_cop * v_old_line.acompte_pct), round(v_new_total_cop * v_old_line.referrer_pct),
      round(v_new_total_cop * v_old_line.app_pct)
    ) returning id into v_new_line_id;

  else
    ------------------------------------------------------------------------------------------
    -- Branche existante (date unique, tous types dont camp) — fallback default_capacity
    ------------------------------------------------------------------------------------------
    select type, min_qty, max_qty, price_tiers, default_capacity, evento_capacity_mode into v_product
      from public.products where id = v_old_line.product_id;
    -- Migration 20261006204938 : prédicat de create_order — un evento `rsvp`/`unlimited` (ou sans
    -- mode) ne tient aucun compteur : ni matérialisation, ni contrôle, ni écriture.
    v_counts_capacity := v_product.type <> 'evento' or v_product.evento_capacity_mode is not distinct from 'metered';
    if v_product.type = 'camp' then
      raise exception 'modify_order_line ne gère pas encore les camps (ressource partagée multi-jours) — annuler puis recréer manuellement';
    end if;
    if p_new_qty < coalesce(v_product.min_qty, 1) or p_new_qty > coalesce(v_product.max_qty, 20) then
      raise exception 'quantité % hors bornes [%, %] pour ce produit', p_new_qty, coalesce(v_product.min_qty, 1), coalesce(v_product.max_qty, 20);
    end if;

    v_same_slot := (v_old_line.date = p_new_date);

    if v_counts_capacity and v_product.default_capacity is not null and not v_same_slot then
      insert into public.product_availability (product_id, date, capacity, booked)
      values (v_old_line.product_id, p_new_date, v_product.default_capacity, 0)
      on conflict (product_id, date) do nothing;
    end if;

    for v_lock_row in
      select product_id, date from public.product_availability
       where product_id = v_old_line.product_id and date in (v_old_line.date, p_new_date)
       order by date for update
    loop
      null;
    end loop;

    select coalesce(pc.open, p.calendar_default_open) into v_calendar_open
      from public.products p left join public.product_calendar pc
        on pc.product_id = p.id and pc.date = p_new_date
     where p.id = v_old_line.product_id;
    if not v_calendar_open then
      raise exception 'date cible fermée pour ce produit';
    end if;

    if v_counts_capacity then
      select capacity, booked into v_capacity, v_booked
        from public.product_availability where product_id = v_old_line.product_id and date = p_new_date;
      if not found then
        raise exception 'aucune disponibilité définie pour la date cible';
      end if;

      -- Au plancher 0, comme la libération (release_order_line_capacity) qui précède l'écriture.
      v_effective_booked := greatest(0, v_booked - (case when v_same_slot then v_old_line.qty else 0 end));
      if v_effective_booked + p_new_qty > v_capacity then
        raise exception 'capacité insuffisante à la date cible (% déjà réservé(s) sur %)', v_effective_booked, v_capacity;
      end if;
    end if;

    v_bound_price_tiers := public.normalize_price_tiers(v_product.price_tiers);

    v_new_price_cop := v_old_line.price_cop;
    if v_bound_price_tiers is not null then
      select t.price_cop into v_new_price_cop
        from jsonb_to_recordset(v_bound_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
       where p_new_qty between t.min_qty and t.max_qty limit 1;
      if v_new_price_cop is null then
        raise exception 'aucun palier de prix ne couvre la quantité %', p_new_qty;
      end if;
    end if;
    v_new_total_cop := v_new_price_cop * p_new_qty;

    perform public.release_order_line_capacity(p_order_line_id);
    if v_counts_capacity then
      update public.product_availability set booked = booked + p_new_qty
       where product_id = v_old_line.product_id and date = p_new_date;
    end if;
    update public.order_lines set status = 'superseded' where id = p_order_line_id;

    insert into public.order_lines (
      order_id, account_id, product_id, date, qty, status, referrer_partner_id, holder_name,
      holder_phone, holder_email, replaces_order_line_id, price_cop, total_cop, commission_case,
      acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop
    ) values (
      v_old_line.order_id, v_old_line.account_id, v_old_line.product_id, p_new_date, p_new_qty,
      'reserved', v_old_line.referrer_partner_id, v_old_line.holder_name, v_old_line.holder_phone,
      v_old_line.holder_email, p_order_line_id,
      v_new_price_cop, v_new_total_cop, v_old_line.commission_case,
      v_old_line.acompte_pct, v_old_line.referrer_pct, v_old_line.app_pct,
      round(v_new_total_cop * v_old_line.acompte_pct), round(v_new_total_cop * v_old_line.referrer_pct),
      round(v_new_total_cop * v_old_line.app_pct)
    ) returning id into v_new_line_id;
  end if;

  update public.pms_reconciliation_entries set order_line_id = v_new_line_id
   where order_line_id = p_order_line_id and status in ('open', 'retrying');

  insert into public.audit_log (actor_id, action, entity_table, entity_id, before, after, note)
  values (
    (select auth.uid()), 'order_line.modify', 'order_lines', p_order_line_id,
    jsonb_build_object('date', v_old_line.date, 'qty', v_old_line.qty)
      || case when v_old_line.end_date is not null
              then jsonb_build_object('end_date', v_old_line.end_date) else '{}'::jsonb end,
    jsonb_build_object('date', p_new_date, 'qty', p_new_qty, 'new_order_line_id', v_new_line_id)
      || case when p_new_end_date is not null
              then jsonb_build_object('end_date', p_new_end_date) else '{}'::jsonb end,
    p_reason
  );

  return jsonb_build_object('ok', true, 'order_line_id', v_new_line_id);
end;
$function$;
revoke all on function public.modify_order_line(uuid, date, integer, text, date) from public, anon;
grant execute on function public.modify_order_line(uuid, date, integer, text, date) to authenticated;
