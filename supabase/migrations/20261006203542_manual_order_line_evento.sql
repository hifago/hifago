-- Réservation manuelle (walk-in) d'un evento : les règles de create_order.
--
-- create_manual_order_line traitait un evento comme une activité :
--   - un evento qui occupe la ressource partagée de l'établissement ne la consommait pas et ne
--     posait aucun blocage d'agenda ;
--   - un evento `rsvp`/`unlimited` voyait sa ligne product_availability matérialisée et
--     incrémentée (un `unlimited` sans capacité par défaut était refusé en `slot_not_found`) ;
--   - un evento gratuit, sans prix par construction, était refusé en `price_missing`.
-- Désormais, avec les prédicats de create_order :
--   - capacité product_availability pour le seul mode `metered` (ni `rsvp`/`unlimited`, ni un
--     evento sans mode, comme create_order) ;
--   - ressource partagée et blocage d'agenda pour un evento qui l'occupe, `online_bookable` ignoré
--     (une ligne manuelle est une présence sur place) ; refus `resource_unavailable` ;
--   - prix 0 pour un evento gratuit ;
--   - date hors occurrence d'un evento vendu en ligne refusée (`invalid_occurrence_date`) ;
--   - verrous dans l'ordre de create_order (product_availability, provider_resource_calendar,
--     product_slot_availability), tous les contrôles avant le premier incrément (seules les
--     matérialisations `on conflict do nothing` les précèdent, comme dans create_order).
-- Signature inchangée ; EXECUTE retiré à anon (la garde interne refusait déjà une session sans
-- identité).

