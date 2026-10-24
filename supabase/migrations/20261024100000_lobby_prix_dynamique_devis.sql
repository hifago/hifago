-- Prix Lobby dynamique (bug 3, campagne du 2026-10-23) — le schéma : devis, interrupteur, ventilation
-- par nuit, prix du miroir. create_order et cart_lines_availability suivent dans 20261024110000.
--
-- POURQUOI. Le prix d'une nuit Lobby était toujours le prix fixe hifago (product_date_rates,
-- price_tiers). Gabriel l'a constaté en production le 2026-10-23 : le prix ne variait ni avec les
-- dates ni avec le nombre de personnes. Le cahier client §5 (validé par Jérôme le 2026-08-11) et la
-- v1 vendaient au prix Lobby, sans marge ; la commission est une PART du total (§3b), jamais une
-- majoration. La spec 24 §0 (« le prix ne vient jamais de Lobby ») est révisée dans la même branche.
--
-- LE FLUX.
--   1. /pago (apps/web/lib/pms/quoteCart.ts) lit Lobby À CHAUD, par établissement et par plage, et
--      enregistre un DEVIS par ligne de panier : record_pms_cart_quotes (service_role seul) ;
--   2. create_order (20261024110000) exige, pour une ligne Lobby d'un établissement à l'interrupteur
--      allumé, un devis de moins de 15 min, mêmes produit et dates ; facture Σ des nuits du devis ;
--      fige la ventilation dans order_lines.pms_nightly_unit_prices ;
--   3. pms-book-paid-orders envoie ces prix à Lobby nuit par nuit (claim_paid_order_for_pms_booking
--      les relit, bookClaimedOrder.ts) ; repli au partage égal pour une ligne ancienne.
-- La capacité réelle reste tenue par check-nights / hold_pms_nights (20261023120000) : le devis ne
-- sert qu'à refuser tôt une quantité que Lobby ne cote plus (qty ≤ min_available_cupos), sans verrou.
--
-- L'INTERRUPTEUR establishments.lobby_dynamic_pricing — allumé ici pour tout établissement relié à
-- Lobby, connecteur actif OU seulement configuré (jeton posé). Le connecteur de Casa Kayam est coupé
-- en production : l'allumer « si actif » seulement l'aurait laissé éteint, et sa réactivation aurait
-- rendu les prix fixes. Tant que le connecteur reste coupé, create_order refuse de toute façon la
-- ligne (pms_unavailable) : rien ne change. RETOUR ARRIÈRE, une ligne :
--   update public.establishments set lobby_dynamic_pricing = false;
--
-- Grants : toute fonction neuve est fermée à public, anon et authenticated ; record_pms_cart_quotes
-- ouverte à service_role seul ; pms_quote_unit_sum, helper interne, à personne.
-- service_role_only_functions.test.sql les nomme.

select set_config('lock_timeout', '5s', true);

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 1. L'interrupteur
-- ════════════════════════════════════════════════════════════════════════════════════════════
alter table public.establishments add column lobby_dynamic_pricing boolean not null default false;
comment on column public.establishments.lobby_dynamic_pricing is
  'Prix public = prix LobbyPMS (migration 20261024100000) : vrai, une ligne Lobby se facture au devis lu à chaud sur /pago (create_order exige le devis) ; faux, au prix fixe hifago (product_date_rates, price_tiers). Retour arrière : update public.establishments set lobby_dynamic_pricing = false.';
-- establishments n'a pas de grant SELECT global (lobby_api_token) : la fiche et le panier lisent la
-- colonne avec la clé publique ou la session du client.
grant select (lobby_dynamic_pricing) on public.establishments to anon, authenticated;

update public.establishments
   set lobby_dynamic_pricing = true
 where lobby_connector_active or lobby_api_token is not null;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 2. La ventilation par nuit d'une ligne, et les prix du miroir
-- ════════════════════════════════════════════════════════════════════════════════════════════
alter table public.order_lines add column pms_nightly_unit_prices jsonb
  check (pms_nightly_unit_prices is null or jsonb_typeof(pms_nightly_unit_prices) = 'array');
