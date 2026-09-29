-- create_order : bornes de quantité, ressource partagée sommée sur le panier, plage obligatoire
-- pour un logement, logement PMS refusé quand son connecteur est coupé ; contraintes CHECK sur les
-- quantités, les montants et les compteurs de capacité.
--
-- CONTRAINTES (aucune n'existait ; 0 ligne en écart sur la base locale au moment de l'écrire) :
--   - cart_items.qty > 0 et order_lines.qty > 0 ;
--   - order_lines : price_cop, total_cop, acompte_cop, referrer_commission_cop, app_commission_cop
--     >= 0 (0 est légitime : evento gratuit, evento payable sur place) ;
--   - booked >= 0 et booked <= capacity sur product_availability, product_slot_availability et
--     provider_resource_calendar. Leurs écrivains vérifient déjà la capacité avant d'incrémenter
--     (create_order, create_manual_order_line, modify_order_line), refusent de passer sous booked
--     (set_product_availability, set_product_slot_capacity, set_provider_resource_capacity →
--     below_booked) ou bornent à 0 (release_order_line_capacity). Seul modify_order_line décrémente
--     sans plancher (booked - qty de l'ancienne ligne) : un compteur déjà incohérent y lève
--     désormais 23514 au lieu de devenir négatif. La contrainte est le filet : une écriture qui la
--     violerait échoue (23514) au lieu de survendre ou de rendre un compteur négatif.
--
-- create_order — corps extrait par pg_get_functiondef depuis la définition vivante
-- (20260916120000_fix_lodging_price_missing_qty.sql), signature INCHANGÉE
-- (.claude/rules/supabase.md règle 7), remplacements comptés (chacun à un seul site) :
--   Phase 1 — `date_range_required` : une ligne lodging sans end_date est refusée.
--   Phase 1 — `qty_below_minimum` si qty < 1, pour tout type, avant le branchement lodging/autres.
--   Phase 1 — lodging : `qty_cap_exceeded` au-delà de coalesce(max_qty, 20) ; pas de min_qty.
--   Phase 1 — lodging PMS-backed dont l'établissement a lobby_connector_active = false ou
--             lobby_api_token nul → `pms_unavailable` (CLAUDE.md §4.4).
--   Phase 3 — ressource partagée (provider_resource_calendar) : booked + somme des lignes du panier
--             qui l'occupent ce jour-là, au lieu de la seule ligne courante ; contrôle appliqué à
--             toute ligne qui l'écrit en Phase 4, quelle que soit sa branche.
--   Phase 4 — product_availability n'est plus incrémentée pour un evento 'unlimited'/'rsvp', que
--             la Phase 3 ne vérifie jamais (même prédicat) : une ligne subsistant pour un tel evento
--             ne peut plus faire échouer une vente sur booked <= capacity.
--   Phase 4 — e-mail « recurso bloqueado » : nom du produit échappé par xmltext() (PostgreSQL 17).
-- Aucun nouveau verrou, ordre des verrous inchangé (product_availability →
-- provider_resource_calendar → product_slot_availability). Grants de create_order inchangés
-- (create or replace les conserve).

alter table public.cart_items
  add constraint cart_items_qty_positive check (qty > 0);

alter table public.order_lines
  add constraint order_lines_qty_positive check (qty > 0),
  add constraint order_lines_amounts_non_negative check (
    price_cop >= 0 and total_cop >= 0 and acompte_cop >= 0
    and referrer_commission_cop >= 0 and app_commission_cop >= 0
  );

alter table public.product_availability
  add constraint product_availability_booked_within_capacity
    check (booked >= 0 and booked <= capacity);

alter table public.product_slot_availability
  add constraint product_slot_availability_booked_within_capacity
    check (booked >= 0 and booked <= capacity);

alter table public.provider_resource_calendar
  add constraint provider_resource_calendar_booked_within_capacity
    check (booked >= 0 and booked <= capacity);

create or replace function public.create_order(p_holder_name text, p_holder_email text DEFAULT NULL::text, p_holder_phone text DEFAULT NULL::text, p_marketing_consent boolean DEFAULT false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_account_id uuid := auth.uid();
  v_order_id uuid;
  -- Spec 32 (panier en base) : plus un paramètre — construites depuis cart_items/carts
  -- pour ce compte, côté serveur, un client ne pouvant plus jamais les falsifier.
  v_lines jsonb;
  v_cart_attribution_code text;
  v_cart_attribution_source text;
  v_line jsonb;
  v_line_idx int;
  v_product_type text;
  v_min_qty int;
  v_max_qty int;
  v_price_tiers jsonb;
  v_lodging_lines int := 0;
  v_lodging_units int := 0;
  v_prestation_lines int := 0;
  v_avail record;
  v_attribution_code text;
  v_attribution_source text;
  v_referrer_partner_id uuid;
  -- 2026-09-10 (/simplify) : la condition « identité durable non anonyme » était calculée
  -- deux fois (lecture + écriture de saved_attribution_code) — une seule fois ici, réutilisée.
  v_identified_account boolean := v_account_id is not null and not (select public.is_anonymous_session());
  v_products_type text[];
  v_products_sellable boolean[];
  v_products_price_cop bigint[];
  v_products_price_tiers jsonb[];
  v_products_establishment_id uuid[];
  v_products_duration_days int[];
  v_products_partner_id uuid[];
  v_products_calendar_default_open boolean[];
  v_products_stay_rates jsonb[];
  v_products_lobby_category_id int[];
  -- Ajout de la migration 20260914130000 — remise par seuil de remplissage cumulé (camps).
  v_products_group_discount_threshold_qty int[];
  v_products_group_discount_pct numeric(5, 4)[];
  v_camp_fill_before_qty int[];
  -- Ajout migration evento_online_bookable (20260915130000).
  v_products_online_bookable boolean[];
  v_products_is_free boolean[];
  v_products_evento_capacity_mode text[];
  v_products_evento_payment_mode text[];
  v_products_evento_occupies_resource boolean[];
begin
  -- 2026-09-10 (spec 31, Tranche 1) — garde RÉINTRODUITE, en connaissance de son historique.
  -- Elle avait été retirée le 2026-08-13 (migration 20260814090000_create_order_guest_checkout.sql)
  -- pour que la réservation invité reste possible SANS COMPTE, décision de Jérôme documentée là-bas
  -- (cahier §1/§2 : « forcer un compte avant achat fait perdre des ventes »). Cette décision N'EST
  -- PAS renversée ici : elle porte sur le MOT DE PASSE, jamais exigé. Ce qui change, c'est qu'après
  -- ce lot, CartContext (apps/web) crée une session anonyme Supabase dès le premier ajout au panier
  -- (spec 31 invariant 1) — donc au moment où cette RPC est atteinte depuis l'écran réel, auth.uid()
  -- n'est PLUS jamais nul. La garde ne bloque que ce qui n'a plus aucun chemin légitime : un appel
  -- direct à la RPC sans passer par le panier. Elle prépare aussi `orders.account_id` NOT NULL
  -- (Tranche 2, spec 31) : sans elle, cette contrainte future remonterait une erreur Postgres brute
  -- (23502) au navigateur au lieu d'un motif exploitable par l'écran.
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Spec 32 : les lignes viennent de cart_items pour CE compte, jamais d'un paramètre. Un
  -- product_id/qty/date passé par le client ne peut plus jamais diverger de ce qu'il a
  -- réellement dans son panier au moment du checkout.
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', product_id,
           'date', date,
           'end_date', end_date,
           'slot_start_time', slot_start_time,
           'qty', qty
         ) order by created_at), '[]'::jsonb)
    into v_lines
    from public.cart_items
   where account_id = v_account_id;

  select attribution_code, attribution_source
    into v_cart_attribution_code, v_cart_attribution_source
    from public.carts
   where account_id = v_account_id;

  if jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_cart');
  end if;

  if p_holder_email is null or btrim(p_holder_email) = '' then
    return jsonb_build_object('ok', false, 'reason', 'email_required');
  end if;
  if p_holder_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'reason', 'email_invalid');
  end if;

  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
  loop
    declare
      v_line_end_date date := (v_line->>'end_date')::date;
      v_line_qty int := (v_line->>'qty')::int;
      v_line_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_p_sellable boolean;
      v_p_price_cop bigint;
      v_p_establishment_id uuid;
      v_p_duration_days int;
      v_p_partner_id uuid;
      v_p_calendar_default_open boolean;
      v_p_stay_rates jsonb;
      v_p_lobby_category_id int;
      v_p_group_discount_threshold_qty int;
      v_p_group_discount_pct numeric(5, 4);
      v_p_online_bookable boolean;
      v_p_is_free boolean;
      v_p_evento_capacity_mode text;
      v_p_evento_payment_mode text;
      v_p_evento_occupies_resource boolean;
    begin
      select type, coalesce(min_qty, 1), coalesce(max_qty, 20), price_tiers,
             sellable, price_cop, establishment_id, duration_days, partner_id,
             calendar_default_open, stay_rates, lobby_category_id,
             group_discount_threshold_qty, group_discount_pct,
             online_bookable, is_free, evento_capacity_mode, evento_payment_mode, evento_occupies_resource
        into v_product_type, v_min_qty, v_max_qty, v_price_tiers,
             v_p_sellable, v_p_price_cop, v_p_establishment_id, v_p_duration_days, v_p_partner_id,
             v_p_calendar_default_open, v_p_stay_rates, v_p_lobby_category_id,
             v_p_group_discount_threshold_qty, v_p_group_discount_pct,
             v_p_online_bookable, v_p_is_free, v_p_evento_capacity_mode, v_p_evento_payment_mode, v_p_evento_occupies_resource
        from public.products where id = (v_line->>'product_id')::uuid;
      if not found then
        return jsonb_build_object('ok', false, 'reason', 'product_not_found', 'line', v_line);
      end if;

      v_products_type[v_line_idx] := v_product_type;
      v_products_sellable[v_line_idx] := v_p_sellable;
      v_products_price_cop[v_line_idx] := v_p_price_cop;
      v_products_price_tiers[v_line_idx] := v_price_tiers;
      v_products_establishment_id[v_line_idx] := v_p_establishment_id;
      v_products_duration_days[v_line_idx] := v_p_duration_days;
      v_products_partner_id[v_line_idx] := v_p_partner_id;
      v_products_calendar_default_open[v_line_idx] := v_p_calendar_default_open;
      v_products_stay_rates[v_line_idx] := v_p_stay_rates;
      v_products_lobby_category_id[v_line_idx] := v_p_lobby_category_id;
      v_products_group_discount_threshold_qty[v_line_idx] := v_p_group_discount_threshold_qty;
      v_products_group_discount_pct[v_line_idx] := v_p_group_discount_pct;
      v_products_online_bookable[v_line_idx] := v_p_online_bookable;
      v_products_is_free[v_line_idx] := v_p_is_free;
      v_products_evento_capacity_mode[v_line_idx] := v_p_evento_capacity_mode;
      v_products_evento_payment_mode[v_line_idx] := v_p_evento_payment_mode;
      v_products_evento_occupies_resource[v_line_idx] := v_p_evento_occupies_resource;

      -- Ajout migration evento_online_bookable : défense en profondeur — une date hors calendrier
      -- d'occurrence de l'evento (jamais une vraie occurrence once/recurring) est refusée ici,
      -- avant tout verrou. Peu coûteux, complète (sans remplacer) la vérification calendar_open/
      -- capacity plus bas, qui reste la vraie barrière anti-survente. Scopé à online_bookable :
      -- un evento non activé n'a structurellement aucune occurrence exploitable par ce chemin
      -- (occurrence_type/occurrence_date jamais renseignés avant activation), et certains fixtures
      -- de test antérieurs à ce lot utilisent délibérément type='evento' sans occurrence pour
      -- exploiter sa contrainte price_cop assouplie (create_order.test.sql cas 18) — ce garde ne
      -- doit pas les faire régresser.
      if v_product_type = 'evento' and v_p_online_bookable then
        if not exists (
          select 1 from public.expand_event_occurrences(
            (v_line->>'product_id')::uuid, (v_line->>'date')::date, (v_line->>'date')::date
          )
        ) then
          return jsonb_build_object('ok', false, 'reason', 'invalid_occurrence_date', 'line', v_line);
        end if;
      end if;

      v_price_tiers := public.normalize_price_tiers(v_price_tiers);

      if v_line_end_date is not null and v_product_type <> 'lodging' then
        return jsonb_build_object('ok', false, 'reason', 'unsupported_date_range', 'line', v_line);
      end if;
      if v_line_end_date is not null and v_line_end_date <= (v_line->>'date')::date then
        return jsonb_build_object('ok', false, 'reason', 'invalid_date_range', 'line', v_line);
      end if;

      -- Ajout de la migration 20260929112240 : un logement se réserve toujours par plage de
      -- nuits. Sans end_date, il tombait dans la branche « date unique » (prix palier × qty sans
      -- tarif par nuit, ligne product_availability créée même pour un PMS-backed). Aucun écran
      -- n'emprunte ce chemin (LodgingReservationForm envoie toujours endDate).
      if v_product_type = 'lodging' and v_line_end_date is null then
        return jsonb_build_object('ok', false, 'reason', 'date_range_required', 'line', v_line);
      end if;

      if v_line_slot_start_time is not null then
        if v_line_end_date is not null then
          return jsonb_build_object('ok', false, 'reason', 'unsupported_slot_combination', 'line', v_line);
        end if;
      elsif v_line_end_date is null and exists (
        select 1 from public.product_slot_rules where product_id = (v_line->>'product_id')::uuid
      ) then
        return jsonb_build_object('ok', false, 'reason', 'slot_required', 'line', v_line);
      end if;

      -- Ajout de la migration 20260929112240 : quantité ≥ 1 pour TOUT type, avant le
      -- branchement — la branche lodging n'avait aucune borne, et un min_qty produit ≤ 0
      -- n'abaisse jamais ce plancher.
      if v_line_qty < 1 then
        return jsonb_build_object('ok', false, 'reason', 'qty_below_minimum', 'line', v_line);
      end if;

      if v_product_type = 'lodging' then
        -- Ajout de la migration 20260929112240 : plafond coalesce(max_qty, 20), le même que
        -- les autres types et que la vitrine (apps/web/lib/catalog/producto.ts). Pas de min_qty
        -- pour un logement : la vitrine le réserve avec un minimum fixé à 1
        -- (apps/web/lib/reservas/cantidad.ts).
        if v_line_qty > v_max_qty then
          return jsonb_build_object('ok', false, 'reason', 'qty_cap_exceeded', 'line', v_line);
        end if;
        -- Ajout de la migration 20260929112240 (CLAUDE.md §4.4, échec fermé) : un logement
        -- PMS-backed (lobby_category_id non nul, même prédicat qu'isPmsBacked) n'a aucun contrôle
        -- de capacité local — Lobby, appelé ensuite par /api/pms/reserve-nights, est son seul
        -- contrôle, et cette route écarte un établissement dont le connecteur est coupé. Refusé
        -- ici, avant tout verrou.
        if v_p_lobby_category_id is not null and not exists (
          select 1 from public.establishments e
           where e.id = v_p_establishment_id
             and e.lobby_connector_active
             and e.lobby_api_token is not null
        ) then
          return jsonb_build_object('ok', false, 'reason', 'pms_unavailable', 'line', v_line);
        end if;
        v_lodging_lines := v_lodging_lines + 1;
        v_lodging_units := v_lodging_units + v_line_qty;
      else
        v_prestation_lines := v_prestation_lines + 1;
        if v_line_qty < v_min_qty then
          return jsonb_build_object('ok', false, 'reason', 'qty_below_minimum', 'line', v_line);
        end if;
        if v_line_qty > v_max_qty then
          return jsonb_build_object('ok', false, 'reason', 'qty_cap_exceeded', 'line', v_line);
        end if;
        if v_price_tiers is not null and not exists (
          select 1 from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_line_qty between t.min_qty and t.max_qty
        ) then
          return jsonb_build_object('ok', false, 'reason', 'no_matching_tier', 'line', v_line);
        end if;
      end if;
    end;
  end loop;
  -- Valeurs relevées le 2026-09-07 (cahier §3e) pour la commande multi-établissements, jamais
  -- codées jusqu'ici (trouvé en préparant spec 32 §10) : 4/12/20 étaient encore celles de l'ère
  -- un-seul-établissement.
  if v_lodging_lines > 12 or v_lodging_units > 36 then
    return jsonb_build_object('ok', false, 'reason', 'lodging_cap_exceeded');
  end if;
  if v_prestation_lines > 40 then
    return jsonb_build_object('ok', false, 'reason', 'prestation_cap_exceeded');
  end if;

  -- Ajout de la migration 20260915100000 : un camp de plus d'un jour (duration_days > 1, donc au
  -- moins 1 nuit requise) exige, dans ce MÊME panier, au moins une ligne lodging qui couvre à elle
  -- seule la totalité des nuits requises — "camp du 1 au 5" = les nuits 1,2,3,4, donc dernier jour
  -- du camp = date_depart + duration_days - 1 (même formule que provider_resource_calendar/
  -- availability_blocks plus bas). Vérifie UNIQUEMENT la couverture des dates, jamais une
  -- comparaison de quantité (cf. en-tête de 20260915100000). Emplacement délibéré : juste après
  -- les plafonds de composition ci-dessus, avant tout verrou — aucun nouveau tableau, aucune
  -- requête ni verrou supplémentaire, v_lines/v_products_type[]/v_products_duration_days[] étant
  -- déjà entièrement peuplés par la boucle Phase 1 ci-dessus.
  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
  loop
    if v_products_type[v_line_idx] = 'camp' and v_products_duration_days[v_line_idx] > 1 then
      declare
        v_camp_arrival date := (v_line->>'date')::date;
        v_camp_last_day date := v_camp_arrival + v_products_duration_days[v_line_idx] - 1;
      begin
        if not exists (
          select 1
            from jsonb_array_elements(v_lines) as lodging_elem
           where lodging_elem->>'end_date' is not null
             and (lodging_elem->>'date')::date <= v_camp_arrival
             and (lodging_elem->>'end_date')::date >= v_camp_last_day
        ) then
          return jsonb_build_object('ok', false, 'reason', 'camp_missing_lodging', 'line', v_line);
        end if;
      end;
    end if;
  end loop;

  insert into public.product_availability (product_id, date, capacity, booked)
  select distinct p.id, (elem->>'date')::date, p.default_capacity, 0
    from jsonb_array_elements(v_lines) elem
    join public.products p on p.id = (elem->>'product_id')::uuid
   where elem->>'end_date' is null
     and p.default_capacity is not null
     -- Ajout migration evento_online_bookable : un evento 'rsvp' PORTE un default_capacity
     -- informatif (dénominateur du compteur) — ne jamais le matérialiser en product_availability,
     -- qui serait alors lu/verrouillé comme s'il fallait le décompter.
     and (p.type <> 'evento' or p.evento_capacity_mode = 'metered')
  on conflict (product_id, date) do nothing;

  insert into public.product_slot_availability (
    product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked
  )
  select distinct p.id, (elem->>'date')::date, v.slot_start_time, v.slot_duration_minutes, v.capacity, 0
    from jsonb_array_elements(v_lines) elem
    join public.products p on p.id = (elem->>'product_id')::uuid
    cross join lateral public.expand_product_slots(p.id, (elem->>'date')::date) v
   where elem->>'slot_start_time' is not null
     and v.slot_start_time = (elem->>'slot_start_time')::time
  on conflict (product_id, slot_date, slot_start_time) do nothing;

  for v_avail in
    select pa.product_id, pa.date
      from public.product_availability pa
     where (pa.product_id, pa.date) in (
       select (elem->>'product_id')::uuid, (elem->>'date')::date
         from jsonb_array_elements(v_lines) elem
        where elem->>'end_date' is null
       union
       select (elem->>'product_id')::uuid, (elem->>'date')::date + gs
         from jsonb_array_elements(v_lines) elem
         join public.products p2 on p2.id = (elem->>'product_id')::uuid
         cross join lateral generate_series(0, ((elem->>'end_date')::date - (elem->>'date')::date) - 1) as gs
        where elem->>'end_date' is not null
          and p2.lobby_category_id is null
     )
     order by pa.product_id, pa.date
     for update
  loop
    null;
  end loop;

  for v_avail in
    select prc.establishment_id, prc.slot_date
      from public.provider_resource_calendar prc
     where (prc.establishment_id, prc.slot_date) in (
       -- Ajout migration evento_online_bookable : un evento réservable qui occupe la ressource
       -- (evento_occupies_resource, défaut true) verrouille désormais ce même calendrier partagé,
       -- traité comme « un camp d'un seul jour » (coalesce(duration_days, 1) — toujours NULL pour
       -- un evento, jamais pour un camp, donc bascule naturellement sur 1 jour).
       select p.establishment_id, (elem->>'date')::date + gs
         from jsonb_array_elements(v_lines) elem
         join public.products p on p.id = (elem->>'product_id')::uuid
         cross join generate_series(0, coalesce(p.duration_days, 1) - 1) as gs
        where p.type = 'camp' or (p.type = 'evento' and p.online_bookable and p.evento_occupies_resource)
     )
     order by prc.establishment_id, prc.slot_date
     for update
  loop
    null;
  end loop;

  for v_avail in
    select psa.product_id, psa.slot_date, psa.slot_start_time
      from public.product_slot_availability psa
     where (psa.product_id, psa.slot_date, psa.slot_start_time) in (
       select (elem->>'product_id')::uuid, (elem->>'date')::date, (elem->>'slot_start_time')::time
         from jsonb_array_elements(v_lines) elem
        where elem->>'slot_start_time' is not null
     )
     order by psa.product_id, psa.slot_date, psa.slot_start_time
     for update
  loop
    null;
  end loop;

  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
  loop
    declare
      v_sellable boolean;
      v_calendar_open boolean;
      v_capacity int;
      v_booked int;
      v_line_type text;
      v_line_establishment_id uuid;
      v_line_duration_days int;
      v_gs int;
      v_resource_capacity int;
      v_resource_booked int;
      v_line_price_cop bigint;
      v_line_price_tiers jsonb;
      v_line_end_date date := (v_line->>'end_date')::date;
      v_line_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_night date;
      v_cart_qty int;
      v_night_row record;
    begin
      if v_line_end_date is not null then
        v_sellable := v_products_sellable[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        if not v_sellable then
          return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
        end if;
        if v_line_price_tiers is null and v_line_price_cop is null then
          return jsonb_build_object('ok', false, 'reason', 'price_missing', 'line', v_line);
        end if;
        if v_products_lobby_category_id[v_line_idx] is null then
          for v_night_row in
            select gs.night::date as night,
                   coalesce(pc.open, v_products_calendar_default_open[v_line_idx]) as calendar_open,
                   pa.capacity as capacity,
                   pa.booked as booked,
                   (select coalesce(sum((l->>'qty')::int), 0)
                      from jsonb_array_elements(v_lines) l
                     where (l->>'product_id')::uuid = (v_line->>'product_id')::uuid
                       and l->>'end_date' is not null
                       and gs.night::date >= (l->>'date')::date
                       and gs.night::date < (l->>'end_date')::date
                   ) as cart_qty
              from generate_series(
                     (v_line->>'date')::date::timestamp,
                     v_line_end_date::timestamp - interval '1 day',
                     interval '1 day'
                   ) as gs(night)
              left join public.product_calendar pc
                on pc.product_id = (v_line->>'product_id')::uuid and pc.date = gs.night::date
              left join public.product_availability pa
                on pa.product_id = (v_line->>'product_id')::uuid and pa.date = gs.night::date
             order by gs.night
          loop
            if not v_night_row.calendar_open then
              return jsonb_build_object('ok', false, 'reason', 'date_closed', 'line', v_line, 'date', v_night_row.night);
            end if;
            if v_night_row.capacity is null then
              return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line, 'date', v_night_row.night);
            end if;
            if v_night_row.booked + v_night_row.cart_qty > v_night_row.capacity then
              return jsonb_build_object('ok', false, 'reason', 'full', 'line', v_line, 'date', v_night_row.night);
            end if;
          end loop;
        end if;

      elsif v_line_slot_start_time is not null then
        v_sellable := v_products_sellable[v_line_idx];
        select coalesce(
          (select pc.open from public.product_calendar pc
            where pc.product_id = (v_line->>'product_id')::uuid and pc.date = (v_line->>'date')::date),
          v_products_calendar_default_open[v_line_idx]
        ) into v_calendar_open;
        if not v_sellable then
          return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
        end if;
        if not v_calendar_open then
          return jsonb_build_object('ok', false, 'reason', 'date_closed', 'line', v_line);
        end if;

        select capacity, booked into v_capacity, v_booked
          from public.product_slot_availability
         where product_id = (v_line->>'product_id')::uuid
           and slot_date = (v_line->>'date')::date
           and slot_start_time = v_line_slot_start_time;
        if not found then
          return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line);
        end if;

        if v_booked + (
          select coalesce(sum((l->>'qty')::int), 0) from jsonb_array_elements(v_lines) l
           where (l->>'product_id')::uuid = (v_line->>'product_id')::uuid
             and (l->>'date')::date = (v_line->>'date')::date
             and (l->>'slot_start_time')::time = v_line_slot_start_time
        ) > v_capacity then
          return jsonb_build_object('ok', false, 'reason', 'full', 'line', v_line);
        end if;

      else
        v_sellable := v_products_sellable[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_line_duration_days := v_products_duration_days[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        select coalesce(
          (select pc.open from public.product_calendar pc
            where pc.product_id = (v_line->>'product_id')::uuid and pc.date = (v_line->>'date')::date),
          v_products_calendar_default_open[v_line_idx]
        ) into v_calendar_open;

        if not v_sellable then
          return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
        end if;
        if not v_calendar_open then
          return jsonb_build_object('ok', false, 'reason', 'date_closed', 'line', v_line);
        end if;

        -- Ajout migration evento_online_bookable : un evento gratuit (is_free) n'a jamais de prix
        -- à vérifier — price_cop/price_tiers restent NULL par construction (contrainte DB
        -- products_evento_is_free_price_null), ce n'est jamais une fiche mal remplie.
        if not (v_line_type = 'evento' and v_products_is_free[v_line_idx]) then
          if v_line_price_tiers is null and v_line_price_cop is null then
            return jsonb_build_object('ok', false, 'reason', 'price_missing', 'line', v_line);
          end if;
        end if;

        -- Ajout migration evento_online_bookable : les modes 'unlimited'/'rsvp' n'ont, par
        -- construction, aucune ressource rare à protéger (aucune ligne product_availability
        -- n'existe pour eux, cf. provisionnement plus haut) — aucune lecture ni verrou ici. Le
        -- mode 'metered' retombe dans le bloc existant, inchangé, qui couvre déjà activity/camp.
        -- Migration 20260929112240 : une ligne peut pourtant exister pour ces modes (ancien mode
        -- 'metered', modify_order_line, create_manual_order_line) — la Phase 4 ne l'écrit plus non
        -- plus, par le même prédicat.
        if not (v_line_type = 'evento' and v_products_evento_capacity_mode[v_line_idx] in ('unlimited', 'rsvp')) then
          select capacity, booked into v_capacity, v_booked
            from public.product_availability
           where product_id = (v_line->>'product_id')::uuid and date = (v_line->>'date')::date;
          if not found then
            return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line);
          end if;

          -- Ajout de 20260914130000 : remplissage AVANT cette commande, capturé sous le même verrou
          -- que v_booked ci-dessus (aucune requête supplémentaire) — sert en Phase 4 à décider si la
          -- ligne franchit le seuil de remise (camps uniquement, group_discount_threshold_qty null
          -- pour tout autre type). Valeur déjà cohérente avec la vérification de capacité qui suit.
          v_camp_fill_before_qty[v_line_idx] := v_booked;

          if v_booked + (
            select coalesce(sum((l->>'qty')::int), 0) from jsonb_array_elements(v_lines) l
             where (l->>'product_id')::uuid = (v_line->>'product_id')::uuid
               and (l->>'date')::date = (v_line->>'date')::date
          ) > v_capacity then
            return jsonb_build_object('ok', false, 'reason', 'full', 'line', v_line);
          end if;
        end if;
      end if;

      -- Ajout migration evento_online_bookable : la ressource partagée du prestataire (déjà
      -- verrouillée plus haut) protège désormais aussi un evento réservable qui l'occupe.
      -- Ajout de la migration 20260929112240 : (1) contrôle sorti de la seule branche « date
      -- unique » — la Phase 4 écrit la ressource pour toute ligne camp/evento occupant, quelle que
      -- soit sa branche, elle est donc vérifiée dans les mêmes conditions ; (2) booked + la SOMME
      -- des lignes du panier qui occupent cette ressource ce jour-là (même établissement, même
      -- prédicat et même plage que l'écriture de Phase 4), et non plus la seule qty de la ligne
      -- courante — deux lignes d'un même panier qui se chevauchent s'additionnent, comme
      -- product_availability le fait déjà par produit et date. Aucun verrou de plus : ces lignes
      -- sont celles verrouillées en Phase 2.
      if v_products_type[v_line_idx] = 'camp'
         or (v_products_type[v_line_idx] = 'evento'
             and v_products_online_bookable[v_line_idx]
             and v_products_evento_occupies_resource[v_line_idx])
      then
        for v_gs in 0..(coalesce(v_products_duration_days[v_line_idx], 1) - 1) loop
          select capacity, booked into v_resource_capacity, v_resource_booked
            from public.provider_resource_calendar
           where establishment_id = v_products_establishment_id[v_line_idx]
             and slot_date = (v_line->>'date')::date + v_gs;
          if not found or v_resource_booked + (
            select coalesce(sum((l.elem->>'qty')::int), 0)
              from jsonb_array_elements(v_lines) with ordinality as l(elem, ord)
             where v_products_establishment_id[l.ord::int] = v_products_establishment_id[v_line_idx]
               and (v_products_type[l.ord::int] = 'camp'
                    or (v_products_type[l.ord::int] = 'evento'
                        and v_products_online_bookable[l.ord::int]
                        and v_products_evento_occupies_resource[l.ord::int]))
               and (v_line->>'date')::date + v_gs
                   between (l.elem->>'date')::date
                       and (l.elem->>'date')::date
                           + coalesce(v_products_duration_days[l.ord::int], 1) - 1
          ) > v_resource_capacity then
            return jsonb_build_object('ok', false, 'reason', 'resource_unavailable', 'line', v_line);
          end if;
        end loop;
      end if;
    end;
  end loop;

  -- 2026-09-10 (spec 31 invariant 3) — `and not is_anonymous_session()` ajouté aux DEUX endroits
  -- de ce bloc (lecture ci-dessous, écriture plus bas). Sans cette exclusion, la préférence
  -- d'attribution durable se serait mise à s'écrire sur une IDENTITÉ ANONYME dès l'invariant 1 en
  -- vigueur — chaque commande invité avec ?ref= aurait estampillé le code sur l'identité, et les
  -- commandes suivantes de ce même visiteur l'auraient réutilisé sans ?ref=, source='account'.
  -- Exactement ce que la décision ② interdit (« jamais sur l'identité »), et ce que le §3c du
  -- cahier client (validé 2026-08-13) interdit déjà pour un invité (« vaut pour la réservation en
  -- cours, jamais une préférence durable »). v_account_id seul ne suffit plus à distinguer : après
  -- ce lot, un invité EST v_account_id is not null (son identité anonyme), donc c'est précisément
  -- le test qui aurait laissé passer la régression.
  -- Spec 32 : la source n'est plus un paramètre client mais carts.attribution_code, capté par
  -- CartContext dès le premier ajout au panier (spec 32 §4) — jamais l'identité elle-même (spec
  -- 31 invariant 3). Repli inchangé pour un compte réel sans attribution de panier :
  -- partner_accounts.saved_attribution_code, sa durée de vie dépassant celle d'un panier.
  if v_cart_attribution_code is not null then
    v_attribution_code := v_cart_attribution_code;
    v_attribution_source := v_cart_attribution_source;
  elsif v_identified_account then
    select saved_attribution_code into v_attribution_code
      from public.partner_accounts where id = v_account_id;
    v_attribution_source := 'account';
  end if;

  if v_attribution_code is not null then
    select partner_id into v_referrer_partner_id
      from public.partner_codes
     where code = v_attribution_code and active = true;
  end if;

  if v_referrer_partner_id is null then
    v_attribution_code := null;
    v_attribution_source := null;
  end if;

  if v_identified_account and v_cart_attribution_code is not null and v_referrer_partner_id is not null then
    update public.partner_accounts set saved_attribution_code = v_cart_attribution_code
     where id = v_account_id;
  end if;

  insert into public.orders (
    account_id, holder_name, holder_email, holder_phone, marketing_consent,
    referrer_partner_id, attribution_code, attribution_source
  )
  values (
    v_account_id, p_holder_name, p_holder_email, p_holder_phone, p_marketing_consent,
    v_referrer_partner_id, v_attribution_code, v_attribution_source
  )
  returning id into v_order_id;

  -- Spec 32 : le panier de ce compte n'a plus lieu d'exister dès qu'une commande le remplace —
  -- seulement à partir d'ici (tout retour 'ok', false plus haut laisse cart_items intact, cas
  -- limite de la spec 32 §0).
  delete from public.cart_items where account_id = v_account_id;
  delete from public.carts where account_id = v_account_id;

  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
  loop
    declare
      v_line_partner_id uuid;
      v_line_price_cop bigint;
      v_line_price_tiers jsonb;
      v_total_cop bigint;
      v_commission_case text;
      v_referrer_pct numeric(5, 4);
      v_app_pct numeric(5, 4);
      v_acompte_pct numeric(5, 4);
      v_line_type text;
      v_line_establishment_id uuid;
      v_line_duration_days int;
      v_order_line_id uuid;
      v_line_end_date date := (v_line->>'end_date')::date;
      v_line_qty int := (v_line->>'qty')::int;
      v_line_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_night date;
      v_gs int;
      v_nights int;
      v_sum_nightly bigint;
      v_tier_price bigint;
      v_stay_rates jsonb;
      v_camp_product_name text;
      v_camp_partner_account record;
    begin
      if v_line_end_date is not null then
        v_line_partner_id := v_products_partner_id[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_stay_rates := v_products_stay_rates[v_line_idx];
        select public.resolve_tier_price(v_line_price_tiers, v_line_price_cop, v_line_qty) into v_tier_price;

        v_nights := v_line_end_date - (v_line->>'date')::date;
        v_sum_nightly := 0;
        for v_gs in 0..(v_nights - 1) loop
          v_night := (v_line->>'date')::date + v_gs;
          v_sum_nightly := v_sum_nightly + public.resolve_date_price((v_line->>'product_id')::uuid, v_night, v_tier_price, v_stay_rates);
        end loop;
        if v_products_lobby_category_id[v_line_idx] is null then
          update public.product_availability set booked = booked + v_line_qty
           where product_id = (v_line->>'product_id')::uuid
             and date >= (v_line->>'date')::date and date < v_line_end_date;
        end if;
        v_line_price_cop := v_sum_nightly;
        v_total_cop := v_sum_nightly * v_line_qty;

      elsif v_line_slot_start_time is not null then
        v_line_partner_id := v_products_partner_id[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_line_duration_days := v_products_duration_days[v_line_idx];
        v_line_price_tiers := public.normalize_price_tiers(v_line_price_tiers);

        if v_line_price_tiers is not null then
          select t.price_cop into v_line_price_cop
            from jsonb_to_recordset(v_line_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_line_qty between t.min_qty and t.max_qty
           limit 1;
        end if;

        v_total_cop := v_line_price_cop * v_line_qty;

        update public.product_slot_availability set booked = booked + v_line_qty
         where product_id = (v_line->>'product_id')::uuid
           and slot_date = (v_line->>'date')::date
           and slot_start_time = v_line_slot_start_time;

      else
        v_line_partner_id := v_products_partner_id[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_line_duration_days := v_products_duration_days[v_line_idx];

        -- Ajout migration evento_online_bookable : un evento gratuit n'a ni price_tiers ni
        -- price_cop (contrainte DB products_evento_is_free_price_null) — prix et total à 0
        -- directement, sans passer par la résolution de palier ni la remise de groupe
        -- (structurellement sans objet pour un evento : group_discount_threshold_qty est
        -- toujours null hors camp).
        if v_line_type = 'evento' and v_products_is_free[v_line_idx] then
          v_line_price_cop := 0;
          v_total_cop := 0;
        else
          v_line_price_tiers := public.normalize_price_tiers(v_line_price_tiers);

          if v_line_price_tiers is not null then
            select t.price_cop into v_line_price_cop
              from jsonb_to_recordset(v_line_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
             where v_line_qty between t.min_qty and t.max_qty
             limit 1;
          end if;

          -- Ajout de la migration 20260914130000 : remise par seuil de remplissage cumulé, camps
          -- uniquement. Comparaison sur le remplissage APRÈS cette ligne (fill_avant + qty), pas
          -- juste avant — décision actée avec Jérôme : la réservation qui fait elle-même franchir le
          -- seuil en bénéficie (sinon un groupe qui réserve d'un coup assez de places pour franchir
          -- le seuil n'en bénéficierait jamais lui-même). group_discount_threshold_qty est
          -- structurellement null pour tout type autre que camp, donc cette branche n'a aucun effet
          -- en dehors des camps configurés.
          if v_line_type = 'camp'
             and v_products_group_discount_threshold_qty[v_line_idx] is not null
             and v_camp_fill_before_qty[v_line_idx] + v_line_qty
                 >= v_products_group_discount_threshold_qty[v_line_idx]
          then
            v_total_cop := round(
              v_line_price_cop * v_line_qty * (1 - v_products_group_discount_pct[v_line_idx])
            );
          else
            v_total_cop := v_line_price_cop * v_line_qty;
          end if;
        end if;

        -- Ajout de la migration 20260929112240 : même prédicat que la Phase 3, qui ne vérifie jamais
        -- la capacité d'un evento 'unlimited'/'rsvp' — n'écrire que ce qui a été vérifié. Une ligne
        -- product_availability peut subsister pour un tel evento (ancien mode 'metered', lignes
        -- posées par modify_order_line ou create_manual_order_line) : l'incrémenter sans contrôle
        -- heurterait booked <= capacity sur une vente que ces modes ne bloquent jamais.
        if not (v_line_type = 'evento' and v_products_evento_capacity_mode[v_line_idx] in ('unlimited', 'rsvp')) then
          update public.product_availability set booked = booked + v_line_qty
           where product_id = (v_line->>'product_id')::uuid and date = (v_line->>'date')::date;
        end if;
      end if;

      if v_referrer_partner_id is null then
        v_commission_case := 'direct';        v_referrer_pct := 0;    v_app_pct := 0.17;
      elsif v_referrer_partner_id = v_line_partner_id then
        v_commission_case := 'self_referral'; v_referrer_pct := 0;    v_app_pct := 0.07;
      else
        v_commission_case := 'external_referrer'; v_referrer_pct := 0.10; v_app_pct := 0.07;
      end if;

      -- Ajout migration evento_online_bookable : un evento gratuit ou payable sur place ne fait
      -- transiter AUCUN argent par l'app — annuler referrer_pct/app_pct (pas seulement l'acompte)
      -- pour ces deux cas, sinon une commission serait due sans aucune contrepartie financière
      -- réelle collectée en ligne pour la financer (contrairement à toute autre réservation, où
      -- c'est justement l'acompte en ligne qui finance ces commissions). Le prestataire garde
      -- 100 % du prix pour ces lignes. commission_case n'est PAS réécrit (reste
      -- direct/self_referral/external_referrer selon la relation de référencement réelle) — seuls
      -- les pourcentages sont annulés.
      if v_line_type = 'evento'
         and (v_products_is_free[v_line_idx] or v_products_evento_payment_mode[v_line_idx] = 'on_site')
      then
        v_referrer_pct := 0;
        v_app_pct := 0;
      end if;
      v_acompte_pct := v_referrer_pct + v_app_pct;

      -- Ajout de la migration 20260910160000 : holder_phone, holder_email dans la liste de colonnes
      -- et de valeurs (jusqu'ici seul holder_name était dupliqué depuis p_holder_name/
      -- p_holder_email/p_holder_phone déjà disponibles comme paramètres de cette fonction).
      insert into public.order_lines (
        order_id, account_id, product_id, date, end_date, slot_start_time, qty,
        referrer_partner_id, holder_name, holder_phone, holder_email, price_cop, total_cop,
        commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop,
        app_commission_cop
      )
      values (
        v_order_id, v_account_id, (v_line->>'product_id')::uuid, (v_line->>'date')::date,
        v_line_end_date, v_line_slot_start_time, v_line_qty,
        v_referrer_partner_id, p_holder_name, p_holder_phone, p_holder_email,
        v_line_price_cop, v_total_cop, v_commission_case, v_acompte_pct, v_referrer_pct, v_app_pct,
        round(v_total_cop * v_acompte_pct), round(v_total_cop * v_referrer_pct), round(v_total_cop * v_app_pct)
      )
      returning id into v_order_line_id;

      -- Ajout migration evento_online_bookable : gardé sur le MONTANT réellement calculé (pas
      -- seulement v_referrer_pct > 0) — sans ça, un evento gratuit (v_total_cop = 0, referrer_pct
      -- resté à 0.10 non modifié ci-dessus) violerait quand même ledger_entries_amount_cop_check
      -- (amount_cop > 0) : round(0 * 0.10) = 0.
      if v_commission_case = 'external_referrer' and round(v_total_cop * v_referrer_pct) > 0 then
        insert into public.ledger_entries (
          order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status
        )
        values (
          v_order_line_id, 'referrer', v_referrer_partner_id, 'referral_earned',
          round(v_total_cop * v_referrer_pct), 'estimated'
        );
      end if;

      -- Ajout migration evento_online_bookable : un evento réservable qui occupe la ressource
      -- (evento_occupies_resource) suit désormais exactement le même chemin qu'un camp — traité
      -- comme un camp d'un seul jour (coalesce(duration_days, 1) — toujours NULL pour un evento,
      -- jamais pour un camp).
      if v_line_type = 'camp'
         or (v_line_type = 'evento' and v_products_online_bookable[v_line_idx] and v_products_evento_occupies_resource[v_line_idx])
      then
        update public.provider_resource_calendar
           set booked = booked + v_line_qty
         where establishment_id = v_line_establishment_id
           and slot_date between (v_line->>'date')::date
                              and (v_line->>'date')::date + coalesce(v_line_duration_days, 1) - 1;

        insert into public.availability_blocks (
          establishment_id, start_date, end_date, source_order_line_id
        )
        values (
          v_line_establishment_id,
          (v_line->>'date')::date,
          (v_line->>'date')::date + coalesce(v_line_duration_days, 1) - 1,
          v_order_line_id
        );

        -- Spec 23 Tranche 2 (docs/specs/23-notifications-email-transactionnelles.md §4/§10 point 3)
        -- — notification prestataire "blocage camp/evento". Branchée ICI (create_order), pas
        -- apply_payment_webhook : le blocage ci-dessus est déjà effectif à cet instant précis,
        -- avant tout paiement (comportement existant, inchangé par cette spec) — le cahier des
        -- charges décrit la notification comme liée au moment où le blocage devient effectif, pas
        -- à la confirmation du paiement (docs/02-cahier-des-charges-socio.md:409-412). Isolée PAR
        -- COMPTE (spec 23 §8.2, un partenaire peut avoir plusieurs comptes de connexion) et ne
        -- doit jamais faire échouer la réservation elle-même (spec 23 §8.1) — la RPC la plus
        -- centrale du système (tout panier, anon ou authentifié, y passe).
        -- Ajout de la migration 20260929112240 : le nom est échappé par xmltext() (natif
        -- depuis PostgreSQL 17 : & < > ", NULL → NULL) avant d'être interpolé dans le HTML.
        select p.name ->> 'es' into v_camp_product_name
          from public.products p where p.id = (v_line->>'product_id')::uuid;

        for v_camp_partner_account in
          select pa.id as account_id, au.email
            from public.partner_accounts pa
            join auth.users au on au.id = pa.id
           where pa.partner_id = v_line_partner_id
        loop
          begin
            perform public.enqueue_notification_email(
              'partner_camp_evento_blocked',
              v_camp_partner_account.email,
              v_camp_partner_account.account_id,
              'Reserva confirmada — recurso bloqueado',
              '<p>Se reservó "' || coalesce(xmltext(v_camp_product_name)::text, 'tu producto') || '".</p>'
                || '<p>Período bloqueado: ' || (v_line->>'date')::date
                || ' a ' || ((v_line->>'date')::date + coalesce(v_line_duration_days, 1) - 1) || '.</p>'
                || '<p>Otras actividades que comparten este recurso pueden haber quedado no disponibles durante ese período.</p>',
              'order_lines', v_order_line_id
            );
          exception
            when query_canceled then
              raise warning 'create_order: notification camp annulée (query_canceled) pour compte % — %', v_camp_partner_account.account_id, sqlerrm;
            when others then
              raise warning 'create_order: échec notification camp pour compte % — %', v_camp_partner_account.account_id, sqlerrm;
          end;
        end loop;
      end if;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'order_id', v_order_id);
end;
$function$;
