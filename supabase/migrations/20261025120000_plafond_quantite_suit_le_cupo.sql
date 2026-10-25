-- Le plafond de quantité suit le cupo (décision Jérôme du 2026-10-25).
--
-- « S'il y a un cupo diario et qu'il peut être réservé en une fois, on s'en fout. » Un produit qui
-- a un cupo — activité, logement, camp — n'a plus de MAXIMUM PAR RÉSERVATION : un client peut
-- prendre tout ce qui reste, la place restante (product_availability, créneau, nuits, devis Lobby)
-- est la seule borne. Jusqu'ici `coalesce(max_qty, 20)` refusait par exemple un groupe de 25 sur
-- une activité à 30 places, alors que personne n'avait rien saisi.
--
-- Le maximum ne reste que là où rien d'autre ne borne :
--   - l'evento : ses modes « unlimited » / « rsvp » n'ont aucun cupo, le repli 20 est leur seul
--     garde-fou par ligne ;
--   - le transport : sans cupo, non vendu en ligne — max_qty y sert au filtre « personas » de
--     search_catalog et aux commandes manuelles.
-- Le MINIMUM (min_qty) n'a jamais été vérifié pour un logement (create_order ne le lit que hors
-- lodging, la vitrine fixe 1) : le champ était trompeur, il est interdit en base pour ce type. Il
-- reste pour l'activité (taille de groupe minimale par réservation) et le transport.
--
-- Miroir TypeScript : packages/domain/src/products/qtyBounds.ts (perReservationQtyCap, même liste
-- de types, même repli 20). Les quatre fonctions qui bornaient la quantité par ligne lisent
-- désormais public.product_qty_cap au lieu de répéter `coalesce(max_qty, 20)` :
-- create_order, cart_lines_availability, create_manual_order_line, modify_order_line — définitions
-- vivantes extraites par pg_get_functiondef, remplacements comptés (.claude/rules/supabase.md §7).
-- Aucune ligne de verrouillage ni de décrément n'est touchée : la capacité reste contrôlée sous
-- `for update` exactement comme avant ; seul un refus (`qty_cap_exceeded`) disparaît pour ces types.
--
-- search_catalog n'est PAS modifiée : pour une activité ou un camp, `p.max_qty is null` laisse passer
-- le filtre « personas », comme pour les 17 activités sur 20 qui n'avaient déjà aucun maximum. Le
-- remplacer par default_capacity aurait été faux : le cupo compte parfois des jet-skis ou des heures,
-- pas des personnes.

-- 1. La règle, une seule fois côté SQL. IMMUTABLE : ne lit aucune table. Appelée uniquement depuis
--    des fonctions SECURITY DEFINER (exécutées par leur propriétaire) — fermée à tous les rôles
--    clients, comme toute fonction neuve doit l'être (PUBLIC reçoit EXECUTE par défaut).
create or replace function public.product_qty_cap(p_type text, p_max_qty int)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type in ('activity', 'lodging', 'camp') then null
    else coalesce(p_max_qty, 20)
  end
$$;

comment on function public.product_qty_cap(text, int) is
  'Plafond de quantité PAR LIGNE de commande, ou NULL quand seule la place restante borne (activité, logement, camp). Miroir : packages/domain/src/products/qtyBounds.ts.';

revoke all on function public.product_qty_cap(text, int) from public, anon, authenticated;

-- 2. Les valeurs déjà saisies, effacées AVANT les contraintes (idempotent : une seconde exécution
--    ne trouve plus rien). En local : 3 activités (1, 10, 10) et 1 logement (20) — chaque fois un
--    cupo ou un créneau bornait déjà plus bas, aucune réservation possible ne change.
update public.products
   set max_qty = null
 where type in ('activity', 'lodging', 'camp')
   and max_qty is not null;

update public.products
   set min_qty = null
 where type = 'lodging'
   and min_qty is not null;

