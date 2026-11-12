-- Une commande sans rien à payer en ligne envoie aussi sa confirmation au CLIENT (décision Jérôme du
-- 2026-11-12, « fais tout ce qu'il reste à faire »). Jusqu'ici, create_order envoyait l'e-mail de
-- réservation au prestataire dès la création d'une telle commande (20261112120000), mais rien au
-- client : notify_order_confirmed sort si la commande n'est pas payée, et une commande sans acompte
-- dû ne l'est jamais.
--
-- create_order est une RPC critique (CLAUDE.md §4.1) : corps repris de la définition VIVANTE
-- (pg_get_functiondef, règle supabase §7) avec UN remplacement compté — un bloc isolé qui appelle
-- notify_client_order_confirmed (20261112140000) à côté de l'e-mail prestataire, dans la même
-- condition (somme des acomptes = 0). Logique de capacité, ordre des verrous et squelette
-- anti-survente inchangés. Même signature : create or replace garde l'ACL.
--
-- Prouvé par lobby_apres_acompte_paiement.test.sql (C1b : evento gratuit → e-mail client à la
-- création ; C2b : commande mixte avec acompte → aucun e-mail client avant le paiement).

CREATE OR REPLACE FUNCTION public.create_order(p_holder_name text, p_holder_email text DEFAULT NULL::text, p_holder_phone text DEFAULT NULL::text, p_marketing_consent boolean DEFAULT false, p_client_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  -- Migration 20261014031656 (G8a) : « aujourd'hui » en Colombie, résolu une fois pour toutes les
  -- lignes — jamais current_date (le serveur tourne en UTC).
  v_today constant date := public.today_in_bogota();
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
  -- Migration 20261025140000 (spec 43) : le mode de prix de chaque ligne, relu UNE fois en Phase 1
  -- et seul lu ensuite (matérialisation, verrous, contrôle, écriture, instantané de la ligne).
  v_products_pricing_unit text[];
  -- Migration 20261024110000 (prix Lobby) : l'identifiant de chaque ligne de panier, dans l'ordre de
  -- v_lines (même ORDER BY), pour retrouver son devis ; puis, par ligne Lobby à prix dynamique, le
  -- devis retenu (ventilation et Σ des prix d'une unité).
  v_cart_item_ids uuid[];
  v_products_pms_dynamic boolean[];
  v_pms_quote_nightly jsonb[];
  v_pms_quote_unit_sum bigint[];
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
         ) order by created_at, id), '[]'::jsonb),
         -- Migration 20261024110000 : départage par id, aussi dans v_lines — les deux agrégats suivent
         -- exactement le même ordre (celui de cart_lines_availability), une égalité de created_at
         -- ne peut plus les désaligner.
         coalesce(array_agg(id order by created_at, id), array[]::uuid[])
    into v_lines, v_cart_item_ids
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
  -- 20261112120000 : la note au prestataire, 1 000 caractères au plus (orders_client_note_length).
  if char_length(btrim(p_client_note)) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'client_note_too_long');
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
      v_p_external_booking_url text;
      v_p_pms_dynamic boolean := false;
      v_p_pricing_unit text;
    begin
      -- Migration 20261025120000 : le plafond par ligne vient de public.product_qty_cap — NULL pour
      -- une activité, un logement ou un camp (seule la place restante borne).
      select type, coalesce(min_qty, 1), public.product_qty_cap(type, max_qty), price_tiers,
             sellable, price_cop, establishment_id, duration_days, partner_id,
             calendar_default_open, stay_rates, lobby_category_id,
             group_discount_threshold_qty, group_discount_pct,
             online_bookable, is_free, evento_capacity_mode, evento_payment_mode, evento_occupies_resource,
             external_booking_url, pricing_unit
        into v_product_type, v_min_qty, v_max_qty, v_price_tiers,
             v_p_sellable, v_p_price_cop, v_p_establishment_id, v_p_duration_days, v_p_partner_id,
             v_p_calendar_default_open, v_p_stay_rates, v_p_lobby_category_id,
             v_p_group_discount_threshold_qty, v_p_group_discount_pct,
             v_p_online_bookable, v_p_is_free, v_p_evento_capacity_mode, v_p_evento_payment_mode, v_p_evento_occupies_resource,
             v_p_external_booking_url, v_p_pricing_unit
        from public.products where id = (v_line->>'product_id')::uuid;
      if not found then
        return jsonb_build_object('ok', false, 'reason', 'product_not_found', 'line', v_line);
      end if;

      -- Migration 20261014031656 (G8b, arbitrage du 2026-10-14) : ce que la vitrine ne vend pas en
      -- ligne ne se commande pas. Même prédicat que resolverModoReserva et resolverUrlContacto
      -- (apps/web/lib/catalog/producto.ts) : un evento non réservable en ligne est informatif ; hors
      -- evento, une URL de réservation externe — ou un transport, dont le contact a toujours un
      -- repli — fait de la fiche une vitrine.
      if (v_product_type = 'evento' and not v_p_online_bookable)
         or (v_product_type <> 'evento' and (v_p_external_booking_url is not null or v_product_type = 'transport')) then
        return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
      end if;

      -- Migration 20261014031656 (G8a) : jamais une date passée — le début d'un séjour, la date d'une
      -- occurrence ou d'un créneau sinon. Le jour même reste ouvert.
      if (v_line->>'date')::date < v_today then
        return jsonb_build_object('ok', false, 'reason', 'date_in_past', 'line', v_line);
      end if;

      -- Migration 20261024130000 : le jour même, l'HEURE compte aussi. Un créneau (slot_start_time
      -- de la ligne) ou une occurrence d'evento (products.start_time) dont l'heure de début est
      -- déjà passée à Guatapé n'est plus réservable. Sans heure de début (activité à la journée,
      -- séjour), rien ne change : le jour même reste ouvert.
      if public.start_time_has_passed(
           (v_line->>'date')::date,
           coalesce(
             v_line_slot_start_time,
             case when v_product_type = 'evento' then
               (select p.start_time from public.products p where p.id = (v_line->>'product_id')::uuid)
             end
           )
         ) then
        return jsonb_build_object('ok', false, 'reason', 'start_time_passed', 'line', v_line);
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
      v_products_pricing_unit[v_line_idx] := v_p_pricing_unit;

      -- Ajout migration evento_online_bookable : défense en profondeur — une date hors calendrier
      -- d'occurrence de l'evento (jamais une vraie occurrence once/recurring) est refusée ici,
      -- avant tout verrou. Peu coûteux, complète (sans remplacer) la vérification calendar_open/
      -- capacity plus bas, qui reste la vraie barrière anti-survente. Scopé à online_bookable :
      -- un evento non activé n'a structurellement aucune occurrence exploitable par ce chemin
      -- (occurrence_type/occurrence_date jamais renseignés avant activation) — et depuis la
      -- migration 20261014031656, il est refusé plus haut (not_sellable).
      if v_product_type = 'evento' and v_p_online_bookable then
        -- Migration 20261014204354 : la ligne de l'evento sous verrou PARTAGÉ avant de lire ses
        -- occurrences. Un changement de date ou de récurrence (UPDATE, verrou exclusif) attend
        -- donc la fin de cette commande — et la trouve si elle orpheline une réservation —, ou
        -- cette commande attend la fin du changement et lit les nouvelles occurrences. Ordre
        -- global : produit, puis capacité (product_availability, ressource, créneaux).
        perform 1 from public.products where id = (v_line->>'product_id')::uuid for share;
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

      -- Migration 20261025140000 (spec 43) : une activité à l'heure se réserve TOUJOURS sur un
      -- créneau (heure de début fixe) — même sans aucune règle d'horaire, où elle n'en a aucun.
      if v_p_pricing_unit = 'per_hour' and v_line_slot_start_time is null then
        return jsonb_build_object('ok', false, 'reason', 'slot_required', 'line', v_line);
      end if;

      -- Ajout de la migration 20260929112240 : quantité ≥ 1 pour TOUT type, avant le
      -- branchement — la branche lodging n'avait aucune borne, et un min_qty produit ≤ 0
      -- n'abaisse jamais ce plancher.
      if v_line_qty < 1 then
        return jsonb_build_object('ok', false, 'reason', 'qty_below_minimum', 'line', v_line);
      end if;

      if v_product_type = 'lodging' then
        -- Migration 20261025120000 (décision Jérôme du 2026-10-25) : plus de plafond par ligne pour un
        -- logement, un client peut prendre tout ce qui reste. Bornent : la capacité de chaque nuit
        -- (product_availability, plus bas) ou le devis Lobby (min_available_cupos), et l'agrégat
        -- lodging_cap_exceeded. Pas de min_qty non plus (interdit en base :
        -- products_min_qty_not_lodging) — la vitrine réserve un logement à partir de 1.
        -- Migration 20261024110000 (prix Lobby) : un logement Lobby dont l'établissement vend au prix
        -- Lobby (interrupteur lobby_dynamic_pricing). Ses paliers ne facturent rien : no_matching_tier
        -- ne le concerne pas, son devis en tient lieu. (price_missing reste : un logement porte
        -- toujours price_cop, products_price_cop_required_unless_vitrine — le « desde » des cartes.)
        if v_p_lobby_category_id is not null then
          select coalesce(e.lobby_dynamic_pricing, false) into v_p_pms_dynamic
            from public.establishments e where e.id = v_p_establishment_id;
          v_p_pms_dynamic := coalesce(v_p_pms_dynamic, false);
        end if;
        v_products_pms_dynamic[v_line_idx] := v_p_pms_dynamic;
        -- Migration 20261014031656 (G17, arbitrage du 2026-10-14) : une quantité qu'aucun palier ne
        -- couvre est refusée, comme modify_order_line — jamais facturée au prix de base.
        if not v_p_pms_dynamic and v_price_tiers is not null and not exists (
          select 1 from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_line_qty between t.min_qty and t.max_qty
        ) then
          return jsonb_build_object('ok', false, 'reason', 'no_matching_tier', 'line', v_line);
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
        -- Migration 20261024110000 (prix Lobby) : le devis lu à chaud sur /pago (pms_cart_quotes),
        -- pour CETTE ligne de panier, aux mêmes produit et dates, complet, de moins de 15 min. La
        -- quantité ne dépasse pas les places que Lobby cotait (min_available_cupos) — sans verrou :
        -- la règle « en vol » et le verrou de catégorie restent ceux de hold_pms_nights (check-nights).
        if v_p_pms_dynamic then
          declare
            v_quote record;
            v_quote_found boolean;
            v_quote_unit_sum bigint;
          begin
            select q.nightly_unit_prices, q.min_available_cupos, q.quoted_at
              into v_quote
              from public.pms_cart_quotes q
             where q.cart_item_id = v_cart_item_ids[v_line_idx]
               and q.account_id = v_account_id
               and q.product_id = (v_line->>'product_id')::uuid
               and q.date = (v_line->>'date')::date
               and q.end_date = v_line_end_date;
            v_quote_found := found;
            if v_quote_found then
              v_quote_unit_sum := public.pms_quote_unit_sum(
                v_quote.nightly_unit_prices, (v_line->>'date')::date, v_line_end_date
              );
            end if;
            if not v_quote_found or v_quote_unit_sum is null then
              return jsonb_build_object('ok', false, 'reason', 'pms_quote_missing', 'line', v_line);
            end if;
            if v_quote.quoted_at < now() - interval '15 minutes' then
              return jsonb_build_object('ok', false, 'reason', 'pms_quote_expired', 'line', v_line);
            end if;
            if v_line_qty > v_quote.min_available_cupos then
              return jsonb_build_object('ok', false, 'reason', 'pms_capacity_exceeded', 'line', v_line);
            end if;
            v_pms_quote_nightly[v_line_idx] := v_quote.nightly_unit_prices;
            v_pms_quote_unit_sum[v_line_idx] := v_quote_unit_sum;
          end;
        end if;
        v_lodging_lines := v_lodging_lines + 1;
        v_lodging_units := v_lodging_units + v_line_qty;
      else
        v_prestation_lines := v_prestation_lines + 1;
        if v_line_qty < v_min_qty then
          return jsonb_build_object('ok', false, 'reason', 'qty_below_minimum', 'line', v_line);
        end if;
        -- Migration 20261025120000 : v_max_qty est NULL pour une activité ou un camp — seule la place
        -- restante (product_availability / créneau, plus bas) borne la ligne.
        if v_max_qty is not null and v_line_qty > v_max_qty then
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
  -- Migration 20261025140000 (spec 43) : TOUS les créneaux que la ligne consomme — le sien, ou les
  -- qty heures consécutives d'une activité à l'heure (order_line_slot_units, mode relu en Phase 1).
  select distinct p.id, (t.elem->>'date')::date, v.slot_start_time, v.slot_duration_minutes, v.capacity, 0
    from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
    join public.products p on p.id = (t.elem->>'product_id')::uuid
    cross join lateral public.order_line_slot_units(
      (t.elem->>'slot_start_time')::time, (t.elem->>'qty')::int, v_products_pricing_unit[t.ord::int]
    ) c
    cross join lateral public.expand_product_slots(p.id, (t.elem->>'date')::date) v
   where t.elem->>'slot_start_time' is not null
     and v.slot_start_time = c.slot_start_time
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
       -- Migration 20261025140000 (spec 43) : chaque créneau consommé, pas seulement le premier.
       select (t.elem->>'product_id')::uuid, (t.elem->>'date')::date, c.slot_start_time
         from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
         cross join lateral public.order_line_slot_units(
           (t.elem->>'slot_start_time')::time, (t.elem->>'qty')::int, v_products_pricing_unit[t.ord::int]
         ) c
        where t.elem->>'slot_start_time' is not null
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
      v_slot record;
      v_slot_duration int;
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

        -- Migration 20261025140000 (spec 43) : chaque créneau que la ligne consomme — le sien, ou
        -- ses qty heures consécutives. À l'heure, les qty créneaux doivent exister et durer 60 min ;
        -- moins de qty heures rendues = plage qui franchirait minuit.
        if v_products_pricing_unit[v_line_idx] = 'per_hour'
           and (select count(*) from public.order_line_slot_units(
                  v_line_slot_start_time, (v_line->>'qty')::int, 'per_hour')) <> (v_line->>'qty')::int then
          return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line);
        end if;
        for v_slot in
          select c.slot_start_time, c.units
            from public.order_line_slot_units(
              v_line_slot_start_time, (v_line->>'qty')::int, v_products_pricing_unit[v_line_idx]) c
           order by c.slot_start_time
        loop
          select capacity, booked, slot_duration_minutes into v_capacity, v_booked, v_slot_duration
            from public.product_slot_availability
           where product_id = (v_line->>'product_id')::uuid
             and slot_date = (v_line->>'date')::date
             and slot_start_time = v_slot.slot_start_time;
          if not found
             or (v_products_pricing_unit[v_line_idx] = 'per_hour' and v_slot_duration <> 60) then
            return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line);
          end if;

          -- Ce que TOUTES les lignes du panier prennent sur CE créneau : deux plages qui se
          -- chevauchent s'additionnent, pas seulement les lignes qui y commencent.
          if v_booked + (
            select coalesce(sum(c2.units), 0)
              from jsonb_array_elements(v_lines) with ordinality as l(elem, ord)
              cross join lateral public.order_line_slot_units(
                (l.elem->>'slot_start_time')::time, (l.elem->>'qty')::int, v_products_pricing_unit[l.ord::int]
              ) c2
             where (l.elem->>'product_id')::uuid = (v_line->>'product_id')::uuid
               and (l.elem->>'date')::date = (v_line->>'date')::date
               and c2.slot_start_time = v_slot.slot_start_time
          ) > v_capacity then
            return jsonb_build_object('ok', false, 'reason', 'full', 'line', v_line);
          end if;
        end loop;

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
    referrer_partner_id, attribution_code, attribution_source, client_note
  )
  values (
    v_account_id, p_holder_name, p_holder_email, p_holder_phone, p_marketing_consent,
    v_referrer_partner_id, v_attribution_code, v_attribution_source, nullif(btrim(p_client_note), '')
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
    begin
      if v_line_end_date is not null then
        v_line_partner_id := v_products_partner_id[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_stay_rates := v_products_stay_rates[v_line_idx];
        -- Migration 20261024110000 (prix Lobby) : la ligne à prix dynamique est facturée au devis —
        -- Σ des prix d'une unité, nuit par nuit —, jamais au prix fixe hifago.
        if coalesce(v_products_pms_dynamic[v_line_idx], false) then
          v_sum_nightly := v_pms_quote_unit_sum[v_line_idx];
        else
          select public.resolve_tier_price(v_line_price_tiers, v_line_price_cop, v_line_qty) into v_tier_price;

          v_nights := v_line_end_date - (v_line->>'date')::date;
          v_sum_nightly := 0;
          for v_gs in 0..(v_nights - 1) loop
            v_night := (v_line->>'date')::date + v_gs;
            v_sum_nightly := v_sum_nightly + public.resolve_date_price((v_line->>'product_id')::uuid, v_night, v_tier_price, v_stay_rates);
          end loop;
        end if;
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

        -- Migration 20261025140000 (spec 43) : units sur chaque créneau consommé.
        update public.product_slot_availability psa
           set booked = psa.booked + c.units
          from public.order_line_slot_units(
            v_line_slot_start_time, v_line_qty, v_products_pricing_unit[v_line_idx]) c
         where psa.product_id = (v_line->>'product_id')::uuid
           and psa.slot_date = (v_line->>'date')::date
           and psa.slot_start_time = c.slot_start_time;

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
        v_commission_case := 'self_referral'; v_referrer_pct := 0;    v_app_pct := 0.09;
      else
        v_commission_case := 'external_referrer'; v_referrer_pct := 0.08; v_app_pct := 0.09;
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
        order_id, account_id, product_id, date, end_date, slot_start_time, qty, pricing_unit,
        referrer_partner_id, holder_name, holder_phone, holder_email, price_cop, total_cop,
        commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop,
        app_commission_cop, pms_nightly_unit_prices
      )
      values (
        v_order_id, v_account_id, (v_line->>'product_id')::uuid, (v_line->>'date')::date,
        v_line_end_date, v_line_slot_start_time, v_line_qty,
        -- Migration 20261025140000 (spec 43) : instantané du mode, lu par la libération et l'affichage.
        case when v_products_type[v_line_idx] = 'activity' then v_products_pricing_unit[v_line_idx] end,
        v_referrer_partner_id, p_holder_name, p_holder_phone, p_holder_email,
        v_line_price_cop, v_total_cop, v_commission_case, v_acompte_pct, v_referrer_pct, v_app_pct,
        round(v_total_cop * v_acompte_pct), round(v_total_cop * v_referrer_pct), round(v_total_cop * v_app_pct),
        v_pms_quote_nightly[v_line_idx]
      )
      returning id into v_order_line_id;

      -- Ajout migration evento_online_bookable : gardé sur le MONTANT réellement calculé (pas
      -- seulement v_referrer_pct > 0) — sans ça, un evento gratuit (v_total_cop = 0, referrer_pct
      -- resté à 0.08 non modifié ci-dessus) violerait quand même ledger_entries_amount_cop_check
      -- (amount_cop > 0) : round(0 * 0.08) = 0.
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

        -- Migration 20261023120000 (Lobby après l'acompte) : aucun e-mail d'ici, avant tout paiement.
        -- Le blocage, lui, reste posé ici, inchangé. Le prestataire l'apprend par l'e-mail de
        -- réservation (notify_partner_order_confirmed, 20261112120000 — l'ex-e-mail 8 y est fondu),
        -- à la confirmation ou plus bas quand rien n'est dû en ligne.
      end if;
    end;
  end loop;

  -- Migration 20261023120000 : rien à payer en ligne (evento gratuit ou payable sur place, seul ou avec
  -- d'autres lignes sans acompte) — la réservation est ferme dès maintenant, l'e-mail de réservation
  -- au prestataire part ici (20261112120000 : il remplace l'e-mail 8). Sinon il attend la
  -- confirmation du paiement (et du booking Lobby). Isolé (spec 23 §8.1) : un échec de notification
  -- ne fait jamais échouer la commande.
  if (select coalesce(sum(ol.acompte_cop), 0) from public.order_lines ol where ol.order_id = v_order_id) = 0 then
    begin
      perform public.notify_partner_order_confirmed(v_order_id);
    exception
      when query_canceled then
        raise warning 'create_order: notification prestataire annulée (query_canceled) pour commande % — %', v_order_id, sqlerrm;
      when others then
        raise warning 'create_order: échec notification prestataire pour commande % — %', v_order_id, sqlerrm;
    end;
    -- 20261112160000 : le client reçoit aussi sa confirmation dès la création (avant : rien, alors que
    -- le prestataire recevait la sienne). Même e-mail que pour une commande payée, phrase d'accueil
    -- « sin pago pendiente ». Isolé de même : un échec ne fait jamais échouer la commande.
    begin
      perform public.notify_client_order_confirmed(v_order_id);
    exception
      when query_canceled then
        raise warning 'create_order: notification client annulée (query_canceled) pour commande % — %', v_order_id, sqlerrm;
      when others then
        raise warning 'create_order: échec notification client pour commande % — %', v_order_id, sqlerrm;
    end;
  end if;

  return jsonb_build_object('ok', true, 'order_id', v_order_id);
end;
$function$;