comment on column public.order_lines.pms_nightly_unit_prices is
  'Ventilation figée par create_order depuis le devis Lobby (migration 20261024110000) : [{date, unit_price_cop}], une entrée par nuit, prix d''UNE unité. price_cop = Σ unit_price_cop, total_cop = price_cop × qty. Null pour une ligne au prix fixe ou antérieure : pms-book-paid-orders partage alors le total également entre les nuits.';

alter table public.pms_availability_mirror add column prices jsonb;
comment on column public.pms_availability_mirror.prices is
  'Prix Lobby par occupation pour cette nuit, {"<people>": cop} du plan STANDARD_RATE (sinon le premier plan coté) — migration 20261024100000. AFFICHAGE seulement (fiche, panier) : le prix facturé vient du devis lu à chaud sur /pago (pms_cart_quotes).';
-- Le commentaire SQL de 20260917140000 (« dorm ⇒ unités × capacité ») est périmé depuis le correctif
-- du 2026-10-23 : une unité Lobby vaut un cupo (pmsUnitsToCupos). Rectifié ici, sur la colonne.
comment on column public.pms_availability_mirror.available_units is
  'Unités libres chez Lobby pour cette catégorie et cette nuit. Une unité Lobby = un cupo hifago (pmsUnitsToCupos, facteur 1 depuis le 2026-10-23) : une catégorie partagée compte déjà des lits.';

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 3. Le devis d'une ligne de panier — RPC-only (CLAUDE.md §3.1 : capacité et prix facturé)
-- ════════════════════════════════════════════════════════════════════════════════════════════
create table public.pms_cart_quotes (
  cart_item_id uuid primary key references public.cart_items(id) on delete cascade,
  account_id uuid not null references public.partner_accounts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  date date not null,
  end_date date not null,
  -- [{date, unit_price_cop}] : une entrée par nuit, arrivée incluse, départ exclu (pms_quote_unit_sum).
  nightly_unit_prices jsonb not null,
  -- Minimum, sur les nuits, des places libres lues chez Lobby (une unité = un cupo).
  min_available_cupos int not null check (min_available_cupos >= 0),
  quoted_at timestamptz not null default now(),
  check (end_date > date)
);
comment on table public.pms_cart_quotes is
  'Devis Lobby d''une ligne de panier, lu à chaud sur /pago et écrit par record_pms_cart_quotes (service_role). create_order l''exige pour une ligne Lobby à prix dynamique : même produit, mêmes dates, moins de 15 min. Effacé avec la ligne de panier (create_order vide le panier).';
alter table public.pms_cart_quotes enable row level security;
-- Aucune policy : ni lecture ni écriture directe pour un client.
revoke all on table public.pms_cart_quotes from anon, authenticated;

-- Σ des prix d'une unité si la ventilation couvre EXACTEMENT les nuits [p_date, p_end_date), dans
-- l'ordre, chaque prix entier > 0 ; null sinon. La même règle pour l'écriture du devis, create_order
-- et cart_lines_availability — un devis incomplet ne peut jamais facturer un séjour partiel.
create function public.pms_quote_unit_sum(p_nightly jsonb, p_date date, p_end_date date)
returns bigint
language sql
stable
set search_path = ''
as $$
  with n as (
    select e, i::int as i
      from jsonb_array_elements(case when jsonb_typeof(p_nightly) = 'array' then p_nightly else '[]'::jsonb end)
           with ordinality as t(e, i)
  ), checked as (
    select n.i,
           case when jsonb_typeof(n.e->'unit_price_cop') = 'number' then (n.e->'unit_price_cop')::numeric end as price,
           case when n.e->>'date' ~ '^\d{4}-\d{2}-\d{2}$' then (n.e->>'date')::date end as night
      from n
  )
  select case
           when p_date is null or p_end_date is null or p_end_date <= p_date then null
           when (select count(*) from checked) <> p_end_date - p_date then null
           when exists (
             select 1 from checked
              where price is null or price <= 0 or price <> trunc(price)
                 or night is distinct from p_date + (i - 1)
           ) then null
           else (select sum(price)::bigint from checked)
         end;
$$;
revoke all on function public.pms_quote_unit_sum(jsonb, date, date) from public, anon, authenticated;

