-- Activité : prix par personne, par heure ou par activité complète (spec 43, demande de Jérôme du
-- 2026-10-25 — un bateau de wakeboard à 420 000 COP de l'heure, 1 à 10 personnes).
--
-- Jusqu'ici une activité valait toujours « prix × quantité » et la quantité décomptait le cupo du
-- jour ou du créneau, sans que rien ne dise si elle comptait des personnes ou des heures. Trois
-- décisions de Jérôme (2026-10-25) :
--   1. le nombre de personnes est une simple MENTION (min_persons / max_persons), jamais saisi par
--      le client ni vérifié ici ;
--   2. à l'heure, l'heure de début est FIXE et deux réservations ne se chevauchent jamais ;
--   3. les activités existantes restent « por persona » (ce qu'elles facturent déjà).
--
-- Le point 2 réutilise les créneaux (spec 18) plutôt qu'une capacité nouvelle : une activité à
-- l'heure a des horaires d'une heure, la capacité d'un créneau est le nombre de bateaux, et une
-- ligne de qty heures à partir de S consomme 1 place sur chacun des créneaux S, S+1h, …, S+(qty-1)h.
-- Verrous, grille de fermeture admin/partenaire, agenda et libération centralisée restent ceux
-- d'aujourd'hui ; seule change la liste des créneaux qu'une ligne touche, définie UNE fois par
-- public.order_line_slot_units. Le minimum d'heures par réservation est min_qty ; aucun maximum
-- (20261025120000 : une activité n'a plus de plafond par ligne, la place restante borne).
--
-- Construit PAR-DESSUS 20261025100000 (étiquette principale) et 20261025120000 (plafond = cupo),
-- appliquées avant : les corps redéfinis plus bas sont leurs définitions vivantes
-- (pg_get_functiondef), modifiées par remplacements comptés (.claude/rules/supabase.md §7).
--
-- Frontière RLS / RPC-only (CLAUDE.md §3) : aucune table ni policy nouvelle. Trois colonnes sur
-- products (RLS directe inchangée : admin), une sur order_lines (écrite par les seules RPC). RPC
-- critiques touchées (§4) : create_order, create_manual_order_line — même squelette, mêmes verrous
-- triés (produit, date, heure) ; prouvé sous concurrence réelle par
-- tests/concurrency/create_order_per_hour.concurrency.mjs.

-- ================================================================================================
-- 1. Colonnes
-- ================================================================================================

alter table public.products
  add column pricing_unit text not null default 'per_person',
  add column min_persons int,
  add column max_persons int;

alter table public.products
  add constraint products_pricing_unit_valid
    check (pricing_unit in ('per_person', 'per_hour', 'per_activity')),
  -- Seule une activité choisit son mode ; tout autre type reste « per_person », valeur sans effet
  -- pour lui (create_order ne lit le mode que pour poser l'instantané d'une ligne d'activité).
  add constraint products_pricing_unit_activity_only
    check (pricing_unit = 'per_person' or type = 'activity'),
  add constraint products_persons_positive
    check ((min_persons is null or min_persons >= 1) and (max_persons is null or max_persons >= 1)),
  add constraint products_persons_order
    check (min_persons is null or max_persons is null or min_persons <= max_persons);

comment on column public.products.pricing_unit is
  'Activité seulement : ce que compte qty — per_person (personnes), per_hour (heures consécutives sur des créneaux d''1 h), per_activity (activités entières). Spec 43.';
comment on column public.products.min_persons is
  'Nombre minimum de personnes annoncé sur la fiche. Informatif : jamais saisi par le client ni vérifié par create_order (décision de Jérôme du 2026-10-25).';
comment on column public.products.max_persons is
  'Nombre maximum de personnes annoncé sur la fiche. Informatif (cf. min_persons).';

alter table public.order_lines
  add column pricing_unit text,
  add constraint order_lines_pricing_unit_valid
    check (pricing_unit is null or pricing_unit in ('per_person', 'per_hour', 'per_activity'));

comment on column public.order_lines.pricing_unit is
  'Instantané de products.pricing_unit pour une ligne d''activité (null sinon, et pour les lignes antérieures à la spec 43). Lu par release_order_line_capacity, lock_order_capacity_rows et l''affichage.';

-- qty_unit ('qty' | 'hours') existe depuis le schéma d'origine et n'a jamais été lue : 6 activités
-- héritées du legacy la portaient à 'hours' (cours, heures de studio — liste au journal du
-- 2026-10-25), sans aucun effet sur leur prix. pricing_unit la remplace ; la garder laisserait deux
-- colonnes dire la même chose, dont une fausse.
alter table public.products drop column qty_unit;

-- ================================================================================================
-- 2. Les créneaux qu'une ligne consomme — UNE définition
-- ================================================================================================
-- Une ligne sans créneau : rien. per_hour : 1 place sur chacune des qty heures consécutives, jamais
-- au-delà de minuit (time + interval reboucle : 23:00 + 2 h rendrait 00:00 du MÊME jour) — un
-- appelant qui obtient moins de qty lignes sait que la plage sort de la journée. Sinon : qty places
-- sur le seul créneau de départ, exactement le comportement d'avant cette migration.
create function public.order_line_slot_units(p_slot_start_time time, p_qty int, p_pricing_unit text)
returns table (slot_start_time time, units int)
language sql
immutable
set search_path = ''
as $$
  select p_slot_start_time + make_interval(hours => gs.h), 1
    from generate_series(0, p_qty - 1) as gs(h)
   where p_pricing_unit = 'per_hour'
     and p_slot_start_time is not null
     and extract(epoch from p_slot_start_time) + (gs.h + 1) * 3600 <= 86400
  union all
  select p_slot_start_time, p_qty
   where p_pricing_unit is distinct from 'per_hour'
     and p_slot_start_time is not null
$$;

comment on function public.order_line_slot_units(time, int, text) is
  'Créneaux consommés par une ligne et places prises sur chacun. Seule définition : create_order, cart_lines_availability, create_manual_order_line, release_order_line_capacity, lock_order_capacity_rows. Spec 43.';

revoke all on function public.order_line_slot_units(time, int, text) from public, anon, authenticated;

-- ================================================================================================
-- 3. Le mode suit le type ; à l'heure, des horaires d'une heure
-- ================================================================================================
-- Quitter le type activité remet le mode à per_person (même geste que products_qty_bounds_follow_type
-- pour max_qty) : sans lui, admin_update_product_inline buterait sur
-- products_pricing_unit_activity_only. Passer à per_hour exige que toutes les règles d'horaire du
-- produit durent 60 minutes : une heure facturée = un créneau.
create function public.products_pricing_unit_follows_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type <> 'activity' then
    new.pricing_unit := 'per_person';
  end if;
  if new.pricing_unit = 'per_hour'
     and (tg_op = 'INSERT' or old.pricing_unit is distinct from 'per_hour')
     and exists (
       select 1 from public.product_slot_rules r
        where r.product_id = new.id and r.slot_duration_minutes <> 60
     ) then
    raise exception 'per_hour_requires_hourly_slots'
      using detail = 'Une activité à l''heure n''a que des horaires de 60 minutes : une heure facturée = un créneau.';
  end if;
  return new;
end;
$$;

revoke all on function public.products_pricing_unit_follows_type() from public, anon, authenticated;

create trigger products_pricing_unit_follows_type
  before insert or update of type, pricing_unit on public.products
  for each row
  execute function public.products_pricing_unit_follows_type();

create function public.product_slot_rules_hourly_for_per_hour()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.slot_duration_minutes <> 60 and exists (
    select 1 from public.products p where p.id = new.product_id and p.pricing_unit = 'per_hour'
  ) then
    raise exception 'per_hour_requires_hourly_slots'
      using detail = 'Une activité à l''heure n''a que des horaires de 60 minutes : une heure facturée = un créneau.';
  end if;
  return new;
end;
$$;

revoke all on function public.product_slot_rules_hourly_for_per_hour() from public, anon, authenticated;

create trigger product_slot_rules_hourly_for_per_hour
  before insert or update of slot_duration_minutes, product_id on public.product_slot_rules
  for each row
  execute function public.product_slot_rules_hourly_for_per_hour();

-- ================================================================================================
-- 4. Gel du mode tant qu'une réservation est en cours
-- ================================================================================================
-- products_capacity_flags_frozen (redéfinie plus bas) refuse aussi un changement de pricing_unit ;
-- son déclencheur doit donc écouter la colonne.
drop trigger products_capacity_flags_frozen on public.products;
create trigger products_capacity_flags_frozen
  before update of lobby_category_id, evento_capacity_mode, evento_occupies_resource, pricing_unit
  on public.products
  for each row
  execute function public.products_capacity_flags_frozen();

-- ================================================================================================
-- 5. Fonctions redéfinies — définitions vivantes, remplacements comptés
-- ================================================================================================

-- ── create_order ──────────────────────────────────────────────────────────────────────────────

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

-- ── cart_lines_availability ───────────────────────────────────────────────────────────────────

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
  -- Migration 20261025140000 (spec 43) : comme create_order.
  v_products_pricing_unit text[];
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
      v_pricing_unit text;
    begin
      select p.type, p.establishment_id, p.duration_days, p.online_bookable, p.evento_occupies_resource,
             p.pricing_unit
        into v_type, v_establishment_id, v_duration_days, v_online_bookable, v_occupies_resource,
             v_pricing_unit
        from public.products p
       where p.id = (v_line->>'product_id')::uuid;
      v_products_type[v_line_idx] := v_type;
      v_products_establishment_id[v_line_idx] := v_establishment_id;
      v_products_duration_days[v_line_idx] := v_duration_days;
      v_products_online_bookable[v_line_idx] := v_online_bookable;
      v_products_evento_occupies_resource[v_line_idx] := v_occupies_resource;
      v_products_pricing_unit[v_line_idx] := v_pricing_unit;
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
      v_slot record;
      v_slot_duration int;
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
      -- Migration 20261025140000 (spec 43) : même garde que create_order.
      if v_products_pricing_unit[v_line_idx] = 'per_hour' and v_slot_start_time is null then
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
        -- create_order matérialise d'abord les créneaux attendus (expand_product_slots, on conflict
        -- do nothing) : la ligne existante prime, sinon ce créneau, à booked 0.
        -- Migration 20261025140000 (spec 43) : chaque créneau que la ligne consomme, comme create_order.
        if v_products_pricing_unit[v_line_idx] = 'per_hour'
           and (select count(*) from public.order_line_slot_units(v_slot_start_time, v_qty, 'per_hour')) <> v_qty then
          v_reason := 'slot_not_found';
          exit line_checks;
        end if;
        for v_slot in
          select c.slot_start_time, c.units
            from public.order_line_slot_units(v_slot_start_time, v_qty, v_products_pricing_unit[v_line_idx]) c
           order by c.slot_start_time
        loop
          select psa.capacity, psa.booked, psa.slot_duration_minutes into v_capacity, v_booked, v_slot_duration
            from public.product_slot_availability psa
           where psa.product_id = v_product_id
             and psa.slot_date = v_date
             and psa.slot_start_time = v_slot.slot_start_time;
          if not found then
            select v.capacity, 0, v.slot_duration_minutes into v_capacity, v_booked, v_slot_duration
              from public.expand_product_slots(v_product_id, v_date) v
             where v.slot_start_time = v_slot.slot_start_time
             limit 1;
            if not found then
              v_reason := 'slot_not_found';
              exit line_checks;
            end if;
          end if;
          if v_products_pricing_unit[v_line_idx] = 'per_hour' and v_slot_duration <> 60 then
            v_reason := 'slot_not_found';
            exit line_checks;
          end if;
          if v_booked + (
            select coalesce(sum(c2.units), 0)
              from jsonb_array_elements(v_lines) with ordinality as l(elem, ord)
              cross join lateral public.order_line_slot_units(
                (l.elem->>'slot_start_time')::time, (l.elem->>'qty')::int, v_products_pricing_unit[l.ord::int]
              ) c2
             where (l.elem->>'product_id')::uuid = v_product_id
               and (l.elem->>'date')::date = v_date
               and c2.slot_start_time = v_slot.slot_start_time
          ) > v_capacity then
            v_reason := 'full';
            exit line_checks;
          end if;
        end loop;

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

-- ── create_manual_order_line ──────────────────────────────────────────────────────────────────

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
  -- Migration 20261025140000 (spec 43).
  v_pricing_unit text;
  v_slot record;
  v_slot_duration int;
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
         duration_days, online_bookable, is_free, evento_capacity_mode, evento_occupies_resource,
         pricing_unit
    into v_product_type, v_establishment_id, v_sellable, v_min_qty, v_max_qty, v_price_tiers,
         v_price_cop, v_default_capacity,
         v_duration_days, v_online_bookable, v_is_free, v_evento_capacity_mode, v_evento_occupies_resource,
         v_pricing_unit
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
  -- Migration 20261025140000 (spec 43) : comme create_order — une activité à l'heure se réserve sur
  -- un créneau, et ses qty heures doivent tenir dans la journée.
  if v_pricing_unit = 'per_hour' and p_slot_start_time is null then
    return jsonb_build_object('ok', false, 'reason', 'slot_required');
  end if;
  if v_pricing_unit = 'per_hour'
     and (select count(*) from public.order_line_slot_units(p_slot_start_time, p_qty, 'per_hour')) <> p_qty then
    return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
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
     -- Migration 20261025140000 (spec 43) : chaque créneau consommé.
     where v.slot_start_time in (
       select c.slot_start_time from public.order_line_slot_units(p_slot_start_time, p_qty, v_pricing_unit) c
     )
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
    -- Migration 20261025140000 (spec 43) : chaque créneau consommé, verrouillé dans l'ordre des
    -- heures (celui de create_order : produit, date, heure).
    for v_slot in
      select c.slot_start_time, c.units
        from public.order_line_slot_units(p_slot_start_time, p_qty, v_pricing_unit) c
       order by c.slot_start_time
    loop
      select capacity, booked, slot_duration_minutes into v_capacity, v_booked, v_slot_duration
        from public.product_slot_availability
       where product_id = p_product_id and slot_date = p_date and slot_start_time = v_slot.slot_start_time
       for update;
      if not found or (v_pricing_unit = 'per_hour' and v_slot_duration <> 60) then
        return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
      end if;
      if v_booked + v_slot.units > v_capacity then
        return jsonb_build_object('ok', false, 'reason', 'full', 'capacity', v_capacity, 'booked', v_booked);
      end if;
    end loop;
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
    update public.product_slot_availability psa
       set booked = psa.booked + c.units
      from public.order_line_slot_units(p_slot_start_time, p_qty, v_pricing_unit) c
     where psa.product_id = p_product_id and psa.slot_date = p_date
       and psa.slot_start_time = c.slot_start_time;
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
    order_id, account_id, product_id, date, slot_start_time, qty, pricing_unit, holder_name,
    holder_phone, holder_email,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop
  ) values (
    v_order_id, v_technical_account_id, p_product_id, p_date, p_slot_start_time,
    p_qty, case when v_product_type = 'activity' then v_pricing_unit end, p_holder_name, p_holder_phone, 'reserva-manual@hifago.local',
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

-- ── release_order_line_capacity ───────────────────────────────────────────────────────────────

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
  select ol.id, ol.product_id, ol.date, ol.end_date, ol.slot_start_time, ol.qty, ol.pricing_unit,
         p.lobby_category_id,
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
    -- Migration 20261025140000 (spec 43) : chaque créneau que la ligne a consommé, d'après SON
    -- instantané order_lines.pricing_unit — une ligne à l'heure rend 1 place sur chacune de ses heures.
    perform 1 from public.product_slot_availability psa
      join public.order_line_slot_units(v_line.slot_start_time, v_line.qty, v_line.pricing_unit) c
        on c.slot_start_time = psa.slot_start_time
      where psa.product_id = v_line.product_id and psa.slot_date = v_line.date
        and psa.booked < c.units;
    if found then
      raise warning 'release_order_line_capacity: booked < qty sur le créneau de la ligne %', p_line_id;
    end if;
    update public.product_slot_availability psa
       set booked = greatest(0, psa.booked - c.units)
      from public.order_line_slot_units(v_line.slot_start_time, v_line.qty, v_line.pricing_unit) c
     where psa.product_id = v_line.product_id and psa.slot_date = v_line.date
       and psa.slot_start_time = c.slot_start_time;
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

-- ── lock_order_capacity_rows ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.lock_order_capacity_rows(p_line_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row record;
begin
  -- Même ordre de tables que create_order (l.303-356) : product_availability →
  -- provider_resource_calendar → product_slot_availability, chaque ensemble trié.
  for v_row in
    select pa.product_id, pa.date
      from public.product_availability pa
     where (pa.product_id, pa.date) in (
       select ol.product_id, ol.date
         from public.order_lines ol
        where ol.id = any(p_line_ids) and ol.end_date is null and ol.slot_start_time is null
       union
       select ol.product_id, (ol.date + gs)::date
         from public.order_lines ol
         cross join lateral generate_series(0, (ol.end_date - ol.date) - 1) as gs
        where ol.id = any(p_line_ids) and ol.end_date is not null
     )
     order by pa.product_id, pa.date
     for update
  loop
    null;
  end loop;

  for v_row in
    select prc.establishment_id, prc.slot_date
      from public.provider_resource_calendar prc
     where (prc.establishment_id, prc.slot_date) in (
       select ab.establishment_id, (ab.start_date + gs)::date
         from public.availability_blocks ab
         cross join lateral generate_series(0, ab.end_date - ab.start_date) as gs
        where ab.source_order_line_id = any(p_line_ids)
     )
     order by prc.establishment_id, prc.slot_date
     for update
  loop
    null;
  end loop;

  for v_row in
    select psa.product_id, psa.slot_date, psa.slot_start_time
      from public.product_slot_availability psa
     where (psa.product_id, psa.slot_date, psa.slot_start_time) in (
       -- Migration 20261025140000 (spec 43) : chaque créneau consommé par la ligne.
       select ol.product_id, ol.date, c.slot_start_time
         from public.order_lines ol
         cross join lateral public.order_line_slot_units(ol.slot_start_time, ol.qty, ol.pricing_unit) c
        where ol.id = any(p_line_ids) and ol.slot_start_time is not null
     )
     order by psa.product_id, psa.slot_date, psa.slot_start_time
     for update
  loop
    null;
  end loop;
end;
$function$;

-- ── order_for_client_jsonb ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.order_for_client_jsonb(p_order orders)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Migration 20261023120000 (Lobby après l'acompte) : l'état de la réservation chez Lobby d'une commande
  -- PAYÉE dont une nuit PMS n'a pas encore son booking. 'pending' : demande en cours (ou pas encore
  -- posée) ; 'failed' : Lobby a refusé ou l'issue est inconnue, un humain la tient
  -- (pms_reconciliation_entries) ; null sinon. Une commande non payée n'est jamais 'pending'.
  with etat_pms as (
    select case
      when exists (select 1 from public.pms_booking_requests r
                    where r.order_id = (p_order).id and r.status in ('failed', 'needs_human'))
        then 'failed'
      when (p_order).payment_status in ('paid', 'partially_refunded')
           and exists (
             select 1 from public.order_lines ol
               join public.products p on p.id = ol.product_id
              where ol.order_id = (p_order).id
                and ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded')
                and ol.pms_booking_id is null
                and p.type = 'lodging' and p.lobby_category_id is not null)
           and not exists (select 1 from public.pms_booking_requests r
                            where r.order_id = (p_order).id and r.status <> 'pending')
        then 'pending'
    end as pms_confirmation
  ),
  lignes as (
    select
      jsonb_build_object(
        'id', ol.id,
        'product_name', p.name,
        'product_type', p.type,
        'product_slug', p.slug,
        'establishment_name', e.name,
        'establishment_slug', case when e.is_place then null else e.slug end,
        -- 20261019170000 (décision Jérôme) : le WhatsApp du prestataire n'apparaît JAMAIS avant
        -- que la réservation soit finalisée — ligne vivante, ET commande payée, OU rien n'y est dû
        -- en ligne (evento gratuit / payable sur place : l'état « confirmed » d'orderState.ts).
        -- Une commande « unpaid » avec un acompte dû, ou « pending », rend null.
        'establishment_contact_phone', case
          -- Migration 20261023120000 (D9) : jamais tant que Lobby n'a pas confirmé la commande entière
          -- (pms_confirmation 'pending' ou 'failed').
          when (select e2.pms_confirmation from etat_pms e2) is null
           and ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded')
           and ((p_order).payment_status in ('paid', 'partially_refunded')
                or ((p_order).payment_status = 'unpaid'
                    and not exists (
                      select 1 from public.order_lines due
                       where due.order_id = (p_order).id and due.acompte_cop > 0
                         and due.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded'))))
          then e.contact_phone
        end,
        'date', ol.date,
        'end_date', ol.end_date,
        -- `duration_days` — NUL pour tout ce qui n'est pas `camp` (contrainte
        -- `products_duration_days_required_for_camp`, 20260814220000). L'écran reconstitue la
        -- date de fin d'un camp à partir de `date` + cette valeur, jamais l'inverse.
        'duration_days', p.duration_days,
        'slot_start_time', ol.slot_start_time,
        'qty', ol.qty,
        -- Migration 20261025140000 (spec 43) : « 3 horas » plutôt qu'une quantité nue.
        'pricing_unit', ol.pricing_unit,
        'price_cop', ol.price_cop,
        'total_cop', ol.total_cop,
        'acompte_cop', ol.acompte_cop,
        'status', ol.status
      ) as ligne,
      ol.created_at as ligne_created_at,
      ol.id as ligne_id,
      ol.total_cop as ligne_total_cop,
      ol.acompte_cop as ligne_acompte_cop,
      (ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded'))
        as vivante
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
    left join public.establishments e on e.id = p.establishment_id
    where ol.order_id = (p_order).id
  )
  select jsonb_build_object(
    'id', (p_order).id,
    'reference', (p_order).reference,
    'payment_status', (p_order).payment_status,
    'created_at', (p_order).created_at,
    'holder_name', (p_order).holder_name,
    'holder_phone', (p_order).holder_phone,
    'holder_email', (p_order).holder_email,
    'total_cop', coalesce(sum(ligne_total_cop) filter (where vivante), 0),
    'acompte_cop', coalesce(sum(ligne_acompte_cop) filter (where vivante), 0),
    -- Spec 39 D3 (20260922100000) : le client a payé, rien n'est honoré — vrai tant qu'une entrée
    -- refund_required (payé après expiration/annulation, écart de montant ; nuit PMS sans booking,
    -- intent remplacé : migration 20261002185102) est ouverte. Un DOUBLE
    -- paiement n'y entre pas : sa réservation EST honorée, seul le doublon est remboursé.
    'payment_received_not_honored', exists (
      select 1 from public.payment_reconciliation_entries e
      join public.payments pay on pay.id = e.payment_id
      where pay.order_id = (p_order).id and e.kind = 'refund_required'
        and e.reason_code in ('paid_after_expiry', 'amount_mismatch', 'pms_booking_missing', 'superseded_intent')
        and e.status in ('open', 'retrying')
    ),
    -- Le dernier remboursement lié à ces mêmes entrées : pending → « en cours », approved → « te
    -- reembolsamos », rejected → l'admin reprend la main (le client reste sur « te contactamos »).
    'refund_status', (
      select r.status from public.payment_refunds r
      join public.payment_reconciliation_entries e on e.id = r.entry_id
      join public.payments pay on pay.id = e.payment_id
      where pay.order_id = (p_order).id
        and e.reason_code in ('paid_after_expiry', 'amount_mismatch', 'pms_booking_missing', 'superseded_intent')
      -- Par PRIORITÉ, pas par date : approved (l'argent est rendu) prime sur pending, qui prime
      -- sur rejected — plusieurs entrées peuvent viser la même commande.
      order by case r.status when 'approved' then 0 when 'pending' then 1 else 2 end, r.created_at desc
      limit 1
    ),
    -- Migration 20261023120000 : 'pending' | 'failed' | null (cf. etat_pms).
    'pms_confirmation', (select e2.pms_confirmation from etat_pms e2),
    -- Ordre INCHANGÉ (20260911100000) : les assertions pgTAP indexent `lines,0`.
    'lines', coalesce(jsonb_agg(ligne order by ligne_created_at, ligne_id), '[]'::jsonb)
  )
  from lignes;
$function$;

-- ── products_capacity_flags_frozen ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.products_capacity_flags_frozen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (new.lobby_category_id is distinct from old.lobby_category_id
      or new.evento_capacity_mode is distinct from old.evento_capacity_mode
      or new.evento_occupies_resource is distinct from old.evento_occupies_resource
      -- Migration 20261025140000 (spec 43) : le mode de prix change ce que compte qty et ce que
      -- consomme une ligne déjà vendue — jamais tant qu'une réservation est en cours.
      or new.pricing_unit is distinct from old.pricing_unit)
     and exists (
       select 1 from public.order_lines ol where ol.product_id = new.id and ol.status = 'reserved'
     ) then
    raise exception 'capacity_flags_frozen_while_reserved'
      using detail = 'Ce produit porte des réservations en cours : lobby_category_id, evento_capacity_mode, evento_occupies_resource et pricing_unit ne peuvent pas changer tant qu''elles ne sont pas réalisées ou annulées. La date et la récurrence d''un evento relèvent de products_occurrence_change_guard.';
  end if;
  return new;
end;
$function$;

-- ── submit_product_creation_proposal ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_product_creation_proposal(p_establishment_id uuid DEFAULT NULL::uuid, p_type text DEFAULT NULL::text, p_payload jsonb DEFAULT NULL::jsonb, p_establishment_proposal_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_id uuid;
  v_safe_payload jsonb;
  v_safe_photos jsonb;
  v_lobby_connector_active boolean;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  -- 20261019120000 : p_type a désormais un DEFAULT (contrainte de PostgreSQL : tout paramètre qui
  -- suit un paramètre à défaut en a un) — `null not in (...)` vaut null, jamais vrai : sans le
  -- `is null`, un type absent passerait ce garde.
  if p_type is null or p_type not in ('activity', 'evento', 'camp', 'lodging', 'transport') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_type');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));

  -- 20261019120000 : la cible est SOIT un établissement existant, SOIT une proposition de création
  -- d'établissement encore en attente — jamais les deux, jamais aucune.
  if (p_establishment_id is null) = (p_establishment_proposal_id is null) then
    return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
  end if;

  if p_establishment_id is not null then
    if v_partner_id is null or not exists (
      select 1 from public.establishments where id = p_establishment_id and partner_id = v_partner_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
    end if;

    if not (select public.has_capability(v_account_id, 'operator', p_establishment_id)) then
      return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
    end if;
  else
    -- `for share` : moderate_establishment_proposal et withdraw_establishment_proposal prennent cette
    -- même ligne `for update` AVANT de rattacher, refuser ou retirer les activités qui en dépendent.
    -- Sans ce verrou, une activité déposée pendant l'approbation de son établissement arriverait
    -- après le rattachement et resterait sans établissement, pour toujours. Avec lui, elle attend la
    -- fin de la modération et relit le statut : plus « pending », elle est refusée ci-dessous.
    perform 1 from public.establishment_proposals
      where id = p_establishment_proposal_id and partner_id = v_partner_id
        and kind = 'create' and status = 'pending'
      for share;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'establishment_proposal_not_pending');
    end if;

    -- L'établissement n'existe pas encore : aucune capacité ne le désigne. La capacité operator
    -- du partenaire, quelle qu'elle soit, doit seulement être active — la même règle que
    -- has_capability, sans établissement.
    if not (select public.has_capability(v_account_id, 'operator', null)) then
      return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
    end if;
  end if;

  if coalesce(btrim(p_payload -> 'name' ->> 'es'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  if (
    select count(*) from public.product_proposals where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  if jsonb_typeof(p_payload -> 'photos') = 'array' and jsonb_array_length(p_payload -> 'photos') > 6 then
    return jsonb_build_object('ok', false, 'reason', 'gallery_cap_exceeded');
  end if;

  -- Ajout de cette migration (20260916140000) : plafond serveur du programme, exactement le motif
  -- de gallery_cap_exceeded. La whitelist ci-dessous ne valide AUCUNE forme — sans ce garde-fou un
  -- socio peut poster plusieurs Mo de JSONB dans product_proposals.payload, qui n'a lui-même
  -- aucune limite de taille. Le plafond par ligne, la borne sur le jour et l'obligation d'un texte
  -- espagnol restent côté app (apps/admin/lib/products/program.ts, testé) : ici on ne borne que
  -- l'abus grossier, le seul que la base puisse constater sans dupliquer la validation métier.
  if jsonb_typeof(p_payload -> 'program') = 'array' and jsonb_array_length(p_payload -> 'program') > 200 then
    return jsonb_build_object('ok', false, 'reason', 'program_cap_exceeded');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', photo ->> 'storage_path')), '[]'::jsonb)
    into v_safe_photos
    from jsonb_array_elements(coalesce(p_payload -> 'photos', '[]'::jsonb)) photo
   where coalesce(btrim(photo ->> 'storage_path'), '') <> '';

  select lobby_connector_active into v_lobby_connector_active
    from public.establishments where id = p_establishment_id;

  v_safe_payload := jsonb_build_object(
      'name', p_payload -> 'name', 'description', p_payload -> 'description', 'photos', v_safe_photos
    )
    -- 2026-09-16 (transport informatif) : `transport` RETIRÉ de ce bloc. Un trajet a DEUX
    -- extrémités, donc ses propres colonnes dédiées (transport_departure_*/transport_arrival_*,
    -- bloc ajouté plus bas) ; laisser le trio générique whitelisté pour lui recréerait la double
    -- source de vérité que ces colonnes viennent précisément fermer — une proposition résiduelle
    -- reposerait `address` sur un transport au moment de l'approuver.
    || case when p_type in ('activity', 'lodging') then jsonb_build_object(
         'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon'
       ) else '{}'::jsonb end
    -- 20261013212500 : `evento` rejoint cette liste. hasTags (productTypeGating.ts) le couvre depuis
    -- le 2026-09-14 et le formulaire socio affiche le champ, mais cette whitelist jetait la clé :
    -- les étiquettes choisies par le partenaire n'arrivaient jamais jusqu'à la modération.
    || case when p_type in ('activity', 'lodging', 'transport', 'camp', 'evento') then jsonb_build_object(
         'tag_ids', coalesce(p_payload -> 'tag_ids', '[]'::jsonb)
       ) else '{}'::jsonb end
    || case when p_type in ('activity', 'lodging', 'transport') then jsonb_build_object(
         'price_cop', p_payload -> 'price_cop', 'price_tiers', p_payload -> 'price_tiers',
         'min_qty', p_payload -> 'min_qty', 'max_qty', p_payload -> 'max_qty'
       ) else '{}'::jsonb end
    -- Migration 20261025140000 (spec 43) : mode de prix et personnes min/max d'une activité —
    -- mêmes clés à l'édition (submit_product_proposal), sinon elles disparaîtraient à la première
    -- modification.
    || case when p_type = 'activity' then jsonb_build_object(
         'pricing_unit', p_payload -> 'pricing_unit',
         'min_persons', p_payload -> 'min_persons', 'max_persons', p_payload -> 'max_persons'
       ) else '{}'::jsonb end
    -- Ajout de cette migration (20260914140000) : group_discount_threshold_qty/group_discount_pct
    -- rejoignent le bloc whitelist camp déjà existant — même geste que duration_days.
    || case when p_type = 'camp' then
         jsonb_build_object(
           'price_cop', p_payload -> 'price_cop', 'duration_days', p_payload -> 'duration_days',
           'group_discount_threshold_qty', p_payload -> 'group_discount_threshold_qty',
           'group_discount_pct', p_payload -> 'group_discount_pct',
           -- Ajout de cette migration (20260916140000) : le programme rejoint le bloc camp déjà
           -- existant — même geste que group_discount_* en 20260914140000. Une clé absente d'ici
           -- est SILENCIEUSEMENT jetée, donc création et édition DOIVENT whitelister les mêmes
           -- clés, sinon le programme se remplirait à la création puis disparaîtrait à la première
           -- modification (précédent vécu : unit_count, lodging_kind, external_booking_url).
           'program', p_payload -> 'program'
         )
       else '{}'::jsonb end
    || case when p_type = 'lodging' then jsonb_build_object(
         'check_in_time', p_payload -> 'check_in_time', 'check_out_time', p_payload -> 'check_out_time'
       ) else '{}'::jsonb end
    -- SEUL CHANGEMENT de cette fonction (2026-08-27, second passage du jour) : `lodging_kind`
    -- rejoint la whitelist des logements. Une clé absente d'ici est SILENCIEUSEMENT jetée — c'est
    -- exactement le rôle de cette whitelist — donc l'oublier ferait disparaître le type de couchage
    -- entre le formulaire du socio et la proposition enregistrée, sans erreur nulle part.
    || case when p_type = 'lodging' then
         jsonb_build_object('capacity', p_payload -> 'capacity', 'unit_count', p_payload -> 'unit_count',
                            'lodging_kind', p_payload -> 'lodging_kind', 'unit', p_payload -> 'unit',
                            'stay_rates', p_payload -> 'stay_rates')
       else '{}'::jsonb end
    -- 20261013212500 : `lodging` rejoint cette liste. Le champ « Cupo diario por defecto » est
    -- affiché pour un logement depuis le 2026-09-13 et create_product_from_proposal sait le lire
    -- (valeur saisie, sinon resolve_lodging_default_capacity) — mais la clé était jetée ici, donc
    -- la valeur du partenaire n'arrivait jamais et c'est toujours le calcul qui s'appliquait.
    || case when p_type in ('activity', 'camp', 'transport', 'lodging') then
         jsonb_build_object('default_capacity', p_payload -> 'default_capacity')
       else '{}'::jsonb end
    -- 2026-09-16 (transport informatif, demande Jérôme) : fenêtre de départs quotidienne, places
    -- annoncées par départ, et les DEUX lieux dédiés. ⚠️ PUREMENT INFORMATIFS — aucune RPC ne les
    -- lit, ils ne décrémentent rien, et ce ne sont surtout pas des `slot_rules` (bloc juste en
    -- dessous, activity seulement), qui rendraient `create_order` bloquant via le refus
    -- `slot_required`. Le cupo réel d'un transport reste `default_capacity`, par date.
    -- Whitelistés pour le socio sans restriction : un transporteur est précisément la personne qui
    -- connaît ses horaires.
    -- ⚠️ FILTRÉ sur les clés RÉELLEMENT PRÉSENTES, pas un `jsonb_build_object` des 9 clés.
    -- `jsonb_build_object('k', p_payload -> 'k')` produit `{"k": null}` quand la clé est absente
    -- de l'entrée : la clé EXISTE alors dans le payload enregistré, avec la valeur null. Le `?` de
    -- la forme gardée de moderate_product_proposal répondrait « présente » et écrirait ce null —
    -- donc EFFACERAIT les horaires déjà posés, ce que la forme gardée existe précisément pour
    -- empêcher (prouvé par transport_departure_info_proposal_parity.test.sql).
    -- Ici : clé absente ⇒ rien n'entre ⇒ moderate conserve l'existant. Clé présente à null ⇒ elle
    -- entre ⇒ moderate efface, ce qui est bien une demande explicite du prestataire.
    || case when p_type = 'transport'
         then (
           select coalesce(jsonb_object_agg(cle, p_payload -> cle), '{}'::jsonb)
             from unnest(array[
             'transport_first_departure_time', 'transport_last_departure_time',
             'transport_seats_per_departure',
             'transport_departure_address', 'transport_departure_lat', 'transport_departure_lon',
             'transport_arrival_address', 'transport_arrival_lat', 'transport_arrival_lon',
             'transport_contact_phone'
           ]) as cle
            where p_payload ? cle
         )
       else '{}'::jsonb end
    || case when p_type = 'activity' then
         jsonb_build_object('slot_rules', coalesce(p_payload -> 'slot_rules', '[]'::jsonb))
       else '{}'::jsonb end
    -- 2026-09-09 : la VITRINE n'est plus réservée aux eventos. `external_booking_url` est le
    -- mécanisme de vitrine (cahier §2e, spec 30 §3.1) et la contrainte
    -- `products_price_cop_required_unless_vitrine` l'accepte depuis le 2026-09-08 pour TOUS les
    -- types — mais cette whitelist les jetait silencieusement hors evento, donc l'URL saisie par un
    -- socio disparaissait entre son formulaire et la proposition enregistrée, sans erreur nulle
    -- part. `price_label` l'accompagne : sans lui, une vitrine sans prix chiffré n'aurait rien à
    -- afficher. Le bloc `evento` ci-dessous garde les siens (il porte aussi ses occurrences).
    || case when p_type <> 'evento' then jsonb_build_object(
         'external_booking_url', p_payload -> 'external_booking_url',
         'price_label', p_payload -> 'price_label'
       ) else '{}'::jsonb end
    || case when p_type = 'evento' then jsonb_build_object(
         'price_label', p_payload -> 'price_label', 'occurrence_type', p_payload -> 'occurrence_type',
         'occurrence_date', p_payload -> 'occurrence_date',
         'recurrence_frequency_days', p_payload -> 'recurrence_frequency_days',
         'recurrence_end_date', p_payload -> 'recurrence_end_date',
         'recurrence_end_count', p_payload -> 'recurrence_end_count',
         'start_time', p_payload -> 'start_time', 'duration_minutes', p_payload -> 'duration_minutes',
         'external_booking_url', p_payload -> 'external_booking_url'
       ) else '{}'::jsonb end
    -- Refonte LobbyPMS (2026-08-25) : uniquement si l'établissement est déjà connecté — jamais un
    -- ID Lobby arbitraire sur un établissement non connecté (cf. commentaire de tête).
    || case when p_type = 'lodging' and coalesce(v_lobby_connector_active, false) then
         jsonb_build_object('lobby_category_id', nullif(p_payload ->> 'lobby_category_id', '')::int)
       else '{}'::jsonb end
    -- Élargi le 2026-08-26 de 'activity' seul à ('activity', 'transport') — cf. commentaire de tête
    -- de ce fichier pour le raisonnement complet (evento/camp restent exclus, incompatibilité
    -- structurelle avec addLobbyProductService, pas un simple oubli).
    || case when p_type in ('activity', 'transport') and coalesce(v_lobby_connector_active, false) then
         jsonb_build_object('lobby_product_id', nullif(p_payload ->> 'lobby_product_id', '')::int)
       else '{}'::jsonb end
    -- Ajout de cette migration (20261013151206) : équipements d'un LOGEMENT, proposables dès la
    -- création. Le tableau stocké est reconstruit depuis catalog_amenities : un identifiant
    -- inconnu ou mal formé est écarté ici, sans jamais caster en uuid un texte venu du client.
    || case when p_type = 'lodging' and jsonb_typeof(p_payload -> 'amenity_ids') = 'array'
         then jsonb_build_object('amenity_ids', (
           select coalesce(jsonb_agg(c.id order by c.slug), '[]'::jsonb)
             from public.catalog_amenities c
            where (p_payload -> 'amenity_ids') ? c.id::text
         ))
       else '{}'::jsonb end;

  -- 20261019120000 : sur un établissement en attente, v_lobby_connector_active est resté null
  -- (aucune ligne lue) — les identifiants Lobby sont donc écartés, comme pour tout établissement
  -- non connecté.
  insert into public.product_proposals
    (product_id, establishment_id, establishment_proposal_id, partner_id, submitted_by, kind, type, payload)
  values (null, p_establishment_id, p_establishment_proposal_id, v_partner_id, v_account_id, 'create',
          p_type, v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$function$;

-- ── submit_product_proposal ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_product_proposal(p_product_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_establishment_id uuid;
  v_type text;
  v_proposal_id uuid;
  v_safe_payload jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));

  select establishment_id, type into v_establishment_id, v_type
    from public.products where id = p_product_id;

  -- Garde-fous 1+2 (identité + propriété) : produit inexistant ou d'un autre partenaire → même
  -- réponse "introuvable" dans les deux cas, jamais un refus explicite qui révèlerait l'existence
  -- du produit d'un tiers (cahier des charges socio §3d).
  if v_establishment_id is null or not exists (
    select 1 from public.establishments
     where id = v_establishment_id and partner_id = v_partner_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;

  -- Garde-fou 3 (capacité) : operator actif pour CET établissement précis, pas juste l'identité
  -- (correctif Tranche 1 — has_capability avec le 3e argument).
  if not (select public.has_capability(v_account_id, 'operator', v_establishment_id)) then
    return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
  end if;

  -- Plafond de propositions en attente (cahier des charges socio §3e).
  if (
    select count(*) from public.product_proposals
     where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  -- Ajout de cette migration (20260916140000) : plafond serveur du programme, exactement le motif
  -- de gallery_cap_exceeded. La whitelist ci-dessous ne valide AUCUNE forme — sans ce garde-fou un
  -- socio peut poster plusieurs Mo de JSONB dans product_proposals.payload, qui n'a lui-même
  -- aucune limite de taille. Le plafond par ligne, la borne sur le jour et l'obligation d'un texte
  -- espagnol restent côté app (apps/admin/lib/products/program.ts, testé) : ici on ne borne que
  -- l'abus grossier, le seul que la base puisse constater sans dupliquer la validation métier.
  if jsonb_typeof(p_payload -> 'program') = 'array' and jsonb_array_length(p_payload -> 'program') > 200 then
    return jsonb_build_object('ok', false, 'reason', 'program_cap_exceeded');
  end if;

  -- Whitelist par type — miroir exact du bloc `if (isEditing && product)` de ProductForm
  -- (product-form.tsx), jamais photos/slot_rules (délégués à des blocs séparés à
  -- sauvegarde immédiate côté admin, jamais couverts par ce même submit là non plus). Les
  -- étiquettes (`tag_ids`) entrent depuis 20261013144848 par le bloc gardé en fin de whitelist.
  v_safe_payload := jsonb_build_object('name', p_payload -> 'name', 'description', p_payload -> 'description')
    -- 2026-09-16 (transport informatif) : `transport` RETIRÉ de ce bloc. Un trajet a DEUX
    -- extrémités, donc ses propres colonnes dédiées (transport_departure_*/transport_arrival_*,
    -- bloc ajouté plus bas) ; laisser le trio générique whitelisté pour lui recréerait la double
    -- source de vérité que ces colonnes viennent précisément fermer — une proposition résiduelle
    -- reposerait `address` sur un transport au moment de l'approuver.
    || case when v_type in ('activity', 'lodging') then jsonb_build_object(
         'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon'
       ) else '{}'::jsonb end
    || case when v_type <> 'evento' then
         jsonb_build_object('price_cop', p_payload -> 'price_cop') else '{}'::jsonb end
    || case when v_type in ('activity', 'lodging', 'transport') then jsonb_build_object(
         'price_tiers', p_payload -> 'price_tiers', 'min_qty', p_payload -> 'min_qty',
         'max_qty', p_payload -> 'max_qty'
       ) else '{}'::jsonb end
    -- Migration 20261025140000 (spec 43) : miroir de submit_product_creation_proposal.
    || case when v_type = 'activity' then jsonb_build_object(
         'pricing_unit', p_payload -> 'pricing_unit',
         'min_persons', p_payload -> 'min_persons', 'max_persons', p_payload -> 'max_persons'
       ) else '{}'::jsonb end
    || case when v_type = 'lodging' then jsonb_build_object(
         'check_in_time', p_payload -> 'check_in_time', 'check_out_time', p_payload -> 'check_out_time'
       ) else '{}'::jsonb end
    -- SEUL CHANGEMENT de cette fonction (2026-08-27, second passage du jour) : `lodging_kind`,
    -- miroir exact de submit_product_creation_proposal ci-dessus — création et édition doivent
    -- whitelister les MÊMES clés, sinon un champ se remplit à la création et disparaît à la
    -- première modification.
    || case when v_type = 'lodging' then
         jsonb_build_object('capacity', p_payload -> 'capacity', 'unit_count', p_payload -> 'unit_count',
                            'lodging_kind', p_payload -> 'lodging_kind', 'unit', p_payload -> 'unit',
                            'stay_rates', p_payload -> 'stay_rates')
       else '{}'::jsonb end
    -- 20261013212500 : `lodging` rejoint cette liste, miroir de submit_product_creation_proposal.
    -- Ici l'oubli EFFAÇAIT : la clé jetée, l'écran de modération affichait un champ vide, renvoyait
    -- null, et l'approbation vidait default_capacity — après quoi roll_lodging_availability_window
    -- (« where default_capacity is not null ») cessait d'ouvrir des nuits pour ce logement.
    || case when v_type in ('activity', 'camp', 'transport', 'lodging') then
         jsonb_build_object('default_capacity', p_payload -> 'default_capacity')
       else '{}'::jsonb end
    -- Ajout de cette migration (20260914140000) : jusqu'ici aucun bloc dédié à camp au-delà de
    -- default_capacity (partagé avec activity/transport) dans ce chemin d'ÉDITION — miroir du bloc
    -- camp déjà présent dans submit_product_creation_proposal (création), même raisonnement.
    || case when v_type = 'camp' then
         jsonb_build_object(
           'group_discount_threshold_qty', p_payload -> 'group_discount_threshold_qty',
           'group_discount_pct', p_payload -> 'group_discount_pct',
           -- Ajout de cette migration (20260916140000) : le programme rejoint le bloc camp déjà
           -- existant — même geste que group_discount_* en 20260914140000. Une clé absente d'ici
           -- est SILENCIEUSEMENT jetée, donc création et édition DOIVENT whitelister les mêmes
           -- clés, sinon le programme se remplirait à la création puis disparaîtrait à la première
           -- modification (précédent vécu : unit_count, lodging_kind, external_booking_url).
           'program', p_payload -> 'program'
         )
       else '{}'::jsonb end
    -- 2026-09-09 : ces deux clés n'étaient whitelistées ici pour AUCUN type, evento compris — un
    -- socio ne pouvait donc pas corriger l'URL d'une vitrine qu'il avait lui-même proposée, ni son
    -- libellé de prix. Défaut antérieur à l'ouverture de la vitrine aux non-eventos, pas une
    -- régression de celle-ci. Whitelistées pour TOUS les types, exactement comme
    -- submit_product_creation_proposal ci-dessus : création et modification doivent whitelister les
    -- MÊMES clés, sinon un champ se remplit à la création et disparaît à la première modification
    -- (c'est la leçon déjà écrite pour `unit_count` et `lodging_kind`).
    -- 2026-09-16 (transport informatif) : miroir EXACT du bloc transport de
    -- submit_product_creation_proposal. Création et édition doivent whitelister les MÊMES clés,
    -- sinon un champ se remplit à la création et disparaît à la première modification — leçon déjà
    -- écrite ici pour unit_count, lodging_kind puis external_booking_url/price_label.
    -- ⚠️ FILTRÉ sur les clés RÉELLEMENT PRÉSENTES, pas un `jsonb_build_object` des 9 clés.
    -- `jsonb_build_object('k', p_payload -> 'k')` produit `{"k": null}` quand la clé est absente
    -- de l'entrée : la clé EXISTE alors dans le payload enregistré, avec la valeur null. Le `?` de
    -- la forme gardée de moderate_product_proposal répondrait « présente » et écrirait ce null —
    -- donc EFFACERAIT les horaires déjà posés, ce que la forme gardée existe précisément pour
    -- empêcher (prouvé par transport_departure_info_proposal_parity.test.sql).
    -- Ici : clé absente ⇒ rien n'entre ⇒ moderate conserve l'existant. Clé présente à null ⇒ elle
    -- entre ⇒ moderate efface, ce qui est bien une demande explicite du prestataire.
    || case when v_type = 'transport'
         then (
           select coalesce(jsonb_object_agg(cle, p_payload -> cle), '{}'::jsonb)
             from unnest(array[
             'transport_first_departure_time', 'transport_last_departure_time',
             'transport_seats_per_departure',
             'transport_departure_address', 'transport_departure_lat', 'transport_departure_lon',
             'transport_arrival_address', 'transport_arrival_lat', 'transport_arrival_lon',
             'transport_contact_phone'
           ]) as cle
            where p_payload ? cle
         )
       else '{}'::jsonb end
    -- 20261013212500 : QUAND un evento a lieu — date, récurrence, heure de début, durée. Ces sept
    -- clés n'étaient whitelistées qu'à la création : en édition, la date et l'heure saisies par le
    -- partenaire disparaissaient avant la modération (constaté sur « Exposición Mirarte »).
    -- Création et édition doivent whitelister les MÊMES clés — leçon déjà écrite plus haut.
    -- ⚠️ FILTRÉ sur les clés RÉELLEMENT PRÉSENTES, comme le bloc transport : une clé absente
    -- n'entre pas (moderate_product_proposal garde alors l'existant), au lieu d'entrer à null.
    || case when v_type = 'evento'
         then (
           select coalesce(jsonb_object_agg(cle, p_payload -> cle), '{}'::jsonb)
             from unnest(array[
             'occurrence_type', 'occurrence_date', 'recurrence_frequency_days',
             'recurrence_end_date', 'recurrence_end_count', 'start_time', 'duration_minutes'
           ]) as cle
            where p_payload ? cle
         )
       else '{}'::jsonb end
    || jsonb_build_object(
         'external_booking_url', p_payload -> 'external_booking_url',
         'price_label', p_payload -> 'price_label'
       )
    -- Ajout de cette migration (20261013144848) : étiquettes proposables en édition, pour TOUS les
    -- types (hasTags de productTypeGating.ts les couvre tous). Clé absente ⇒ rien n'entre ⇒
    -- moderate_product_proposal conserve les étiquettes en place ; tableau présent, même vide ⇒
    -- il entre ⇒ l'approbation REMPLACE l'ensemble. Le tableau stocké est reconstruit depuis
    -- catalog_tags : un identifiant inconnu, mal formé ou supprimé entre-temps est écarté ici, sans
    -- jamais caster en uuid un texte venu du client.
    || case when jsonb_typeof(p_payload -> 'tag_ids') = 'array'
         -- 20261025100000 : l'ORDRE du partenaire est gardé (la première étiquette classe la
         -- carte dans la vitrine) ; il était jusqu'ici retrié par slug.
         then jsonb_build_object('tag_ids',
           to_jsonb(public.catalog_tag_ids_in_order(p_payload -> 'tag_ids')))
       else '{}'::jsonb end
    -- Ajout de cette migration (20261013151206) : équipements d'un LOGEMENT, proposables en édition —
    -- même forme gardée que tag_ids juste au-dessus. Clé absente ⇒ rien n'entre ⇒
    -- moderate_product_proposal conserve les équipements en place ; tableau présent, même vide ⇒
    -- l'approbation REMPLACE l'ensemble.
    || case when v_type = 'lodging' and jsonb_typeof(p_payload -> 'amenity_ids') = 'array'
         then jsonb_build_object('amenity_ids', (
           select coalesce(jsonb_agg(c.id order by c.slug), '[]'::jsonb)
             from public.catalog_amenities c
            where (p_payload -> 'amenity_ids') ? c.id::text
         ))
       else '{}'::jsonb end;

  insert into public.product_proposals (product_id, partner_id, submitted_by, payload)
  values (p_product_id, v_partner_id, v_account_id, v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$function$;

-- ── create_product_from_proposal ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_product_from_proposal(p_partner_id uuid, p_establishment_id uuid, p_type text, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product_id uuid;
  v_slug_base text;
  v_slug text;
  v_suffix int := 1;
  v_tag_id text;
  v_slot jsonb;
  v_photo jsonb;
  v_sort int;
  v_default_capacity int;
  v_owner_partner_id uuid;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_product_from_proposal réservé au rôle admin' using errcode = '42501';
  end if;

  -- Propriétaire = celui de l'établissement maintenant, pas l'auteur de la proposition (p_partner_id
  -- reste dans la signature pour moderate_product_proposal, mais ne décide plus du propriétaire).
  select partner_id into v_owner_partner_id
    from public.establishments
   where id = p_establishment_id
   for share;
  if not found then
    raise exception 'établissement introuvable';
  end if;

  v_slug_base := public.slugify(coalesce(p_payload -> 'name' ->> 'es', 'producto'));
  if v_slug_base = '' then
    v_slug_base := 'producto';
  end if;
  v_slug := v_slug_base;
  while exists (select 1 from public.products where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix;
  end loop;

  v_default_capacity := nullif(p_payload ->> 'default_capacity', '')::int;
  if p_type = 'lodging' and v_default_capacity is null then
    v_default_capacity := public.resolve_lodging_default_capacity(
      nullif(p_payload ->> 'lodging_kind', ''),
      nullif(p_payload ->> 'unit_count', '')::int,
      nullif(p_payload ->> 'capacity', '')::int
    );
  end if;

  insert into public.products (
    partner_id, establishment_id, type, name, description, slug, sellable,
    price_cop, price_tiers, min_qty, max_qty,
    -- Migration 20261025140000 (spec 43).
    pricing_unit, min_persons, max_persons,
    address, lat, lon,
    check_in_time, check_out_time, capacity, unit_count, lodging_kind, unit, default_capacity, stay_rates,
    duration_days,
    -- Ajout de cette migration (20260914140000) : parité avec la whitelist de
    -- submit_product_creation_proposal — sans ces 2 colonnes ici, la remise configurée par un
    -- prestataire survivrait dans la proposition mais disparaîtrait à l'approbation.
    group_discount_threshold_qty, group_discount_pct,
    -- Ajout de cette migration (20260916140000) : parité avec la whitelist de
    -- submit_product_creation_proposal — sans cette colonne ici, le programme saisi par un
    -- prestataire survivrait dans la proposition et disparaîtrait à l'approbation.
    program,
    price_label, occurrence_type, occurrence_date, recurrence_frequency_days,
    recurrence_end_date, recurrence_end_count, start_time, duration_minutes, external_booking_url,
    lobby_category_id, lobby_product_id,
    -- 2026-09-16 (transport informatif) : parité avec la whitelist de
    -- submit_product_creation_proposal — sans ces 9 colonnes ici, les horaires et les deux lieux
    -- d'un transport survivraient dans la proposition mais disparaîtraient à l'approbation (le
    -- défaut déjà vécu pour unit_count, lodging_kind puis external_booking_url).
    transport_first_departure_time, transport_last_departure_time, transport_seats_per_departure,
    transport_departure_address, transport_departure_lat, transport_departure_lon,
    transport_arrival_address, transport_arrival_lat, transport_arrival_lon,
    transport_contact_phone
  )
  values (
    v_owner_partner_id, p_establishment_id, p_type,
    p_payload -> 'name', p_payload -> 'description', v_slug,
    true,
    nullif(p_payload ->> 'price_cop', '')::bigint,
    p_payload -> 'price_tiers',
    nullif(p_payload ->> 'min_qty', '')::int,
    nullif(p_payload ->> 'max_qty', '')::int,
    -- Clé absente = « por persona », le défaut de la colonne (seule l'activité la porte : la
    -- whitelist de submit_product_creation_proposal ne la laisse passer que pour ce type).
    coalesce(nullif(p_payload ->> 'pricing_unit', ''), 'per_person'),
    nullif(p_payload ->> 'min_persons', '')::int,
    nullif(p_payload ->> 'max_persons', '')::int,
    p_payload ->> 'address',
    nullif(p_payload ->> 'lat', '')::double precision,
    nullif(p_payload ->> 'lon', '')::double precision,
    nullif(p_payload ->> 'check_in_time', '')::time,
    nullif(p_payload ->> 'check_out_time', '')::time,
    nullif(p_payload ->> 'capacity', '')::int,
    nullif(p_payload ->> 'unit_count', '')::int,
    nullif(p_payload ->> 'lodging_kind', ''),
    nullif(p_payload ->> 'unit', ''),
    v_default_capacity,
    p_payload -> 'stay_rates',
    nullif(p_payload ->> 'duration_days', '')::int,
    nullif(p_payload ->> 'group_discount_threshold_qty', '')::int,
    nullif(p_payload ->> 'group_discount_pct', '')::numeric,
    -- ⚠️ NORMALISÉ, jamais `p_payload -> 'program'` brut comme price_tiers/stay_rates au-dessus :
    -- un payload {"program": null} donne ici le littéral JSON `null` ('null'::jsonb) et NON un
    -- NULL SQL, et jsonb_typeof('null'::jsonb) = 'null' ferait échouer le CHECK
    -- products_program_is_array (20260916130000) sur TOUTE création de camp sans programme.
    -- Précédent exact : 20260818240000_fix_price_tiers_json_null.sql (11 produits pollués).
    case when jsonb_typeof(p_payload -> 'program') = 'array' then p_payload -> 'program' else null end,
    p_payload ->> 'price_label',
    p_payload ->> 'occurrence_type',
    nullif(p_payload ->> 'occurrence_date', '')::date,
    nullif(p_payload ->> 'recurrence_frequency_days', '')::int,
    nullif(p_payload ->> 'recurrence_end_date', '')::date,
    nullif(p_payload ->> 'recurrence_end_count', '')::int,
    nullif(p_payload ->> 'start_time', '')::time,
    nullif(p_payload ->> 'duration_minutes', '')::int,
    nullif(p_payload ->> 'external_booking_url', ''),
    nullif(p_payload ->> 'lobby_category_id', '')::int,
    nullif(p_payload ->> 'lobby_product_id', '')::int,
    -- Même ordre que la liste de colonnes ci-dessus. Les CHECK products_transport_* font échouer
    -- BRUYAMMENT un payload d'un autre type qui porterait ces clés — échec fermé voulu, pas un
    -- défaut : cette RPC insère pour tous les types depuis un seul `insert`.
    nullif(p_payload ->> 'transport_first_departure_time', '')::time,
    nullif(p_payload ->> 'transport_last_departure_time', '')::time,
    nullif(p_payload ->> 'transport_seats_per_departure', '')::int,
    nullif(p_payload ->> 'transport_departure_address', ''),
    nullif(p_payload ->> 'transport_departure_lat', '')::double precision,
    nullif(p_payload ->> 'transport_departure_lon', '')::double precision,
    nullif(p_payload ->> 'transport_arrival_address', ''),
    nullif(p_payload ->> 'transport_arrival_lat', '')::double precision,
    nullif(p_payload ->> 'transport_arrival_lon', '')::double precision,
    nullif(p_payload ->> 'transport_contact_phone', '')
  )
  returning id into v_product_id;

  if jsonb_typeof(p_payload -> 'tag_ids') = 'array' then
    for v_tag_id in select * from jsonb_array_elements_text(p_payload -> 'tag_ids') loop
      insert into public.product_tag_assignments (product_id, tag_id) values (v_product_id, v_tag_id::uuid);
    end loop;
  end if;

  -- Ajout de cette migration (20261013151206) : équipements proposés avec un logement. Jointure sur
  -- catalog_amenities et non un cast : ce payload peut être celui que l'admin a corrigé, qui ne
  -- repasse pas par la whitelist du dépôt.
  if p_type = 'lodging' and jsonb_typeof(p_payload -> 'amenity_ids') = 'array' then
    insert into public.product_amenity_assignments (product_id, amenity_id)
    select v_product_id, c.id
      from public.catalog_amenities c
     where (p_payload -> 'amenity_ids') ? c.id::text
    on conflict do nothing;
  end if;

  if jsonb_typeof(p_payload -> 'photos') = 'array' then
    v_sort := 0;
    for v_photo in select * from jsonb_array_elements(p_payload -> 'photos') loop
      insert into public.product_media (product_id, storage_path, sort)
      values (v_product_id, v_photo ->> 'storage_path', v_sort);
      v_sort := v_sort + 1;
    end loop;
  end if;

  if p_type = 'activity' and jsonb_typeof(p_payload -> 'slot_rules') = 'array' then
    for v_slot in select * from jsonb_array_elements(p_payload -> 'slot_rules') loop
      insert into public.product_slot_rules
        (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
      values (
        v_product_id,
        (select array_agg((w)::int order by (w)::int) from jsonb_array_elements_text(v_slot -> 'weekdays') w),
        (v_slot ->> 'start_time')::time,
        (v_slot ->> 'end_time')::time,
        (v_slot ->> 'slot_duration_minutes')::int,
        (v_slot ->> 'capacity')::int
      );
    end loop;
  end if;

  if p_type = 'lodging' and v_default_capacity is not null then
    perform public.open_default_lodging_availability(v_product_id);
  end if;

  perform public.log_admin_action(
    'product_proposal.approve_create', 'products', v_product_id, null,
    jsonb_build_object('partner_id', v_owner_partner_id, 'establishment_id', p_establishment_id, 'type', p_type),
    null
  );

  return v_product_id;
end;
$function$;

-- ── moderate_product_proposal ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.moderate_product_proposal(p_proposal_id uuid, p_decision text, p_expected_version integer, p_corrected_payload jsonb DEFAULT NULL::jsonb, p_rejection_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_proposal record;
  v_final_payload jsonb;
  v_reviewer_email text;
  v_photo jsonb;
  v_next_sort int;
  v_new_product_id uuid;
  v_submitted_by uuid;
  v_submitted_by_email text;
  v_entity_name text;
  v_subject text;
  v_body text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'moderate_product_proposal réservé au rôle admin' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'décision invalide : %', p_decision;
  end if;
  if p_decision = 'reject' and (p_rejection_reason is null or btrim(p_rejection_reason) = '') then
    raise exception 'motif obligatoire pour un rejet';
  end if;

  select id, product_id, establishment_id, partner_id, type, payload, status, version, reviewed_by, kind
    into v_proposal
    from public.product_proposals where id = p_proposal_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
  end if;
  if v_proposal.status <> 'pending' then
    select email into v_reviewer_email from auth.users where id = v_proposal.reviewed_by;
    return jsonb_build_object('ok', false, 'reason', 'already_handled',
      'status', v_proposal.status, 'reviewed_by_email', v_reviewer_email);
  end if;
  if v_proposal.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'version_conflict');
  end if;

  -- 20261019120000 : une activité déposée avec un établissement encore en attente ne peut être
  -- approuvée qu'une fois l'établissement approuvé (establishment_id rattaché par
  -- moderate_establishment_proposal). La rejeter, elle, reste toujours possible.
  if p_decision = 'approve' and v_proposal.kind = 'create' and v_proposal.establishment_id is null then
    return jsonb_build_object('ok', false, 'reason', 'establishment_pending');
  end if;

  if p_decision = 'approve' and v_proposal.kind = 'create' then
    v_final_payload := coalesce(p_corrected_payload, v_proposal.payload)
      || jsonb_build_object('photos', coalesce(v_proposal.payload -> 'photos', '[]'::jsonb));

    v_new_product_id := public.create_product_from_proposal(
      v_proposal.partner_id, v_proposal.establishment_id, v_proposal.type, v_final_payload
    );

    update public.product_proposals
       set status = 'approved', product_id = v_new_product_id, payload = v_final_payload,
           reviewed_by = auth.uid(), reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

  elsif p_decision = 'approve' and v_proposal.kind = 'photos' then
    v_final_payload := coalesce(p_corrected_payload, v_proposal.payload);

    select coalesce(max(sort), -1) + 1 into v_next_sort
      from public.product_media where product_id = v_proposal.product_id;

    for v_photo in select * from jsonb_array_elements(v_final_payload -> 'photos')
    loop
      insert into public.product_media (product_id, storage_path, sort)
      values (v_proposal.product_id, v_photo ->> 'storage_path', v_next_sort);
      v_next_sort := v_next_sort + 1;
    end loop;

    update public.product_proposals
       set status = 'approved', payload = v_final_payload, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('product_proposal.approve_photos', 'product_media',
      v_proposal.product_id, null, v_final_payload, null);

  elsif p_decision = 'approve' then
    v_final_payload := coalesce(p_corrected_payload, v_proposal.payload);

    update public.products
       set name = v_final_payload -> 'name',
           description = v_final_payload -> 'description',
           address = v_final_payload ->> 'address',
           lat = nullif(v_final_payload ->> 'lat', '')::double precision,
           lon = nullif(v_final_payload ->> 'lon', '')::double precision,
           -- 20261013212500 : le prix chiffré d'un evento est un réglage ADMIN (evento réservable
           -- en ligne), jamais proposable — submit_product_proposal l'écarte déjà. Mais le payload
           -- corrigé par l'écran de modération ne repasse pas par cette whitelist et portait null :
           -- approuver une simple correction de texte EFFAÇAIT le prix d'un evento payant.
           price_cop = case when type = 'evento' then price_cop
                            else nullif(v_final_payload ->> 'price_cop', '')::bigint end,
           price_tiers = v_final_payload -> 'price_tiers',
           min_qty = nullif(v_final_payload ->> 'min_qty', '')::int,
           max_qty = nullif(v_final_payload ->> 'max_qty', '')::int,
           -- Migration 20261025140000 (spec 43) : GARDÉES (« ? ») comme leurs voisines — une
           -- proposition déposée avant cette migration ne porte pas ces clés. Le mode, lui, n'est
           -- jamais nul : une valeur nulle (la whitelist pose la clé à null quand l'écran ne l'a pas
           -- envoyée) garde le mode actuel, jamais un retour silencieux à « por persona ». Réservé à
           -- l'activité (products_pricing_unit_activity_only).
           pricing_unit = case when type = 'activity'
                                    and nullif(v_final_payload ->> 'pricing_unit', '') is not null
                               then v_final_payload ->> 'pricing_unit'
                               else pricing_unit end,
           min_persons = case when v_final_payload ? 'min_persons'
                              then nullif(v_final_payload ->> 'min_persons', '')::int
                              else min_persons end,
           max_persons = case when v_final_payload ? 'max_persons'
                              then nullif(v_final_payload ->> 'max_persons', '')::int
                              else max_persons end,
           check_in_time = nullif(v_final_payload ->> 'check_in_time', '')::time,
           check_out_time = nullif(v_final_payload ->> 'check_out_time', '')::time,
           capacity = nullif(v_final_payload ->> 'capacity', '')::int,
           unit_count = nullif(v_final_payload ->> 'unit_count', '')::int,
           lodging_kind = nullif(v_final_payload ->> 'lodging_kind', ''),
           unit = nullif(v_final_payload ->> 'unit', ''),
           -- 20261013212500 : (1) jamais pour un evento — son aforo est un réglage admin, et le
           -- null du payload corrigé faisait échouer l'approbation sur
           -- products_evento_capacity_mode_requires_capacity ; (2) forme GARDÉE (`?`) pour les
           -- autres : une proposition qui ne porte pas la clé (déposée avant cette migration pour
           -- un logement) ne vide plus le cupo par défaut.
           default_capacity = case when type = 'evento' then default_capacity
                                   when v_final_payload ? 'default_capacity'
                                   then nullif(v_final_payload ->> 'default_capacity', '')::int
                                   else default_capacity end,
           stay_rates = v_final_payload -> 'stay_rates',
           -- Ajout de cette migration (20260914140000) : forme GARDÉE (`?`), même raisonnement que
           -- external_booking_url/price_label juste en dessous — une proposition `pending` créée
           -- AVANT cette migration ne porte pas ces 2 clés ; une écriture inconditionnelle
           -- effacerait un group_discount déjà posé sur le produit au moment de l'approuver.
           group_discount_threshold_qty = case when v_final_payload ? 'group_discount_threshold_qty'
                                               then nullif(v_final_payload ->> 'group_discount_threshold_qty', '')::int
                                               else group_discount_threshold_qty end,
           group_discount_pct = case when v_final_payload ? 'group_discount_pct'
                                     then nullif(v_final_payload ->> 'group_discount_pct', '')::numeric
                                     else group_discount_pct end,
           -- Ajout de cette migration (20260916140000) : GARDÉE comme ses voisines (une proposition
           -- `pending` créée avant cette migration ne porte pas la clé, une écriture
           -- inconditionnelle effacerait le programme posé entre-temps sur le produit), et en plus
           -- NORMALISÉE pour la même raison qu'à l'insert de create_product_from_proposal — sans
           -- quoi une proposition portant {"program": null} ferait échouer l'approbation sur le
           -- CHECK products_program_is_array au lieu d'effacer le programme comme demandé.
           program = case when v_final_payload ? 'program'
                          then case when jsonb_typeof(v_final_payload -> 'program') = 'array'
                                    then v_final_payload -> 'program'
                                    else null end
                          else program end,
           -- 2026-09-09 : sans ces deux colonnes, une proposition qui portait enfin une URL de
           -- vitrine était approuvée SANS elle — la whitelist élargie n'aurait servi à rien.
           -- ⚠️ Forme volontairement différente des lignes ci-dessus (`case when ... ?` plutôt
           -- qu'une écriture inconditionnelle) : une proposition `pending` créée AVANT cette
           -- migration ne porte pas ces clés, et l'écriture inconditionnelle EFFACERAIT l'URL déjà
           -- posée sur le produit au moment de l'approuver. `?` distingue « clé absente » (garder
           -- l'existant) de « clé présente à null » (effacer volontairement) — ce que `->>` seul ne
           -- permet pas. Les autres colonnes ont ce défaut ; on ne le reproduit pas ici.
           external_booking_url = case when v_final_payload ? 'external_booking_url'
                                       then nullif(v_final_payload ->> 'external_booking_url', '')
                                       else external_booking_url end,
           -- 20261013212500 : un evento réservable en ligne n'a jamais de libellé de prix libre
           -- (price_cop fait foi, « jamais les deux en même temps ») — une proposition n'en pose pas.
           price_label = case when online_bookable then price_label
                              when v_final_payload ? 'price_label'
                              then nullif(v_final_payload ->> 'price_label', '')
                              else price_label end,
           -- 2026-09-16 (transport informatif) : forme GARDÉE (`?`), jamais l'écriture
           -- inconditionnelle des lignes address/lat/lon plus haut. Une proposition `pending`
           -- créée AVANT cette migration ne porte pas ces 9 clés, et `->>` seul ne distingue pas
           -- « clé absente » (garder l'existant) de « clé présente à null » (effacer
           -- volontairement) : l'écriture inconditionnelle EFFACERAIT des horaires déjà posés au
           -- moment d'approuver une simple correction de nom.
           transport_first_departure_time = case when v_final_payload ? 'transport_first_departure_time'
                                       then nullif(v_final_payload ->> 'transport_first_departure_time', '')::time
                                       else transport_first_departure_time end,
           transport_last_departure_time = case when v_final_payload ? 'transport_last_departure_time'
                                       then nullif(v_final_payload ->> 'transport_last_departure_time', '')::time
                                       else transport_last_departure_time end,
           transport_seats_per_departure = case when v_final_payload ? 'transport_seats_per_departure'
                                       then nullif(v_final_payload ->> 'transport_seats_per_departure', '')::int
                                       else transport_seats_per_departure end,
           transport_departure_address = case when v_final_payload ? 'transport_departure_address'
                                       then nullif(v_final_payload ->> 'transport_departure_address', '')
                                       else transport_departure_address end,
           transport_departure_lat = case when v_final_payload ? 'transport_departure_lat'
                                       then nullif(v_final_payload ->> 'transport_departure_lat', '')::double precision
                                       else transport_departure_lat end,
           transport_departure_lon = case when v_final_payload ? 'transport_departure_lon'
                                       then nullif(v_final_payload ->> 'transport_departure_lon', '')::double precision
                                       else transport_departure_lon end,
           transport_arrival_address = case when v_final_payload ? 'transport_arrival_address'
                                       then nullif(v_final_payload ->> 'transport_arrival_address', '')
                                       else transport_arrival_address end,
           transport_arrival_lat = case when v_final_payload ? 'transport_arrival_lat'
                                       then nullif(v_final_payload ->> 'transport_arrival_lat', '')::double precision
                                       else transport_arrival_lat end,
           transport_arrival_lon = case when v_final_payload ? 'transport_arrival_lon'
                                       then nullif(v_final_payload ->> 'transport_arrival_lon', '')::double precision
                                       else transport_arrival_lon end,
           transport_contact_phone = case when v_final_payload ? 'transport_contact_phone'
                                       then nullif(v_final_payload ->> 'transport_contact_phone', '')
                                       else transport_contact_phone end,
           -- 20261013212500 : QUAND un evento a lieu. Forme GARDÉE (`?`) comme ses voisines — une
           -- proposition déposée avant cette migration ne porte pas ces clés et ne doit rien
           -- effacer — et réservée au type evento : le payload corrigé par l'admin ne repasse pas
           -- par la whitelist du dépôt. La date et le type d'occurrence ne s'EFFACENT jamais (un
           -- evento sans date disparaît des listes) : une valeur vide garde l'existant.
           -- Si l'evento porte des réservations en cours, le trigger products_capacity_flags_frozen
           -- refuse le changement de date ou de récurrence (voir plus bas dans cette migration).
           occurrence_type = case when type = 'evento'
                                   and nullif(v_final_payload ->> 'occurrence_type', '') is not null
                                  then v_final_payload ->> 'occurrence_type'
                                  else occurrence_type end,
           occurrence_date = case when type = 'evento'
                                   and nullif(v_final_payload ->> 'occurrence_date', '') is not null
                                  then (v_final_payload ->> 'occurrence_date')::date
                                  else occurrence_date end,
           recurrence_frequency_days = case when type = 'evento' and v_final_payload ? 'recurrence_frequency_days'
                                            then nullif(v_final_payload ->> 'recurrence_frequency_days', '')::int
                                            else recurrence_frequency_days end,
           recurrence_end_date = case when type = 'evento' and v_final_payload ? 'recurrence_end_date'
                                      then nullif(v_final_payload ->> 'recurrence_end_date', '')::date
                                      else recurrence_end_date end,
           recurrence_end_count = case when type = 'evento' and v_final_payload ? 'recurrence_end_count'
                                       then nullif(v_final_payload ->> 'recurrence_end_count', '')::int
                                       else recurrence_end_count end,
           start_time = case when type = 'evento' and v_final_payload ? 'start_time'
                             then nullif(v_final_payload ->> 'start_time', '')::time
                             else start_time end,
           duration_minutes = case when type = 'evento' and v_final_payload ? 'duration_minutes'
                                   then nullif(v_final_payload ->> 'duration_minutes', '')::int
                                   else duration_minutes end,
           updated_at = now()
     where id = v_proposal.product_id;

    -- 20261013212500 : un evento à cupo compté dont la date vient de changer n'a aucune ligne de
    -- disponibilité à sa nouvelle date — il serait invendable jusqu'à ce qu'un admin rouvre sa
    -- fiche. Même geste que l'édition admin directe (product-form.tsx). Idempotent
    -- (`on conflict do nothing`), aucun décrément : pas une opération critique au sens de §4.1.
    if exists (
      select 1 from public.products p
       where p.id = v_proposal.product_id and p.type = 'evento' and p.evento_capacity_mode = 'metered'
    ) then
      perform public.provision_evento_availability(v_proposal.product_id);
    end if;

    -- Ajout de cette migration (20261013144848) : étiquettes. Forme GARDÉE comme ses voisines —
    -- une proposition sans la clé (déposée avant cette migration, ou qui ne touche pas aux
    -- étiquettes) ne retire RIEN. Quand la clé est là, l'ensemble est REMPLACÉ : on retire ce qui
    -- n'est plus proposé, on ajoute ce qui manque. La jointure sur catalog_tags écarte une
    -- étiquette supprimée entre le dépôt et l'approbation, qui ferait sinon échouer l'approbation
    -- sur la clé étrangère.
    if jsonb_typeof(v_final_payload -> 'tag_ids') = 'array' then
      delete from public.product_tag_assignments a
       where a.product_id = v_proposal.product_id
         and not ((v_final_payload -> 'tag_ids') ? a.tag_id::text);

      insert into public.product_tag_assignments (product_id, tag_id)
      select v_proposal.product_id, t.id
        from public.catalog_tags t
       where (v_final_payload -> 'tag_ids') ? t.id::text
      on conflict do nothing;

      -- 20261025100000 : l'ORDRE du tableau fait foi — la première étiquette est la principale,
      -- celle qui classe la carte dans la vitrine. Les étiquettes déjà posées y prennent leur rang,
      -- les nouvelles (ajoutées en fin de liste par le déclencheur juste au-dessus) aussi.
      update public.product_tag_assignments a
         set position = o.rang
        from unnest(public.catalog_tag_ids_in_order(v_final_payload -> 'tag_ids'))
             with ordinality as o(tag_id, rang)
       where a.product_id = v_proposal.product_id
         and a.tag_id = o.tag_id;
    end if;

    -- Ajout de cette migration (20261013151206) : équipements, même forme gardée que les étiquettes
    -- ci-dessus (sans la clé, rien n'est retiré). Réservés aux logements : le payload corrigé par
    -- l'admin ne repasse pas par la whitelist du dépôt, d'où la relecture du type ici.
    if jsonb_typeof(v_final_payload -> 'amenity_ids') = 'array'
       and exists (select 1 from public.products p
                    where p.id = v_proposal.product_id and p.type = 'lodging') then
      delete from public.product_amenity_assignments a
       where a.product_id = v_proposal.product_id
         and not ((v_final_payload -> 'amenity_ids') ? a.amenity_id::text);

      insert into public.product_amenity_assignments (product_id, amenity_id)
      select v_proposal.product_id, c.id
        from public.catalog_amenities c
       where (v_final_payload -> 'amenity_ids') ? c.id::text
      on conflict do nothing;
    end if;

    update public.product_proposals
       set status = 'approved', payload = v_final_payload, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('product_proposal.approve', 'products', v_proposal.product_id,
      null, v_final_payload, null);
  else
    update public.product_proposals
       set status = 'rejected', rejection_reason = p_rejection_reason, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('product_proposal.reject', 'product_proposals', p_proposal_id,
      null, null, p_rejection_reason);
  end if;

  -- Spec 23 §0/§7 — notification partenaire du verdict, isolée (§8.1). Requête séparée (v_proposal
  -- ne porte pas submitted_by) plutôt qu'élargir le select ci-dessus.
  begin
    select submitted_by into v_submitted_by from public.product_proposals where id = p_proposal_id;
    select email into v_submitted_by_email from auth.users where id = v_submitted_by;
    -- Migration 20261002160349 : v_entity_name ne sert qu'au corps HTML, échappé dès l'affectation ;
    -- le motif, stocké brut, est échappé à l'interpolation (html_text).
    v_entity_name := coalesce(public.html_text(v_proposal.payload -> 'name' ->> 'es'), 'Producto sin nombre');

    if p_decision = 'approve' then
      v_subject := 'Tu propuesta fue aprobada';
      v_body := '<p>Tu propuesta para "' || v_entity_name || '" fue aprobada.</p>';
    else
      v_subject := 'Tu propuesta fue rechazada';
      v_body := '<p>Tu propuesta para "' || v_entity_name || '" fue rechazada.</p>'
        || '<p>Motivo: ' || coalesce(public.html_text(p_rejection_reason), '') || '</p>';
    end if;

    perform public.enqueue_notification_email(
      'partner_proposal_decided', v_submitted_by_email, v_submitted_by, v_subject, v_body,
      'product_proposals', p_proposal_id
    );
  exception
    when query_canceled then
      raise warning 'moderate_product_proposal: notification annulée (query_canceled) pour % — %', p_proposal_id, sqlerrm;
    when others then
      raise warning 'moderate_product_proposal: échec notification pour % — %', p_proposal_id, sqlerrm;
  end;

  return jsonb_build_object('ok', true, 'product_id', v_new_product_id);
end;
$function$;

-- ================================================================================================
-- 6. Agenda et détail prestataire : une colonne de retour de plus — drop puis create
-- ================================================================================================

drop function public.partner_agenda_order_lines(date, date);

CREATE OR REPLACE FUNCTION public.partner_agenda_order_lines(p_date_from date, p_date_to date)
 RETURNS TABLE(id uuid, date date, end_date date, slot_start_time time without time zone, qty integer, status text, holder_name text, product_id uuid, product_name jsonb, product_type text, product_duration_days integer, pricing_unit text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return query
  select
    ol.id, ol.date, ol.end_date, ol.slot_start_time, ol.qty, ol.status, ol.holder_name,
    p.id, p.name, p.type, p.duration_days,
    -- Migration 20261025140000 (spec 43) : un bloc de qty heures pour une ligne à l'heure.
    ol.pricing_unit
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  where public.has_capability(auth.uid(), 'operator', p.establishment_id)
    and ol.date >= p_date_from
    and ol.date <= p_date_to
    and ol.status = any(array['reserved', 'fulfilled', 'no_show'])
    -- Migration 20261024120000 : une ligne `reserved` d'une commande qui attend encore son paiement tient
    -- seulement la place — ce n'est pas une réservation confirmée (`order_awaits_payment`).
    and not (ol.status = 'reserved' and public.order_awaits_payment(ol.order_id));
end;
$function$;

revoke all on function public.partner_agenda_order_lines(date, date) from public, anon;
grant execute on function public.partner_agenda_order_lines(date, date) to authenticated, service_role;

drop function public.partner_reservation_detail(uuid);

CREATE OR REPLACE FUNCTION public.partner_reservation_detail(p_order_line_id uuid)
 RETURNS TABLE(id uuid, date date, end_date date, slot_start_time time without time zone, qty integer, status text, holder_name text, holder_phone text, holder_email text, total_cop bigint, created_at timestamp with time zone, product_name jsonb, product_type text, establishment_name jsonb, pricing_unit text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return query
  select
    ol.id, ol.date, ol.end_date, ol.slot_start_time, ol.qty, ol.status,
    ol.holder_name,
    case when public.line_never_paid(ol.id) then null else ol.holder_phone end,
    case when public.line_never_paid(ol.id) then null else ol.holder_email end,
    ol.total_cop, ol.created_at,
    p.name, p.type, e.name,
    -- Migration 20261025140000 (spec 43) : « 3 h » plutôt que « 3 pers. ».
    ol.pricing_unit
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  where ol.id = p_order_line_id
    and public.has_capability(auth.uid(), 'operator', p.establishment_id)
    -- Migration 20261024120000 : une ligne masquée de la liste l'est aussi ici — ouverte par un lien
    -- direct, elle répond comme une ligne introuvable (aucune ligne), jamais comme une réservation.
    and not (ol.status = 'reserved' and public.order_awaits_payment(ol.order_id));
end;
$function$;

revoke all on function public.partner_reservation_detail(uuid) from public, anon;
grant execute on function public.partner_reservation_detail(uuid) to authenticated, service_role;

-- Fin. Prouvé par supabase/tests/database/activity_pricing_unit.test.sql et
-- tests/concurrency/create_order_per_hour.concurrency.mjs.
