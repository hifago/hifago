-- Le panier avant le checkout, et le panier après un refus Lobby.
--
-- 1. cart_lines_availability() : pour chaque ligne du panier de l'appelant, ce que create_order en
--    dirait — disponible, ou la raison exacte du refus. Mêmes contrôles, même ordre, mêmes sommes
--    du panier (ressource partagée, nuits, créneaux) ; ni verrou ni écriture. Là où create_order
--    matérialise d'abord une ligne de capacité (default_capacity, créneau attendu) avant de la lire,
--    cette fonction lit la valeur qu'il matérialiserait. Chaque ligne est jugée seule, avec les
--    sommes du panier entier. Les plafonds de composition (lodging_cap_exceeded,
--    prestation_cap_exceeded) portent sur le panier, pas sur une ligne : hors de ce retour.
--    Raisons, liste fermée = celles que create_order rend avec 'line' : product_not_found
--    (inatteignable depuis un panier, cart_items.product_id étant une clé étrangère), not_sellable,
--    date_in_past, invalid_occurrence_date, unsupported_date_range, invalid_date_range,
--    date_range_required, unsupported_slot_combination, slot_required, qty_below_minimum,
--    qty_cap_exceeded, no_matching_tier, pms_unavailable, camp_missing_lodging, price_missing,
--    date_closed, slot_not_found, full, resource_unavailable.
--    Copie de create_order, donc dérive possible : cart_lines_availability.test.sql compare les
--    deux cas par cas, et compare l'ensemble des raisons de l'une à celui de l'autre. Toute
--    nouvelle raison ligne de create_order fait rougir ce test tant qu'elle n'est pas recopiée ici.
-- 2. release_order_after_pms_refusal remet les lignes relâchées dans le panier du client.