-- Enregistre les devis d'un compte. Appelée par apps/web/lib/pms/quoteCart.ts (service_role), avec le
-- compte de la session vérifiée côté serveur — jamais un identifiant envoyé par le client. Un devis
-- n'est écrit que pour une ligne de panier DE CE COMPTE, aux mêmes produit et dates, à la ventilation
-- complète ; tout autre est compté rejeté. Pas une RPC critique au sens de CLAUDE.md §4.1 : rien
-- n'est décrémenté, rien n'est réservé.
create function public.record_pms_cart_quotes(p_account_id uuid, p_quotes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote jsonb;
  v_recorded int := 0;
  v_rejected int := 0;
begin
  if p_account_id is null or jsonb_typeof(p_quotes) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  for v_quote in select elem from jsonb_array_elements(p_quotes) as t(elem) loop
    declare
      v_cart_item_id uuid;
      v_product_id uuid;
      v_date date;
      v_end_date date;
      v_min int;
    begin
      begin
        v_cart_item_id := (v_quote->>'cart_item_id')::uuid;
        v_product_id := (v_quote->>'product_id')::uuid;
        v_date := (v_quote->>'date')::date;
        v_end_date := (v_quote->>'end_date')::date;
        v_min := (v_quote->>'min_available_cupos')::int;
      exception when others then
        v_rejected := v_rejected + 1;
        continue;
      end;

      if v_cart_item_id is null or v_min is null or v_min < 0
         or public.pms_quote_unit_sum(v_quote->'nightly_unit_prices', v_date, v_end_date) is null
         or not exists (
           select 1 from public.cart_items ci
            where ci.id = v_cart_item_id
              and ci.account_id = p_account_id
              and ci.product_id = v_product_id
              and ci.date = v_date
              and ci.end_date = v_end_date
         ) then
        v_rejected := v_rejected + 1;
        continue;
      end if;

      insert into public.pms_cart_quotes (
        cart_item_id, account_id, product_id, date, end_date, nightly_unit_prices, min_available_cupos, quoted_at
      )
      values (
        v_cart_item_id, p_account_id, v_product_id, v_date, v_end_date, v_quote->'nightly_unit_prices', v_min, now()
      )
      on conflict (cart_item_id) do update
        set account_id = excluded.account_id,
            product_id = excluded.product_id,
            date = excluded.date,
            end_date = excluded.end_date,
            nightly_unit_prices = excluded.nightly_unit_prices,
            min_available_cupos = excluded.min_available_cupos,
            quoted_at = excluded.quoted_at;
      v_recorded := v_recorded + 1;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'recorded', v_recorded, 'rejected', v_rejected);