CREATE OR REPLACE FUNCTION public.create_manual_order_line(p_product_id uuid, p_date date, p_qty integer, p_holder_name text, p_slot_start_time time without time zone DEFAULT NULL::time without time zone, p_holder_phone text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_is_admin boolean;
  v_product_type text;
  v_establishment_id uuid;
  v_sellable boolean;
  v_calendar_open boolean;
  v_min_qty int;
  v_max_qty int;
  v_price_tiers jsonb;
  v_price_cop bigint;
  v_default_capacity int;
  v_duration_days int;
  v_online_bookable boolean;
  v_is_free boolean;
  v_evento_capacity_mode text;
  v_evento_occupies_resource boolean;
  v_counts_capacity boolean;
  v_occupies_resource boolean;
  v_gs int;
  v_resource_capacity int;
  v_resource_booked int;
  v_capacity int;
  v_booked int;
  v_line_price_cop bigint;
  v_total_cop bigint;
  v_order_id uuid;
  v_order_line_id uuid;
  -- 2026-09-10 (/simplify) : compte technique fixe (invariant 8, spec 31) déclaré une fois,
  -- réutilisé aux deux inserts ci-dessous — un seul littéral UUID à faire évoluer si besoin.
  v_technical_account_id constant uuid := 'e0000000-0000-4000-8000-000000000001';
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if p_qty is null or p_qty < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_qty');
  end if;
  if p_holder_name is null or btrim(p_holder_name) = '' then
    return jsonb_build_object('ok', false, 'reason', 'holder_name_required');
  end if;

  v_is_admin := (select public.is_admin(v_account_id));

  select type, establishment_id, sellable, min_qty, max_qty, price_tiers, price_cop, default_capacity,
         duration_days, online_bookable, is_free, evento_capacity_mode, evento_occupies_resource
    into v_product_type, v_establishment_id, v_sellable, v_min_qty, v_max_qty, v_price_tiers,
         v_price_cop, v_default_capacity,
         v_duration_days, v_online_bookable, v_is_free, v_evento_capacity_mode, v_evento_occupies_resource
    from public.products where id = p_product_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;

  if jsonb_typeof(v_price_tiers) is distinct from 'array' then
    v_price_tiers := null;
  end if;

  if not v_is_admin and not (select public.has_capability(v_account_id, 'operator', v_establishment_id)) then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;

  if v_product_type in ('lodging', 'camp') then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_product_type');
  end if;
  if not v_sellable then
    return jsonb_build_object('ok', false, 'reason', 'not_sellable');
  end if;

  -- Migration 20261006203542 : un evento suit les prédicats de create_order. Seul le mode `metered`
  -- tient un compteur product_availability (`rsvp`/`unlimited` : ni ligne matérialisée, ni
  -- incrément). Un evento qui occupe la ressource partagée de l'établissement la consomme et pose
  -- son blocage d'agenda, sans condition sur `online_bookable` : une ligne manuelle est une
  -- présence sur place, qu'il soit vendu en ligne ou non.
  v_counts_capacity := v_product_type <> 'evento' or v_evento_capacity_mode is not distinct from 'metered';
  v_occupies_resource := v_product_type = 'evento' and v_evento_occupies_resource;

  -- Même défense que create_order : un evento vendu en ligne n'a lieu qu'à ses occurrences.
  if v_product_type = 'evento' and v_online_bookable and not exists (
    select 1 from public.expand_event_occurrences(p_product_id, p_date, p_date)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_occurrence_date');
  end if;

  if p_qty < coalesce(v_min_qty, 1) then
    return jsonb_build_object('ok', false, 'reason', 'qty_below_minimum');
  end if;
  if p_qty > coalesce(v_max_qty, 20) then
    return jsonb_build_object('ok', false, 'reason', 'qty_cap_exceeded');
  end if;
  if v_price_tiers is not null and not exists (
    select 1 from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
     where p_qty between t.min_qty and t.max_qty
  ) then
    return jsonb_build_object('ok', false, 'reason', 'no_matching_tier');
  end if;

  if p_slot_start_time is null and exists (
    select 1 from public.product_slot_rules where product_id = p_product_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'slot_required');
  end if;

  if p_slot_start_time is not null then
    ----------------------------------------------------------------------------------------------
    -- Branche créneau horaire (spec 18) --------------------------------------------------------
    ----------------------------------------------------------------------------------------------
    insert into public.product_slot_availability (
      product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked
    )
    select p_product_id, p_date, v.slot_start_time, v.slot_duration_minutes, v.capacity, 0
      from public.expand_product_slots(p_product_id, p_date) v
     where v.slot_start_time = p_slot_start_time
    on conflict (product_id, slot_date, slot_start_time) do nothing;

    select coalesce(pc.open, p.calendar_default_open) into v_calendar_open
      from public.products p
      left join public.product_calendar pc on pc.product_id = p.id and pc.date = p_date
     where p.id = p_product_id;
    if not v_calendar_open then
      return jsonb_build_object('ok', false, 'reason', 'date_closed');
    end if;

  else
    ----------------------------------------------------------------------------------------------
    -- Branche date unique (default_capacity), même garde-fou que create_order Phase 2 -----------
    ----------------------------------------------------------------------------------------------
    if v_counts_capacity and v_default_capacity is not null then
      insert into public.product_availability (product_id, date, capacity, booked)
      values (p_product_id, p_date, v_default_capacity, 0)
      on conflict (product_id, date) do nothing;
    end if;

    select coalesce(pc.open, p.calendar_default_open) into v_calendar_open
      from public.products p
      left join public.product_calendar pc on pc.product_id = p.id and pc.date = p_date
     where p.id = p_product_id;
    if not v_calendar_open then
      return jsonb_build_object('ok', false, 'reason', 'date_closed');
    end if;
    -- Un evento gratuit n'a jamais de prix (contrainte products_evento_is_free_price_null).
    if not (v_product_type = 'evento' and v_is_free)
       and v_price_tiers is null and v_price_cop is null then
      return jsonb_build_object('ok', false, 'reason', 'price_missing');
    end if;
  end if;

  -- Migration 20261006203542 : verrous et contrôles dans l'ordre de create_order —
  -- product_availability, puis provider_resource_calendar, puis product_slot_availability —, tous
  -- avant le premier incrément : un refus ne laisse jamais un compteur incrémenté.
  if p_slot_start_time is null and v_counts_capacity then
    select capacity, booked into v_capacity, v_booked
      from public.product_availability
     where product_id = p_product_id and date = p_date
     for update;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
    end if;
    if v_booked + p_qty > v_capacity then
      return jsonb_build_object('ok', false, 'reason', 'full', 'capacity', v_capacity, 'booked', v_booked);
    end if;
  end if;

  -- Jour par jour, dans l'ordre des dates (coalesce(duration_days, 1) : un evento dure un jour).
  if v_occupies_resource then
    for v_gs in 0..(coalesce(v_duration_days, 1) - 1) loop
      select capacity, booked into v_resource_capacity, v_resource_booked
        from public.provider_resource_calendar
       where establishment_id = v_establishment_id and slot_date = p_date + v_gs
       for update;
      if not found or v_resource_booked + p_qty > v_resource_capacity then
        return jsonb_build_object('ok', false, 'reason', 'resource_unavailable');
      end if;
    end loop;
  end if;

  if p_slot_start_time is not null then
    select capacity, booked into v_capacity, v_booked
      from public.product_slot_availability
     where product_id = p_product_id and slot_date = p_date and slot_start_time = p_slot_start_time
     for update;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
    end if;
    if v_booked + p_qty > v_capacity then
      return jsonb_build_object('ok', false, 'reason', 'full', 'capacity', v_capacity, 'booked', v_booked);
    end if;
  end if;

  if v_product_type = 'evento' and v_is_free then
    v_line_price_cop := 0;
  else
    v_line_price_cop := v_price_cop;
    if v_price_tiers is not null then
      select t.price_cop into v_line_price_cop
        from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
       where p_qty between t.min_qty and t.max_qty limit 1;
    end if;
  end if;
  v_total_cop := v_line_price_cop * p_qty;

  if p_slot_start_time is not null then
    update public.product_slot_availability set booked = booked + p_qty
     where product_id = p_product_id and slot_date = p_date and slot_start_time = p_slot_start_time;
  elsif v_counts_capacity then
    update public.product_availability set booked = booked + p_qty
     where product_id = p_product_id and date = p_date;
  end if;

  -- 2026-09-10 (spec 31, Tranche 2) — le compte technique fixe remplace `null` : orders.account_id
  -- est désormais NOT NULL. C'EST ce même compte, invariant 8 de la spec.
  insert into public.orders (account_id, holder_name, holder_email, holder_phone, marketing_consent)
  values (v_technical_account_id, p_holder_name, 'reserva-manual@hifago.local',
          p_holder_phone, false)
  returning id into v_order_id;

  insert into public.order_lines (
    order_id, account_id, product_id, date, slot_start_time, qty, holder_name,
    holder_phone, holder_email,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop
  ) values (
    v_order_id, v_technical_account_id, p_product_id, p_date, p_slot_start_time,
    p_qty, p_holder_name, p_holder_phone, 'reserva-manual@hifago.local',
    v_line_price_cop, v_total_cop, 'operator_manual', 0, 0, 0, 0, 0, 0
  ) returning id into v_order_line_id;

  -- La ressource partagée et son blocage d'agenda, comme create_order : le blocage est le FAIT que
  -- release_order_line_capacity rend à l'annulation.
  if v_occupies_resource then
    update public.provider_resource_calendar
       set booked = booked + p_qty
     where establishment_id = v_establishment_id
       and slot_date between p_date and p_date + coalesce(v_duration_days, 1) - 1;

    insert into public.availability_blocks (establishment_id, start_date, end_date, source_order_line_id)
    values (v_establishment_id, p_date, p_date + coalesce(v_duration_days, 1) - 1, v_order_line_id);
  end if;

  insert into public.audit_log (actor_id, action, entity_table, entity_id, before, after, note)
  values (
    v_account_id, 'order_line.create_manual', 'order_lines', v_order_line_id, null,
    jsonb_build_object(
      'product_id', p_product_id, 'date', p_date, 'slot_start_time', p_slot_start_time, 'qty', p_qty
    ),
    p_note
  );

  return jsonb_build_object('ok', true, 'order_id', v_order_id, 'order_line_id', v_order_line_id);
end;
$function$;
revoke all on function public.create_manual_order_line(uuid, date, integer, text, time, text, text) from public, anon;
grant execute on function public.create_manual_order_line(uuid, date, integer, text, time, text, text) to authenticated;