create function public.cart_lines_availability()
returns table (id uuid, available boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_account_id uuid := (select auth.uid());
  v_today constant date := public.today_in_bogota();
  v_lines jsonb;
  v_line jsonb;
  v_line_idx int;
  v_reason text;
  -- Relevés en première passe : la somme de la ressource partagée lit les AUTRES lignes du panier.
  v_products_type text[];
  v_products_establishment_id uuid[];
  v_products_duration_days int[];
  v_products_online_bookable boolean[];
  v_products_evento_occupies_resource boolean[];
begin
  if v_account_id is null then
    return;
  end if;

  -- Les lignes de create_order, construites de la même façon.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ci.id,
           'product_id', ci.product_id,
           'date', ci.date,
           'end_date', ci.end_date,
           'slot_start_time', ci.slot_start_time,
           'qty', ci.qty
         ) order by ci.created_at, ci.id), '[]'::jsonb)
    into v_lines
    from public.cart_items ci
   where ci.account_id = v_account_id;

  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
  loop
    declare
      v_type text;
      v_establishment_id uuid;
      v_duration_days int;
      v_online_bookable boolean;
      v_occupies_resource boolean;
    begin
      select p.type, p.establishment_id, p.duration_days, p.online_bookable, p.evento_occupies_resource
        into v_type, v_establishment_id, v_duration_days, v_online_bookable, v_occupies_resource
        from public.products p
       where p.id = (v_line->>'product_id')::uuid;
      v_products_type[v_line_idx] := v_type;
      v_products_establishment_id[v_line_idx] := v_establishment_id;
      v_products_duration_days[v_line_idx] := v_duration_days;
      v_products_online_bookable[v_line_idx] := v_online_bookable;
      v_products_evento_occupies_resource[v_line_idx] := v_occupies_resource;
    end;
  end loop;

  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
  loop
    v_reason := null;
    <<line_checks>>
    declare
      v_product_id uuid := (v_line->>'product_id')::uuid;
      v_date date := (v_line->>'date')::date;
      v_end_date date := (v_line->>'end_date')::date;
      v_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_qty int := (v_line->>'qty')::int;
      v_p record;
      v_price_tiers jsonb;
      v_calendar_open boolean;
      v_capacity int;
      v_booked int;
      v_resource_capacity int;
      v_resource_booked int;
      v_night_row record;
    begin
      select p.type, coalesce(p.min_qty, 1) as min_qty, coalesce(p.max_qty, 20) as max_qty, p.price_tiers,
             p.sellable, p.price_cop, p.establishment_id, p.duration_days, p.calendar_default_open,
             p.lobby_category_id, p.online_bookable, p.is_free, p.evento_capacity_mode,
             p.evento_occupies_resource, p.external_booking_url, p.default_capacity
        into v_p
        from public.products p
       where p.id = v_product_id;
      if not found then
        v_reason := 'product_not_found';
        exit line_checks;
      end if;

      -- ── Phase 1 de create_order ─────────────────────────────────────────────────────────────
      if (v_p.type = 'evento' and not v_p.online_bookable)
         or (v_p.type <> 'evento' and (v_p.external_booking_url is not null or v_p.type = 'transport')) then
        v_reason := 'not_sellable';
        exit line_checks;
      end if;
      if v_date < v_today then
        v_reason := 'date_in_past';
        exit line_checks;
      end if;
      -- Sans le verrou partagé de create_order : une lecture, pas une décision.
      if v_p.type = 'evento' and v_p.online_bookable and not exists (
        select 1 from public.expand_event_occurrences(v_product_id, v_date, v_date)
      ) then
        v_reason := 'invalid_occurrence_date';
        exit line_checks;
      end if;

      v_price_tiers := public.normalize_price_tiers(v_p.price_tiers);

      if v_end_date is not null and v_p.type <> 'lodging' then
        v_reason := 'unsupported_date_range';
        exit line_checks;
      end if;
      if v_end_date is not null and v_end_date <= v_date then
        v_reason := 'invalid_date_range';
        exit line_checks;
      end if;
      if v_p.type = 'lodging' and v_end_date is null then
        v_reason := 'date_range_required';
        exit line_checks;
      end if;
      if v_slot_start_time is not null then
        if v_end_date is not null then
          v_reason := 'unsupported_slot_combination';
          exit line_checks;
        end if;
      elsif v_end_date is null and exists (
        select 1 from public.product_slot_rules r where r.product_id = v_product_id
      ) then
        v_reason := 'slot_required';
        exit line_checks;
      end if;
      if v_qty < 1 then
        v_reason := 'qty_below_minimum';
        exit line_checks;
      end if;
      if v_p.type = 'lodging' then
        if v_qty > v_p.max_qty then
          v_reason := 'qty_cap_exceeded';
          exit line_checks;
        end if;
        if v_price_tiers is not null and not exists (
          select 1 from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_qty between t.min_qty and t.max_qty
        ) then
          v_reason := 'no_matching_tier';
          exit line_checks;
        end if;
        if v_p.lobby_category_id is not null and not exists (
          select 1 from public.establishments e
           where e.id = v_p.establishment_id
             and e.lobby_connector_active
             and e.lobby_api_token is not null
        ) then
          v_reason := 'pms_unavailable';
          exit line_checks;
        end if;
      else
        if v_qty < v_p.min_qty then
          v_reason := 'qty_below_minimum';
          exit line_checks;
        end if;
        if v_qty > v_p.max_qty then
          v_reason := 'qty_cap_exceeded';
          exit line_checks;
        end if;
        if v_price_tiers is not null and not exists (
          select 1 from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_qty between t.min_qty and t.max_qty
        ) then
          v_reason := 'no_matching_tier';
          exit line_checks;
        end if;
      end if;

      if v_p.type = 'camp' and v_p.duration_days > 1 and not exists (
        select 1
          from jsonb_array_elements(v_lines) as lodging_elem
         where lodging_elem->>'end_date' is not null
           and (lodging_elem->>'date')::date <= v_date
           and (lodging_elem->>'end_date')::date >= v_date + v_p.duration_days - 1
      ) then
        v_reason := 'camp_missing_lodging';
        exit line_checks;
      end if;

      -- ── Phase 3 de create_order, sans ses verrous ───────────────────────────────────────────
      -- create_order relit ici les paliers BRUTS du produit (pas normalize_price_tiers).
      if v_end_date is not null then
        if not v_p.sellable then
          v_reason := 'not_sellable';
          exit line_checks;
        end if;
        if v_p.price_tiers is null and v_p.price_cop is null then
          v_reason := 'price_missing';
          exit line_checks;
        end if;
        if v_p.lobby_category_id is null then
          for v_night_row in
            select gs.night::date as night,
                   coalesce(pc.open, v_p.calendar_default_open) as calendar_open,
                   pa.capacity as capacity,
                   pa.booked as booked,
                   (select coalesce(sum((l->>'qty')::int), 0)
                      from jsonb_array_elements(v_lines) l
                     where (l->>'product_id')::uuid = v_product_id
                       and l->>'end_date' is not null
                       and gs.night::date >= (l->>'date')::date
                       and gs.night::date < (l->>'end_date')::date
                   ) as cart_qty
              from generate_series(v_date::timestamp, v_end_date::timestamp - interval '1 day', interval '1 day') as gs(night)
              left join public.product_calendar pc
                on pc.product_id = v_product_id and pc.date = gs.night::date
              left join public.product_availability pa
                on pa.product_id = v_product_id and pa.date = gs.night::date
             order by gs.night
          loop
            if not v_night_row.calendar_open then
              v_reason := 'date_closed';
              exit line_checks;
            end if;
            if v_night_row.capacity is null then
              v_reason := 'slot_not_found';
              exit line_checks;
            end if;
            if v_night_row.booked + v_night_row.cart_qty > v_night_row.capacity then
              v_reason := 'full';
              exit line_checks;
            end if;
          end loop;
        end if;

      elsif v_slot_start_time is not null then
        select coalesce(
          (select pc.open from public.product_calendar pc where pc.product_id = v_product_id and pc.date = v_date),
          v_p.calendar_default_open
        ) into v_calendar_open;
        if not v_p.sellable then
          v_reason := 'not_sellable';
          exit line_checks;
        end if;
        if not v_calendar_open then
          v_reason := 'date_closed';
          exit line_checks;
        end if;
        -- create_order matérialise d'abord le créneau attendu (expand_product_slots, on conflict do
        -- nothing) : la ligne existante prime, sinon ce créneau, à booked 0.
        select psa.capacity, psa.booked into v_capacity, v_booked
          from public.product_slot_availability psa
         where psa.product_id = v_product_id
           and psa.slot_date = v_date
           and psa.slot_start_time = v_slot_start_time;
        if not found then
          select v.capacity, 0 into v_capacity, v_booked
            from public.expand_product_slots(v_product_id, v_date) v
           where v.slot_start_time = v_slot_start_time
           limit 1;
          if not found then
            v_reason := 'slot_not_found';
            exit line_checks;
          end if;
        end if;
        if v_booked + (
          select coalesce(sum((l->>'qty')::int), 0) from jsonb_array_elements(v_lines) l
           where (l->>'product_id')::uuid = v_product_id
             and (l->>'date')::date = v_date
             and (l->>'slot_start_time')::time = v_slot_start_time
        ) > v_capacity then
          v_reason := 'full';
          exit line_checks;
        end if;

      else
        select coalesce(
          (select pc.open from public.product_calendar pc where pc.product_id = v_product_id and pc.date = v_date),
          v_p.calendar_default_open
        ) into v_calendar_open;
        if not v_p.sellable then
          v_reason := 'not_sellable';
          exit line_checks;
        end if;
        if not v_calendar_open then
          v_reason := 'date_closed';
          exit line_checks;
        end if;
        if not (v_p.type = 'evento' and v_p.is_free) then
          if v_p.price_tiers is null and v_p.price_cop is null then
            v_reason := 'price_missing';
            exit line_checks;
          end if;
        end if;
        if not (v_p.type = 'evento' and v_p.evento_capacity_mode in ('unlimited', 'rsvp')) then
          select pa.capacity, pa.booked into v_capacity, v_booked
            from public.product_availability pa
           where pa.product_id = v_product_id and pa.date = v_date;
          if not found then
            -- create_order matérialise d'abord cette ligne depuis default_capacity (même prédicat).
            if v_p.default_capacity is not null and (v_p.type <> 'evento' or v_p.evento_capacity_mode = 'metered') then
              v_capacity := v_p.default_capacity;
              v_booked := 0;
            else
              v_reason := 'slot_not_found';
              exit line_checks;
            end if;
          end if;
          if v_booked + (
            select coalesce(sum((l->>'qty')::int), 0) from jsonb_array_elements(v_lines) l
             where (l->>'product_id')::uuid = v_product_id
               and (l->>'date')::date = v_date
          ) > v_capacity then
            v_reason := 'full';
            exit line_checks;
          end if;
        end if;
      end if;

      if v_p.type = 'camp' or (v_p.type = 'evento' and v_p.online_bookable and v_p.evento_occupies_resource) then
        for v_gs in 0..(coalesce(v_p.duration_days, 1) - 1) loop
          select prc.capacity, prc.booked into v_resource_capacity, v_resource_booked
            from public.provider_resource_calendar prc
           where prc.establishment_id = v_p.establishment_id
             and prc.slot_date = v_date + v_gs;
          if not found or v_resource_booked + (
            select coalesce(sum((l.elem->>'qty')::int), 0)
              from jsonb_array_elements(v_lines) with ordinality as l(elem, ord)
             where v_products_establishment_id[l.ord::int] = v_p.establishment_id
               and (v_products_type[l.ord::int] = 'camp'
                    or (v_products_type[l.ord::int] = 'evento'
                        and v_products_online_bookable[l.ord::int]
                        and v_products_evento_occupies_resource[l.ord::int]))
               and v_date + v_gs
                   between (l.elem->>'date')::date
                       and (l.elem->>'date')::date + coalesce(v_products_duration_days[l.ord::int], 1) - 1
          ) > v_resource_capacity then
            v_reason := 'resource_unavailable';
            exit line_checks;
          end if;
        end loop;
      end if;
    end line_checks;

    id := (v_line->>'id')::uuid;
    available := v_reason is null;
    reason := v_reason;
    return next;
  end loop;