end;
$$;
revoke all on function public.record_pms_cart_quotes(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_pms_cart_quotes(uuid, jsonb) to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 4. sync_pms_availability_month — redéfinie depuis la vivante (pg_get_functiondef), un
--    remplacement compté : la colonne `prices` du miroir.
-- ════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.sync_pms_availability_month(p_establishment_id uuid, p_month text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := now();
  v_debut date;
  v_fin date;
  v_ecrites int;
  v_retirees int;
begin
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_month');
  end if;

  v_debut := (p_month || '-01')::date;
  v_fin := (v_debut + interval '1 month')::date;

  -- Migration 20261004005336 : l'établissement AVANT pms_sync_state, comme record_pms_booking (qui le
  -- tient en partage puis invalide le mois) et le remplacement du jeton (qui le tient puis attend
  -- les lignes d'un booking, dont le poll invalide le mois). Pris en dernier, il fermait un
  -- cycle avec l'un ou l'autre : interblocage.
  update public.establishments set lobby_last_synced_at = v_now where id = p_establishment_id;

  delete from public.pms_availability_mirror
   where establishment_id = p_establishment_id
     and date >= v_debut and date < v_fin;
  get diagnostics v_retirees = row_count;

  insert into public.pms_availability_mirror as m (
    establishment_id, lobby_category_id, date, available_units, min_stay, max_stay, lead_days, prices, synced_at
  )
  select p_establishment_id,
         (r->>'category_id')::int,
         (r->>'date')::date,
         greatest((r->>'available_units')::int, 0),
         nullif(r->>'min_stay', '')::int,
         nullif(r->>'max_stay', '')::int,
         nullif(r->>'lead_days', '')::int,
         -- Migration 20261024100000 : les prix Lobby par occupation (`MirrorRow.prices`), pour
         -- l'affichage seulement. Une Edge Function encore à l'ancienne version n'en envoie pas : null.
         case when jsonb_typeof(r->'prices') = 'object' then r->'prices' end,
         v_now
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
   where (r->>'date')::date >= v_debut and (r->>'date')::date < v_fin
   on conflict do nothing;
  get diagnostics v_ecrites = row_count;

  delete from public.pms_availability_mirror
   where establishment_id = p_establishment_id
     and date < public.today_in_bogota();

  insert into public.pms_sync_state as st (establishment_id, month, synced_at, attempts, last_error, next_attempt_at)
  values (p_establishment_id, p_month, v_now, 0, null, null)
  on conflict on constraint pms_sync_state_pkey
  do update set synced_at = v_now, attempts = 0, last_error = null, next_attempt_at = null;


  return jsonb_build_object('ok', true, 'written', v_ecrites, 'removed', v_retirees);
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 5. claim_paid_order_for_pms_booking — redéfinie depuis la vivante (20261023150000), un remplacement
--    compté : chaque ligne de nuit porte pms_nightly_unit_prices (bookClaimedOrder.ts envoie les prix
--    à Lobby nuit par nuit). Contrat inchangé pour le reste : une clé de plus dans lodging_lines.
-- ════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.claim_paid_order_for_pms_booking(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order record;
  v_groups jsonb;
  v_claimed_at timestamptz;
  -- Migration 20261023150000 : la nuit dont un POST /bookings précédent n'a pas d'issue connue.
  v_unresolved_line_id uuid;
  -- Durée du bail, la même que claim_order_for_pms_booking : une commande à N nuits enchaîne N
  -- appels Lobby de 15 s au plus.
  c_bail constant interval := interval '5 minutes';
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- Règle 8 : `orders` d'abord.
  select o.payment_status, o.pms_reserve_claimed_at, o.attribution_code, o.attribution_source
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- L'inverse d'I3 : cette voie ne réserve QUE des commandes payées (remboursée, rejetée, partiellement
  -- remboursée : plus rien à réserver automatiquement).
  if v_order.payment_status <> 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'order_not_paid');
  end if;

  -- Bail de 5 minutes : deux passages (trigger immédiat et cron) ne réservent jamais la même
  -- commande ensemble — LobbyPMS n'a ni clé d'idempotence ni recherche de booking.
  if v_order.pms_reserve_claimed_at is not null
     and v_order.pms_reserve_claimed_at > now() - c_bail then
    return jsonb_build_object('ok', false, 'reason', 'claim_in_progress');
  end if;

  -- Puis les lignes à réserver, dans un ordre stable.
  perform 1
    from public.order_lines ol
   where ol.order_id = p_order_id
     and ol.status = 'reserved'
     and ol.pms_booking_id is null
   order by ol.id
   for update;

  -- Plus aucune ligne vivante (toutes annulées après le paiement) : rien à réserver, jamais un
  -- succès « vide » qui passerait pour une confirmation.
  if not exists (
    select 1 from public.order_lines ol where ol.order_id = p_order_id and ol.status = 'reserved'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'order_not_active');
  end if;

  -- Migration 20261023150000 : une nuit PMS dont un POST /bookings précédent n'a JAMAIS eu d'issue
  -- connue (marqueur posé par mark_pms_booking_attempt, jamais effacé, aucun booking enregistré) : le
  -- booking existe PEUT-ÊTRE chez Lobby. Jamais rendue, la commande jamais rejouée — refus AVANT le
  -- bail ; pms-book-paid-orders en fait un needs_human (entrée de réconciliation sur cette ligne).
  -- Lu après le bail : sous un bail vivant, le marqueur est une tentative EN COURS.
  select ol.id into v_unresolved_line_id
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.order_id = p_order_id
     and ol.status = 'reserved'
     and ol.pms_booking_id is null
     and ol.pms_attempt_started_at is not null
     and p.type = 'lodging' and p.lobby_category_id is not null
   order by ol.date, ol.id
   limit 1;
  if v_unresolved_line_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'attempt_unresolved', 'order_line_id', v_unresolved_line_id);
  end if;

  -- Aucune échéance de paiement ici (claim_order_for_pms_booking en a une) : la commande est payée.

  -- Les établissements des lignes à réserver, en `for share`, AVANT de lire leur jeton (migration
  -- 20261004005336) : un remplacement de jeton en cours est attendu, le jeton relu après lui.
  -- Ordre : orders → lignes → établissements, comme claim_order_for_pms_booking.
  perform 1
    from public.establishments e
   where e.id in (
     select p.establishment_id
       from public.order_lines ol
       join public.products p on p.id = ol.product_id
      where ol.order_id = p_order_id
        and ol.status = 'reserved'
        and ol.pms_booking_id is null
   )
   order by e.id
   for share;

  -- CLAUDE.md §4.4 : connecteur coupé ou sans jeton → refus, rien n'est posé.
  if exists (
    select 1
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
      join public.establishments e on e.id = p.establishment_id
     where ol.order_id = p_order_id
       and ol.status = 'reserved'
       and ol.pms_booking_id is null
       and p.type = 'lodging' and p.lobby_category_id is not null
       and (not e.lobby_connector_active or e.lobby_api_token is null)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'pms_unavailable');
  end if;

  select coalesce(jsonb_agg(g.grp order by g.establishment_id), '[]'::jsonb)
    into v_groups
    from (
      select e.id as establishment_id,
             jsonb_build_object(
               'establishment_id', e.id,
               'api_token', e.lobby_api_token,
               'primary_booking_id', (
                 select b.pms_booking_id
                   from public.order_lines b
                   join public.products bp on bp.id = b.product_id
                  where b.order_id = p_order_id
                    and b.status = 'reserved'
                    and b.pms_booking_id is not null
                    and bp.type = 'lodging' and bp.lobby_category_id is not null
                    and bp.establishment_id = e.id
                  order by b.date, b.id
                  limit 1
               ),
               'lodging_lines', coalesce(jsonb_agg(jsonb_build_object(
                   'id', ol.id, 'product_id', ol.product_id, 'date', ol.date, 'end_date', ol.end_date,
                   'qty', ol.qty, 'holder_name', ol.holder_name, 'holder_email', ol.holder_email,
                   'holder_phone', ol.holder_phone, 'total_cop', ol.total_cop,
                   'acompte_cop', ol.acompte_cop,
                   'pms_nightly_unit_prices', ol.pms_nightly_unit_prices,
                   'lobby_category_id', p.lobby_category_id,
                   'lodging_kind', p.lodging_kind, 'unit', p.unit, 'capacity', p.capacity
                 ) order by ol.id) filter (where p.type = 'lodging'), '[]'::jsonb),
               'activity_lines', coalesce(jsonb_agg(jsonb_build_object(
                   'id', ol.id, 'product_id', ol.product_id, 'qty', ol.qty,
                   'lobby_product_id', p.lobby_product_id
                 ) order by ol.id) filter (where p.type <> 'lodging'), '[]'::jsonb)
             ) as grp
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        join public.establishments e on e.id = p.establishment_id
       where ol.order_id = p_order_id
         and ol.status = 'reserved'
         and ol.pms_booking_id is null
         and e.lobby_connector_active
         and e.lobby_api_token is not null
         and ((p.type = 'lodging' and p.lobby_category_id is not null)
              or (p.type in ('activity', 'transport') and p.lobby_product_id is not null))
       group by e.id, e.lobby_api_token
    ) g;

  if jsonb_array_length(v_groups) = 0 then
    return jsonb_build_object('ok', true, 'claimed_at', null, 'groups', v_groups);
  end if;

  -- Jamais antérieur à l'époque des jetons lus (migration 20261004005336).
  update public.orders
     set pms_reserve_claimed_at = greatest(now(), (
           select max(e.lobby_token_changed_at) + interval '1 microsecond'
             from public.establishments e
            where e.id in (select (g ->> 'establishment_id')::uuid from jsonb_array_elements(v_groups) g)
         ))
   where id = p_order_id
  returning pms_reserve_claimed_at into v_claimed_at;

  return jsonb_build_object(
    'ok', true,
    'claimed_at', v_claimed_at,
    'attribution_code', v_order.attribution_code,
    'attribution_source', v_order.attribution_source,
    'groups', v_groups
  );
end;
$function$;