-- Les propositions de partenaires EN ATTENTE portent leurs colonnes dans `payload` :
-- create_product_from_proposal / moderate_product_proposal les recopient telles quelles, donc une
-- clé restée là ferait échouer l'approbation sur les contraintes ci-dessous. Clé absente = NULL
-- (`nullif(payload ->> 'max_qty', '')::int`). Le type vient de la proposition (kind 'create') ou du
-- produit visé (kind 'content').
update public.product_proposals pp
   set payload = pp.payload - 'max_qty'
 where pp.status = 'pending'
   and pp.payload ? 'max_qty'
   and coalesce(pp.type, (select p.type from public.products p where p.id = pp.product_id))
       in ('activity', 'lodging', 'camp');

update public.product_proposals pp
   set payload = pp.payload - 'min_qty'
 where pp.status = 'pending'
   and pp.payload ? 'min_qty'
   and coalesce(pp.type, (select p.type from public.products p where p.id = pp.product_id)) = 'lodging';

-- 3. La règle, vérifiée par la base (CLAUDE.md §11.20) : l'écran ne montre plus ces champs pour ces
--    types, et rien d'autre (proposition, mockData, SQL à la main) ne peut les réintroduire.
alter table public.products
  add constraint products_max_qty_only_without_cupo
    check (max_qty is null or type not in ('activity', 'lodging', 'camp')),
  add constraint products_min_qty_not_lodging
    check (min_qty is null or type <> 'lodging');

-- Un CHANGEMENT DE TYPE efface ce que le nouveau type n'accepte plus — exactement ce que
-- admin_update_product_inline fait déjà, colonne par colonne, pour les autres contraintes propres à
-- un type (products_*_evento_only, products_transport_info_transport_only…). Un déclencheur plutôt
-- qu'une ligne de plus dans cette fonction : elle est redéfinie le même jour par la migration
-- 20261025100000 (étiquette principale), et le déclencheur couvre aussi tout futur chemin qui
-- changerait le type. Seulement sur un changement de type : une insertion ou une mise à jour de
-- max_qty/min_qty interdite reste REFUSÉE par les contraintes, jamais corrigée en silence.
create or replace function public.products_qty_bounds_follow_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type in ('activity', 'lodging', 'camp') then
    new.max_qty := null;
  end if;
  if new.type = 'lodging' then
    new.min_qty := null;
  end if;
  return new;
end;
$$;

revoke all on function public.products_qty_bounds_follow_type() from public, anon, authenticated;

create trigger products_qty_bounds_follow_type
  before update of type on public.products
  for each row
  when (old.type is distinct from new.type)
  execute function public.products_qty_bounds_follow_type();

-- 4. Les quatre fonctions qui bornaient la quantité par ligne.