end;
$$;

comment on function public.cart_lines_availability() is
  'Pour chaque ligne du panier de l''appelant : disponible, ou la raison ligne exacte que create_order '
  'rendrait (liste fermée dans l''en-tête de la migration). Lecture seule, sans verrou : un confort '
  'd''affichage, jamais la décision — create_order reste seul juge. Parité : cart_lines_availability.test.sql.';

revoke all on function public.cart_lines_availability() from public, anon;
grant execute on function public.cart_lines_availability() to authenticated;

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

  -- Migration 20261014211217 : le panier revient. create_order l'a vidé en créant la commande ; un refus
  -- Lobby la défait, le client retrouve donc ses lignes au lieu d'un panier vide — chaque ligne
  -- relâchée, jamais en double d'une ligne identique déjà revenue dans son panier. L'attribution
  -- du panier d'origine (qr, link) revient avec lui ; 'account' n'y est jamais recopiée,
  -- create_order la relit sur partner_accounts. Un panier déjà rouvert garde la sienne. Rien au
  -- rejeu : il ne relâche aucune ligne et sort plus haut.
  insert into public.carts (account_id, attribution_code, attribution_source)
  select o.account_id,
         case when o.attribution_source in ('qr', 'link') then o.attribution_code end,
         case when o.attribution_source in ('qr', 'link') then o.attribution_source end
    from public.orders o
   where o.id = p_order_id
  on conflict (account_id) do nothing;

  insert into public.cart_items (account_id, product_id, date, end_date, slot_start_time, qty)
  select o.account_id, ol.product_id, ol.date, ol.end_date, ol.slot_start_time, ol.qty
    from public.order_lines ol
    join public.orders o on o.id = ol.order_id
   where ol.id = any(v_released_ids)
     and not exists (
       select 1 from public.cart_items ci
        where ci.account_id = o.account_id
          and ci.product_id = ol.product_id
          and ci.date = ol.date
          and ci.end_date is not distinct from ol.end_date
          and ci.slot_start_time is not distinct from ol.slot_start_time
     );

  return jsonb_build_object('ok', true, 'released_lines', array_length(v_released_ids, 1));
end;
$function$;
