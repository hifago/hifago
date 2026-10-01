-- Échéance de paiement : create_payment_intent ET claim_order_for_pms_booking refusent
-- `order_expiring` quand il est trop tard pour payer.
--
-- CONSTAT. La limite de paiement d'une commande est created_at + 28 min : passé ce point,
-- /api/payments/create refuse `order_expiring` et la préférence Mercado Pago (expiration_date_to)
-- est morte. Mais la commande n'expire en base qu'après created_at + 32 min (reconcile_order :
-- 30 min + marge de 2 min, au premier passage du cron payments-reconcile */2), et jamais tant que
-- ce job est en panne ou Mercado Pago injoignable — expire_stale_payment_orders n'existe plus
-- (20260921100100). Entre les deux :
--   - create_payment_intent créait un `payments` pending et passait orders.payment_status à
--     'pending' avant le refus de payments/create : l'écran rechargé disait « Estamos confirmando
--     tu pago », sans bouton, pour une commande condamnée ;
--   - claim_order_for_pms_booking laissait la reprise (OrderResult → /api/pms/reserve-nights)
--     poser chez LobbyPMS un vrai booking impayable, resté chez le partenaire jusqu'à l'expiration.
--
-- CORRECTIF.
--   - public.order_payment_deadline(created_at) : la limite, en un seul endroit côté SQL (STABLE :
--     timestamptz + interval l'est, une colonne générée est donc impossible). Ses deux copies hors
--     SQL — apps/web/lib/mercadopago/client.ts (30 − 2) et supabase/functions/payments-reconcile
--     (PREFERENCE_LIFETIME_MS) — sont comparées par scripts/check-payment-deadline.sh (npm run verify).
--   - create_payment_intent : `order_expiring` dès now() >= limite s'il reste une ligne vivante,
--     après `already_paid`, avant `pms_booking_missing` et la réutilisation d'un pending — aucun
--     `payments`, payment_status intact. Une commande déjà morte garde `nothing_to_pay`.
--   - claim_order_for_pms_booking : `order_expiring` dès now() + bail (5 min) >= limite, soit
--     23 min après la création (décision du 2026-10-01) : un claim ne survit jamais à la limite de
--     paiement. Après `order_paid`, le bail (`claim_in_progress`) et `order_not_active`, avant
--     `pms_unavailable` (trop tard pour payer, la commande expirera : ce refus ne la relâche pas en
--     `cancelled_by_provider`) ; rien n'est posé. La durée du bail devient une constante de la fonction, lue par les deux gardes.
--
-- VERROUS : inchangés (orders d'abord, .claude/rules/supabase.md règle 8) ; created_at est lu par
-- le même `select … for update` sur orders que chaque fonction prenait déjà.
--
-- Les deux redéfinitions partent de pg_get_functiondef (règle 7), remplacements comptés ;
-- signatures et grants inchangés.

create function public.order_payment_deadline(p_created_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select p_created_at + interval '28 minutes'
$$;

comment on function public.order_payment_deadline(timestamptz) is
  'Limite de paiement d''une commande : 28 min après orders.created_at. Même valeur que '
  'ORDER_EXPIRY_MINUTES − PREFERENCE_EXPIRY_MARGIN_MINUTES (apps/web/lib/mercadopago/client.ts) et '
  'PREFERENCE_LIFETIME_MS (supabase/functions/payments-reconcile/index.ts) ; '
  'scripts/check-payment-deadline.sh compare les trois.';

revoke all on function public.order_payment_deadline(timestamptz) from public, anon, authenticated;
grant execute on function public.order_payment_deadline(timestamptz) to service_role;

CREATE OR REPLACE FUNCTION public.create_payment_intent(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_order_account_id uuid;
  v_payer_email text;
  v_existing_status text;
  v_existing_payment_id uuid;
  v_existing_amount_cop bigint;
  v_amount_cop bigint;
  v_payment_id uuid;
  v_order_created_at timestamptz;
begin
  select account_id, holder_email, created_at into v_order_account_id, v_payer_email, v_order_created_at
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- 2026-09-09 — CORRECTIF DE SÉCURITÉ. La condition `v_account_id is not null and` a été RETIRÉE :
  -- elle désarmait la garde pour tout appelant SANS session. Prouvé en réel sous le rôle `anon`
  -- sans aucun JWT, sur la commande d'un autre compte : retour {"ok": true, "amount_cop": 45000,
  -- "payer_email": "<email du titulaire>"} — donc fuite de PII, écriture d'une ligne `payments`
  -- 'pending' et bascule de `orders.payment_status` sur la commande d'autrui, plus un déni de
  -- service (l'idempotence `payment_already_pending` empêchait ensuite le VRAI titulaire de créer
  -- son intent). Le test pgTAP couvrait « un autre compte AUTHENTIFIÉ » (cas 5) et passait : c'est
  -- le cas sans session qui n'était testé nulle part (CLAUDE.md §11.20). Cas 5bis ajouté.
  --
  -- `is distinct from` traite NULL correctement : appelant sans session (v_account_id null) sur une
  -- commande qui A un propriétaire → distinct → refusé. Ce qui reste ouvert, DÉLIBÉRÉMENT et sans
  -- changement : une commande INVITÉ (v_order_account_id null) reste payable par le porteur de son
  -- order_id — c'est le parcours invité d'aujourd'hui (CheckoutForm appelle cette RPC depuis le
  -- navigateur juste après create_order). L'identité anonyme refermera ce dernier cas d'elle-même :
  -- toute commande portera alors un account_id.
  if v_order_account_id is not null and v_order_account_id is distinct from v_account_id then
    -- Même réponse qu'une commande inexistante, jamais un refus distinct qui confirmerait
    -- l'existence d'une commande d'un autre compte (même logique que cancel_order).
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  select id, status, amount_cop into v_existing_payment_id, v_existing_status, v_existing_amount_cop
    from public.payments
   where order_id = p_order_id and status in ('pending', 'approved')
   order by created_at desc
   limit 1
   for update;

  if v_existing_status = 'approved' then
    return jsonb_build_object('ok', false, 'reason', 'already_paid');
  end if;

  -- Échéance de paiement (migration 20261001194704) : passé `public.order_payment_deadline`
  -- (28 min après la création), payments/create refuse `order_expiring` et la préférence
  -- Mercado Pago est morte.
  -- Refusé ICI, avant tout `payments` et avant `pms_booking_missing` : sinon un `pending` était créé
  -- et `orders.payment_status` basculé (l'écran disait « confirmando tu pago » sur une commande
  -- condamnée), et la reprise rappelait Lobby pour un booking qu'on ne pourrait plus payer. Une
  -- commande déjà morte (expirée, annulée) garde sa réponse d'avant, `nothing_to_pay`.
  if now() >= public.order_payment_deadline(v_order_created_at)
     and exists (select 1 from public.order_lines where order_id = p_order_id and status = 'reserved') then
    return jsonb_build_object('ok', false, 'reason', 'order_expiring');
  end if;

  -- Ajout de la migration 20260930221837 (CLAUDE.md §4.4, I2) : aucun paiement tant qu'une
  -- nuit PMS-backed n'a pas son booking Lobby. Même prédicat qu'isPmsBacked et que create_order
  -- (20260929112240). Une activité liée à Lobby sans booking ne bloque pas : Lobby refuse une vente
  -- de service isolée, c'est une limite connue, pas un manque de réservation.
  if exists (
    select 1
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
     where ol.order_id = p_order_id
       and ol.status = 'reserved'
       and ol.pms_booking_id is null
       and p.type = 'lodging' and p.lobby_category_id is not null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'pms_booking_missing');
  end if;

  -- Seulement les lignes ENCORE actives (status = 'reserved') : une ligne déjà superseded par
  -- modify_order_line, ou déjà annulée/expirée, ne doit jamais gonfler l'acompte demandé — même
  -- discipline que cancel_order (« seulement les lignes ENCORE actives »).
  select coalesce(sum(acompte_cop), 0) into v_amount_cop
    from public.order_lines
   where order_id = p_order_id and status = 'reserved';

  if v_amount_cop <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_pay');
  end if;

  -- Ajout de la migration 20260930221837 : un intent `pending` ne bloque plus le client. Même
  -- montant → le même payment (la préférence Mercado Pago est rejouée par son idempotencyKey =
  -- payment_id, apps/web/lib/mercadopago/client.ts) ; montant changé (une ligne annulée
  -- entre-temps) → l'ancien est annulé et un nouveau est créé. Un `approved` tardif sur l'ancien
  -- tombe dans la garde existante paid_after_expiry → refund_required. Avant :
  -- payment_already_pending sans payment_id, et un seul 503 de Mercado Pago bloquait la
  -- réservation jusqu'à son expiration.
  if v_existing_status = 'pending' then
    if v_existing_amount_cop = v_amount_cop then
      update public.orders set payment_status = 'pending' where id = p_order_id;
      return jsonb_build_object(
        'ok', true, 'payment_id', v_existing_payment_id, 'amount_cop', v_amount_cop,
        'payer_email', v_payer_email, 'reused', true
      );
    end if;
    -- Tous les pending de la commande, pas seulement le dernier : un ancien paiement redevenu
    -- `pending` (retentative Checkout Pro) ne doit pas survivre à l'ancien montant.
    update public.payments set status = 'cancelled', updated_at = now()
     where order_id = p_order_id and status = 'pending';
  end if;

  insert into public.payments (order_id, amount_cop, payer_email)
  values (p_order_id, v_amount_cop, v_payer_email)
  returning id into v_payment_id;

  update public.orders set payment_status = 'pending' where id = p_order_id;

  return jsonb_build_object(
    'ok', true, 'payment_id', v_payment_id, 'amount_cop', v_amount_cop, 'payer_email', v_payer_email
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_order_for_pms_booking(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order record;
  v_groups jsonb;
  v_claimed_at timestamptz;
  -- Durée du bail, lue par le bail ET par l'échéance (un claim ne survit jamais à la limite de
  -- paiement).
  c_bail constant interval := interval '5 minutes';
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- Règle 8 : `orders` d'abord.
  select o.payment_status, o.pms_reserve_claimed_at, o.attribution_code, o.attribution_source, o.created_at
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- I3 : une commande payée n'est jamais re-réservée par cette voie (ni dé-payée plus loin).
  if v_order.payment_status in ('paid', 'partially_refunded', 'refunded') then
    return jsonb_build_object('ok', false, 'reason', 'order_paid');
  end if;

  -- Bail de 5 minutes (décision du 2026-09-30) : une commande à N nuits enchaîne N appels Lobby de
  -- 15 s au plus ; un second appelant pendant ce temps re-réserverait les mêmes nuits.
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

  -- Plus aucune ligne vivante (commande relâchée, expirée, annulée) : ce n'est pas « rien à
  -- réserver », c'est une commande morte — jamais un succès renvoyé au tunnel.
  if not exists (
    select 1 from public.order_lines ol where ol.order_id = p_order_id and ol.status = 'reserved'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'order_not_active');
  end if;

  -- Échéance de paiement (migration 20261001194704) : un claim ne survit jamais à la limite de
  -- paiement (`public.order_payment_deadline`, 28 min après la création). Passé limite − bail
  -- (23 min), une reprise poserait chez Lobby un vrai booking avec de moins en moins de temps pour
  -- le payer (plus aucun passé 28 min), resté chez le partenaire jusqu'à l'expiration (32 à 34 min,
  -- jamais si le job de réconciliation est en panne).
  -- Rien n'est posé. Placée APRÈS le bail (un claim vivant d'un autre onglet répond
  -- claim_in_progress : sa reprise peut encore rendre la commande payable) et après
  -- order_not_active (une commande morte le reste), mais AVANT pms_unavailable : trop tard pour
  -- payer, la commande expirera de toute façon, sans que ce refus la relâche en
  -- `cancelled_by_provider`.
  if now() + c_bail >= public.order_payment_deadline(v_order.created_at) then
    return jsonb_build_object('ok', false, 'reason', 'order_expiring');
  end if;

  -- CLAUDE.md §4.4 : un logement PMS-backed n'a aucun contrôle de capacité local — Lobby est le
  -- seul. Connecteur coupé ou sans jeton (même prédicat que create_order, 20260929112240, relu ici
  -- SOUS le verrou de la commande) → refus, rien n'est posé.
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

  -- Ce que la route doit réserver, groupé par établissement actif : les nuits PMS-backed (une
  -- réservation Lobby chacune) et les activités/transports liés à un produit Lobby (rattachés à la
  -- première réservation obtenue). Une activité d'un établissement coupé est ignorée, comme avant.
  select coalesce(jsonb_agg(g.grp order by g.establishment_id), '[]'::jsonb)
    into v_groups
    from (
      select e.id as establishment_id,
             jsonb_build_object(
               'establishment_id', e.id,
               'api_token', e.lobby_api_token,
               'lodging_lines', coalesce(jsonb_agg(jsonb_build_object(
                   'id', ol.id, 'product_id', ol.product_id, 'date', ol.date, 'end_date', ol.end_date,
                   'qty', ol.qty, 'holder_name', ol.holder_name, 'holder_email', ol.holder_email,
                   'holder_phone', ol.holder_phone, 'total_cop', ol.total_cop,
                   'lobby_category_id', p.lobby_category_id
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

  update public.orders
     set pms_reserve_claimed_at = now()
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