CREATE OR REPLACE FUNCTION public.create_order(p_holder_name text, p_holder_email text DEFAULT NULL::text, p_holder_phone text DEFAULT NULL::text, p_marketing_consent boolean DEFAULT false)
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
    begin
      -- Migration 20261025120000 : le plafond par ligne vient de public.product_qty_cap — NULL pour
      -- une activité, un logement ou un camp (seule la place restante borne).
      select type, coalesce(min_qty, 1), public.product_qty_cap(type, max_qty), price_tiers,
             sellable, price_cop, establishment_id, duration_days, partner_id,
             calendar_default_open, stay_rates, lobby_category_id,
             group_discount_threshold_qty, group_discount_pct,
             online_bookable, is_free, evento_capacity_mode, evento_payment_mode, evento_occupies_resource,
             external_booking_url
        into v_product_type, v_min_qty, v_max_qty, v_price_tiers,
             v_p_sellable, v_p_price_cop, v_p_establishment_id, v_p_duration_days, v_p_partner_id,
             v_p_calendar_default_open, v_p_stay_rates, v_p_lobby_category_id,
             v_p_group_discount_threshold_qty, v_p_group_discount_pct,
             v_p_online_bookable, v_p_is_free, v_p_evento_capacity_mode, v_p_evento_payment_mode, v_p_evento_occupies_resource,
             v_p_external_booking_url
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
        order_id, account_id, product_id, date, end_date, slot_start_time, qty,
        referrer_partner_id, holder_name, holder_phone, holder_email, price_cop, total_cop,
        commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop,
        app_commission_cop, pms_nightly_unit_prices
      )
      values (
        v_order_id, v_account_id, (v_line->>'product_id')::uuid, (v_line->>'date')::date,
        v_line_end_date, v_line_slot_start_time, v_line_qty,
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

        -- Migration 20261023120000 (Lobby après l'acompte) : l'e-mail 8 « Reserva confirmada — recurso
        -- bloqueado » (spec 23 §10 point 3) ne part plus d'ici, avant tout paiement — il annonçait une
        -- réservation confirmée pour une commande peut-être jamais payée. Le blocage, lui, reste posé
        -- ici, inchangé. L'e-mail part à la confirmation (notify_order_confirmed : webhook, ou booking
        -- Lobby obtenu), ou plus bas quand rien n'est dû en ligne — même corps, même destinataire,
        -- même dédoublonnage (notify_partner_camp_evento_blocked).
      end if;
    end;
  end loop;

  -- Migration 20261023120000 : rien à payer en ligne (evento gratuit ou payable sur place, seul ou avec
  -- d'autres lignes sans acompte) — la réservation est ferme dès maintenant, l'e-mail 8 part ici.
  -- Sinon il attend la confirmation du paiement (et du booking Lobby). Isolé (spec 23 §8.1) : un
  -- échec de notification ne fait jamais échouer la commande.
  if (select coalesce(sum(ol.acompte_cop), 0) from public.order_lines ol where ol.order_id = v_order_id) = 0 then
    begin
      perform public.notify_partner_camp_evento_blocked(v_order_id);
    exception
      when query_canceled then
        raise warning 'create_order: notification camp annulée (query_canceled) pour commande % — %', v_order_id, sqlerrm;
      when others then
        raise warning 'create_order: échec notification camp pour commande % — %', v_order_id, sqlerrm;
    end;
  end if;

  return jsonb_build_object('ok', true, 'order_id', v_order_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cart_lines_availability()
 RETURNS TABLE(id uuid, available boolean, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      -- Migration 20261024110000 (prix Lobby), comme create_order.
      v_pms_dynamic boolean := false;
      v_quote record;
      v_quote_found boolean;
    begin
      select p.type, coalesce(p.min_qty, 1) as min_qty, public.product_qty_cap(p.type, p.max_qty) as max_qty, p.price_tiers,
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
      -- Migration 20261024130000 : même garde que create_order, au même endroit de la phase 1.
      if public.start_time_has_passed(
           v_date,
           coalesce(
             v_slot_start_time,
             case when v_p.type = 'evento' then
               (select p.start_time from public.products p where p.id = v_product_id)
             end
           )
         ) then
        v_reason := 'start_time_passed';
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
        -- Migration 20261025120000 : plus de plafond par ligne pour un logement, comme create_order.
        if v_p.lobby_category_id is not null then
          select coalesce(e.lobby_dynamic_pricing, false) into v_pms_dynamic
            from public.establishments e where e.id = v_p.establishment_id;
          v_pms_dynamic := coalesce(v_pms_dynamic, false);
        end if;
        if not v_pms_dynamic and v_price_tiers is not null and not exists (
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
        -- Le devis de create_order (migration 20261024110000) : même lecture, mêmes raisons. Sur
        -- /mi-viaje, aucun devis n'est encore pris — getCartLines y lit pms_quote_missing et
        -- pms_quote_expired comme « prix confirmé au paiement », jamais comme une indisponibilité.
        if v_pms_dynamic then
          select q.nightly_unit_prices, q.min_available_cupos, q.quoted_at
            into v_quote
            from public.pms_cart_quotes q
           where q.cart_item_id = (v_line->>'id')::uuid
             and q.account_id = v_account_id
             and q.product_id = v_product_id
             and q.date = v_date
             and q.end_date = v_end_date;
          v_quote_found := found;
          if not v_quote_found
             or public.pms_quote_unit_sum(v_quote.nightly_unit_prices, v_date, v_end_date) is null then
            v_reason := 'pms_quote_missing';
            exit line_checks;
          end if;
          if v_quote.quoted_at < now() - interval '15 minutes' then
            v_reason := 'pms_quote_expired';
            exit line_checks;
          end if;
          if v_qty > v_quote.min_available_cupos then
            v_reason := 'pms_capacity_exceeded';
            exit line_checks;
          end if;
        end if;
      else
        if v_qty < v_p.min_qty then
          v_reason := 'qty_below_minimum';
          exit line_checks;
        end if;
        -- Migration 20261025120000 : max_qty NULL pour une activité ou un camp, comme create_order.
        if v_p.max_qty is not null and v_qty > v_p.max_qty then
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
$function$;

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
  -- Migration 20261014204354 : tout evento sous verrou PARTAGÉ, comme create_order, et
  -- online_bookable relu sous ce verrou — un changement de date ou une activation de la vente en
  -- ligne concurrents sont attendus puis lus, ou attendent cette ligne et la trouvent.
  if v_product_type = 'evento' then
    select online_bookable into v_online_bookable
      from public.products where id = p_product_id for share;
    if v_online_bookable and not exists (
      select 1 from public.expand_event_occurrences(p_product_id, p_date, p_date)
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_occurrence_date');
    end if;
  end if;

  if p_qty < coalesce(v_min_qty, 1) then
    return jsonb_build_object('ok', false, 'reason', 'qty_below_minimum');
  end if;
  -- Migration 20261025120000 : public.product_qty_cap — NULL (aucun plafond, seule la place restante
  -- borne) pour une activité, un logement ou un camp.
  if public.product_qty_cap(v_product_type, v_max_qty) is not null
     and p_qty > public.product_qty_cap(v_product_type, v_max_qty) then
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
  v_online_bookable boolean;
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
  -- (enqueue_pms_cancellations). Un produit à catégorie LobbyPMS (aujourd'hui, des logements) : sa
  -- ligne à plage n'a jamais pris de capacité locale (release_order_line_capacity n'a rien à lui
  -- rendre) ; LobbyPMS est sa seule disponibilité.
  if v_old_line.pms_booking_id is not null or exists (
    select 1 from public.products p where p.id = v_old_line.product_id and p.lobby_category_id is not null
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

    -- Migration 20261025120000 : plus de plafond par ligne pour un logement (v_bound_max_qty est
    -- toujours NULL, products_max_qty_only_without_cupo) — la capacité des nuits, contrôlée plus
    -- bas, est la seule borne, comme dans create_order.
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
    -- Migration 20261025120000 : public.product_qty_cap — NULL pour une activité (et un camp, refusé
    -- plus haut) : seul le plancher reste, la capacité du jour borne le haut.
    if p_new_qty < coalesce(v_product.min_qty, 1)
       or (public.product_qty_cap(v_product.type, v_product.max_qty) is not null
           and p_new_qty > public.product_qty_cap(v_product.type, v_product.max_qty)) then
      raise exception 'quantité % hors bornes [%, %] pour ce produit', p_new_qty, coalesce(v_product.min_qty, 1),
        coalesce(public.product_qty_cap(v_product.type, v_product.max_qty)::text, 'sans plafond');
    end if;

    v_same_slot := (v_old_line.date = p_new_date);

    -- Migration 20261014211700 : la ligne d'un evento tenue à ses dates — evento vendu en ligne, ou ligne
    -- vendue en ligne (même règle que products_occurrence_change_guard, 20261014204354) — ne se
    -- déplace que sur une occurrence. Lue sous verrou PARTAGÉ de l'evento, avant tout verrou de
    -- capacité (ordre global produit → capacité) : un changement de date concurrent est attendu
    -- puis lu, ou attend cette ligne et la trouve. Rien n'est encore écrit.
    if v_product.type = 'evento' and not v_same_slot then
      select online_bookable into v_online_bookable
        from public.products where id = v_old_line.product_id for share;
      if (v_online_bookable or v_old_line.commission_case <> 'operator_manual') and not exists (
        select 1 from public.expand_event_occurrences(v_old_line.product_id, p_new_date, p_new_date)
      ) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_occurrence_date');
      end if;
    end if;

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
