-- Le ledger admin après l'auto-référence payée (20261112180000) : une commission qui ne se perd plus
-- à la modification d'une ligne, et une liste qui dit À QUI payer et POURQUOI (Jérôme, 2026-11-12 :
-- « que le ledger de l'admin reflète bien tout ça afin que ce soit facile à manœuvrer »).
--
-- 1. modify_order_line : la commission suit la ligne modifiée. CONSTATÉ le 2026-11-12 par exécution
--    sur la base locale (transaction annulée) : ligne auto-référence 100 000 (entrée 8 000
--    'estimated'), modifiée à qty 2 → ancienne ligne 'superseded' avec son entrée 8 000 'estimated'
--    pour toujours, nouvelle ligne 16 000 de commission SANS entrée ; passée 'fulfilled', rien ne
--    devient « A pagar ». Défaut antérieur à l'auto-référence (référent externe touché depuis
--    20260817200000), qu'elle rend plus fréquent : le prestataire modifie ses propres réservations.
--    Extraite par pg_get_functiondef de la base locale, UN ajout compté avant la ligne
--    `update public.pms_reconciliation_entries set order_line_id = v_new_line_id` (même geste :
--    re-pointer ce qui était en cours vers la nouvelle ligne). Signature, droits, verrous et ordre
--    des verrous inchangés (`orders` d'abord, .claude/rules/supabase.md règle 8).
-- 2. Réparation idempotente des entrées déjà orphelines (0 en local le 2026-11-12) : chaque entrée
--    référent 'estimated' d'une ligne 'superseded' suit la chaîne replaces_order_line_id jusqu'à la
--    ligne vivante et prend l'état que la transition lui aurait donné.
-- 3. admin_ledger_entries_list : + bénéficiaire (le partenaire à payer : le référent, ou le
--    partenaire de l'établissement pour une compensation — avant, « — »), concept (type d'entrée,
--    cas de commission, pourcentage figé), commande (id, référence), total de la ligne, date de
--    paiement ; + filtre p_beneficiary_partner_id. Type de retour changé : drop + create (règle 7).
-- 4. admin_ledger_payables : par bénéficiaire, ce qui est « A pagar » maintenant (et l'estimé à
--    venir) — le panneau en tête de /admin/ledger.

select set_config('lock_timeout', '5s', true);

-- ============================================================================================
-- 1. modify_order_line
-- ============================================================================================

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

  -- 20261112190000 : la commission suit la ligne. Avant, l'entrée 'referral_earned' restait
  -- 'estimated' sur la ligne 'superseded' et la nouvelle ligne n'en avait aucune :
  -- apply_order_line_ledger_transition ne trouvait jamais rien à rendre « A pagar », et la
  -- commission (référent externe comme auto-référence) n'était jamais payée. Même geste que la file
  -- PMS juste en dessous : l'entrée est re-pointée vers la nouvelle ligne, au montant recalculé.
  -- Une ligne 'reserved' (seule modifiable) ne porte qu'une entrée 'estimated'. Montant recalculé
  -- nul (aucun cas aujourd'hui : pourcentages recopiés) : l'entrée est annulée, jamais laissée.
  update public.ledger_entries le
     set order_line_id = v_new_line_id,
         amount_cop = nl.referrer_commission_cop
    from public.order_lines nl
   where nl.id = v_new_line_id
     and nl.referrer_commission_cop > 0
     and le.order_line_id = p_order_line_id
     and le.beneficiary_type = 'referrer'
     and le.status = 'estimated';
  update public.ledger_entries
     set status = 'void'
   where order_line_id = p_order_line_id
     and beneficiary_type = 'referrer'
     and status = 'estimated';

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

-- ============================================================================================
-- 2. Réparation des entrées orphelines
-- ============================================================================================
-- Une ligne n'est modifiée qu'une fois ('superseded' n'est plus modifiable) : la chaîne est
-- linéaire. L'état final est celui qu'apply_order_line_ledger_transition aurait posé sur la ligne
-- vivante : 'reserved' → 'estimated', 'fulfilled' → 'due', tout le reste → 'void' (une annulation
-- client payée a déjà créé sa compensation établissement : elle se calcule depuis order_lines, pas
-- depuis l'entrée référent). Rien n'est touché si la ligne vivante porte déjà une entrée référent.

with recursive chain as (
  select le.id as entry_id, ol.id as line_id
    from public.ledger_entries le
    join public.order_lines ol on ol.id = le.order_line_id
   where le.beneficiary_type = 'referrer'
     and le.status = 'estimated'
     and ol.status = 'superseded'
  union all
  select c.entry_id, nl.id
    from chain c
    join public.order_lines nl on nl.replaces_order_line_id = c.line_id
),
terminal as (
  select c.entry_id, ol.id as line_id, ol.status as line_status, ol.referrer_commission_cop
    from chain c
    join public.order_lines ol on ol.id = c.line_id
   where ol.status <> 'superseded'
     and not exists (
       select 1 from public.ledger_entries x
        where x.order_line_id = ol.id and x.beneficiary_type = 'referrer'
     )
)
update public.ledger_entries le
   set order_line_id = t.line_id,
       amount_cop = case when t.referrer_commission_cop > 0 then t.referrer_commission_cop else le.amount_cop end,
       status = case
                  when t.referrer_commission_cop <= 0 then 'void'
                  when t.line_status = 'reserved' then 'estimated'
                  when t.line_status = 'fulfilled' then 'due'
                  else 'void'
                end
  from terminal t
 where le.id = t.entry_id;

-- ============================================================================================
-- 3. admin_ledger_entries_list
-- ============================================================================================
-- Squelette inchangé (20260930211348) ; colonnes ajoutées avant total_count, filtre ajouté en
-- dernier paramètre (les appels nommés existants restent valides).

drop function public.admin_ledger_entries_list(date, date, text, text, uuid, uuid, text, boolean, int, int);

create function public.admin_ledger_entries_list(
  p_date_from date default null,
  p_date_to date default null,
  p_status text default null,
  p_type text default null,
  p_referrer_partner_id uuid default null,
  p_establishment_id uuid default null,
  p_sort_key text default 'created_at',
  p_sort_desc boolean default true,
  p_limit int default 20,
  p_offset int default 0,
  p_beneficiary_partner_id uuid default null
)
returns table (
  id uuid,
  amount_cop bigint,
  status text,
  date date,
  product_type text,
  establishment_name jsonb,
  referrer_display_name text,
  entry_type text,
  commission_case text,
  referrer_pct numeric,
  line_total_cop bigint,
  order_id uuid,
  order_reference text,
  beneficiary_partner_id uuid,
  beneficiary_name text,
  paid_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_ledger_entries_list réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select
    le.id, le.amount_cop, le.status,
    ol.date, p.type, e.name, rp.display_name,
    le.entry_type, ol.commission_case, ol.referrer_pct, ol.total_cop,
    o.id, o.reference,
    bp.id, bp.display_name,
    le.paid_at,
    count(*) over()
  from public.ledger_entries le
  join public.order_lines ol on ol.id = le.order_line_id
  join public.orders o on o.id = ol.order_id
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  left join public.partners rp on rp.id = le.referrer_partner_id
  -- Le bénéficiaire = le partenaire à qui l'argent part : le référent, ou, pour une compensation,
  -- le partenaire de l'établissement compensé (le.establishment_id, jamais le produit).
  left join public.establishments be on be.id = le.establishment_id
  left join public.partners bp on bp.id = coalesce(le.referrer_partner_id, be.partner_id)
  where (p_date_from is null or ol.date >= p_date_from)
    and (p_date_to is null or ol.date <= p_date_to)
    and (p_status is null or le.status = p_status)
    and (p_type is null or p.type = p_type)
    and (p_referrer_partner_id is null or le.referrer_partner_id = p_referrer_partner_id)
    and (p_establishment_id is null or p.establishment_id = p_establishment_id)
    and (p_beneficiary_partner_id is null or bp.id = p_beneficiary_partner_id)
  order by
    case when p_sort_key = 'created_at' and not p_sort_desc then le.created_at end asc nulls last,
    case when p_sort_key = 'created_at' and p_sort_desc then le.created_at end desc nulls last,
    case when p_sort_key = 'status' and not p_sort_desc then le.status end asc nulls last,
    case when p_sort_key = 'status' and p_sort_desc then le.status end desc nulls last,
    case when p_sort_key = 'amount_cop' and not p_sort_desc then le.amount_cop end asc nulls last,
    case when p_sort_key = 'amount_cop' and p_sort_desc then le.amount_cop end desc nulls last
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.admin_ledger_entries_list(date, date, text, text, uuid, uuid, text, boolean, int, int, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_ledger_entries_list(date, date, text, text, uuid, uuid, text, boolean, int, int, uuid)
  to authenticated;

-- ============================================================================================
-- 4. admin_ledger_payables
-- ============================================================================================
-- Une ligne par partenaire à qui au moins une entrée est « A pagar » : combien d'entrées, combien,
-- et ce qui est encore estimé (prestation pas encore réalisée). Somme en SQL sur tout le ledger,
-- jamais sur la page affichée.

create function public.admin_ledger_payables()
returns table (
  beneficiary_partner_id uuid,
  beneficiary_name text,
  due_count bigint,
  due_cop bigint,
  estimated_cop bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_ledger_payables réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select
    bp.id, bp.display_name,
    count(*) filter (where le.status = 'due'),
    coalesce(sum(le.amount_cop) filter (where le.status = 'due'), 0)::bigint,
    coalesce(sum(le.amount_cop) filter (where le.status = 'estimated'), 0)::bigint
  from public.ledger_entries le
  left join public.establishments be on be.id = le.establishment_id
  join public.partners bp on bp.id = coalesce(le.referrer_partner_id, be.partner_id)
  where le.status in ('due', 'estimated')
  group by bp.id, bp.display_name
  having count(*) filter (where le.status = 'due') > 0
  order by 4 desc, bp.display_name;
end;
$$;

revoke all on function public.admin_ledger_payables() from public, anon, authenticated;
grant execute on function public.admin_ledger_payables() to authenticated;
