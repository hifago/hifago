-- Lobby avant paiement : un claim par commande avant d'appeler LobbyPMS, l'enregistrement de chaque
-- booking sous ce claim, aucun paiement tant qu'une nuit PMS n'a pas son booking, et jamais une
-- commande payée défaite par un refus Lobby.
--
-- CADRE (CLAUDE.md §4.1). La capacité d'un logement PMS-backed est chez LobbyPMS, pas en base : la
-- décision ne peut pas tenir dans une seule transaction. C'est le patron claim → appel externe →
-- enregistrement déjà validé par la spec 39 (claim_orders_to_reconcile / reconcile_order) et la
-- spec 25 (claim_pms_cancellation_batch / resolve_pms_cancellation). Trois invariants le bornent :
--   I1 — au plus un booking par order_line : le claim sérialise les appelants (bail de 5 min), et
--        record_pms_booking n'écrit que sur une ligne sans booking ; tout booking surnuméraire part
--        en file d'annulation, jamais perdu (LobbyPMS n'a ni clé d'idempotence ni recherche).
--   I2 — aucun paiement sans booking : create_payment_intent refuse pms_booking_missing tant
--        qu'une nuit PMS-backed `reserved` n'a pas son booking.
--   I3 — jamais dé-payer : release_order_after_pms_refusal refuse une commande payée, le claim
--        aussi.
--
-- ORDRE DES VERROUS (.claude/rules/supabase.md règle 8 : `orders` d'abord, toujours) :
--   claim_order_for_pms_booking  : orders → order_lines candidates (order by id) ; establishments
--                                  lus sous le verrou de la commande, sans verrou propre ;
--   record_pms_booking           : orders → la ligne → (trigger d'annulation) ;
--   release_pms_reserve_claim    : orders ;
--   create_payment_intent        : orders → payments (inchangé) ;
--   release_order_after_pms_refusal : orders → order_lines (inchangé).
-- Aucune de ces fonctions ne tient un verrou pendant l'appel à LobbyPMS : chacune est sa propre
-- transaction, appelée par /api/pms/reserve-nights (service_role).
--
-- create_payment_intent et release_order_after_pms_refusal : corps extraits par pg_get_functiondef
-- depuis la définition vivante (20260909190000, 20260921100000), signatures INCHANGÉES
-- (.claude/rules/supabase.md règle 7), remplacements comptés (chacun à un seul site).

alter table public.orders add column pms_reserve_claimed_at timestamptz;
comment on column public.orders.pms_reserve_claimed_at is
  'Claim de réservation Lobby en cours (bail de 5 min) — posé par claim_order_for_pms_booking, '
  'renvoyé comme jeton et repassé à record_pms_booking / release_pms_reserve_claim.';

-- Un seul intent en attente par commande : jusqu'ici l'unicité ne tenait qu'au `for update` sur
-- orders de create_payment_intent. 0 doublon en local au moment de l'écrire — à recompter en
-- préprod avant le push.
create unique index payments_one_pending_per_order on public.payments (order_id) where status = 'pending';

create function public.claim_order_for_pms_booking(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_groups jsonb;
  v_claimed_at timestamptz;
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

  -- I3 : une commande payée n'est jamais re-réservée par cette voie (ni dé-payée plus loin).
  if v_order.payment_status in ('paid', 'partially_refunded', 'refunded') then
    return jsonb_build_object('ok', false, 'reason', 'order_paid');
  end if;

  -- Bail de 5 minutes (décision du 2026-09-30) : une commande à N nuits enchaîne N appels Lobby de
  -- 15 s au plus ; un second appelant pendant ce temps re-réserverait les mêmes nuits.
  if v_order.pms_reserve_claimed_at is not null
     and v_order.pms_reserve_claimed_at > now() - interval '5 minutes' then
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
$$;

create function public.record_pms_booking(
  p_order_id uuid,
  p_claimed_at timestamptz,
  p_order_line_id uuid,
  p_pms_booking_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed_at timestamptz;
  v_line record;
  v_reason text;
  v_queue_status text;
begin
  if p_order_id is null or p_order_line_id is null or nullif(btrim(p_pms_booking_id), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_arguments');
  end if;

  -- Règle 8 : `orders` d'abord (on écrit une ligne fille et on peut enfiler).
  select o.pms_reserve_claimed_at into v_claimed_at
    from public.orders o
   where o.id = p_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  select ol.status, ol.pms_booking_id, ol.end_date, p.establishment_id
    into v_line
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = p_order_line_id and ol.order_id = p_order_id
   for update of ol;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'line_not_found');
  end if;

  if v_line.pms_booking_id = p_pms_booking_id then
    -- Rejeu (réponse perdue) ou activité rattachée au booking principal déjà posé : rien à faire.
    return jsonb_build_object('ok', true, 'idempotent', true);
  elsif v_claimed_at is distinct from p_claimed_at then
    -- Le claim a expiré et un autre appelant a la main : ce booking est surnuméraire.
    v_reason := 'claim_stale';
    v_queue_status := 'superseded';
  elsif v_line.pms_booking_id is not null then
    -- I1 : la ligne porte déjà un AUTRE booking ; celui-ci est un doublon.
    v_reason := 'already_booked';
    v_queue_status := 'superseded';
  elsif v_line.status <> 'reserved' then
    -- La ligne est morte entre le claim et ici (expirée, annulée) : on garde la trace du booking
    -- sur la ligne, puis il part en annulation.
    update public.order_lines set pms_booking_id = p_pms_booking_id where id = p_order_line_id;
    v_reason := 'line_not_reserved';
    v_queue_status := v_line.status;
  else
    update public.order_lines set pms_booking_id = p_pms_booking_id where id = p_order_line_id;
    -- Le miroir de disponibilité doit savoir tout de suite que ces nuits sont prises chez Lobby
    -- (migration 20260918170000) — dans la même transaction, plus en best-effort séparé.
    if v_line.end_date is not null then
      perform public.mark_pms_sync_due_for_order_line(p_order_line_id);
    end if;
    return jsonb_build_object('ok', true);
  end if;

  -- Un booking qu'aucune ligne vivante ne porte part TOUJOURS en file d'annulation, explicitement.
  -- Jamais délégué au seul trigger enqueue_pms_cancellations : il filtre les établissements au
  -- connecteur actif, et un connecteur coupé entre le claim et ici laisserait le booking
  -- orphelin chez Lobby. L'entrée attend alors la réactivation (claim_pms_cancellation_batch ne
  -- prend que les établissements actifs) ; si le trigger l'a déjà posée, l'index partiel absorbe
  -- le doublon.
  insert into public.pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status)
  select p_pms_booking_id, v_line.establishment_id, v_queue_status
   where not exists (
     select 1 from public.order_lines ol
      where ol.pms_booking_id = p_pms_booking_id and ol.status = 'reserved'
   )
  on conflict (pms_booking_id) where status = 'pending' do nothing;

  return jsonb_build_object('ok', false, 'reason', v_reason);
end;
$$;

create function public.release_pms_reserve_claim(p_order_id uuid, p_claimed_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- Seulement SON claim : un claim repris par un autre appelant (bail expiré) n'est jamais effacé.
  update public.orders
     set pms_reserve_claimed_at = null
   where id = p_order_id and pms_reserve_claimed_at = p_claimed_at;

  return jsonb_build_object('ok', true, 'released', found);
end;
$$;

create or replace function public.create_payment_intent(p_order_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_account_id uuid := auth.uid();
  v_order_account_id uuid;
  v_payer_email text;
  v_existing_status text;
  v_existing_payment_id uuid;
  v_existing_amount_cop bigint;
  v_amount_cop bigint;
  v_payment_id uuid;
begin
  select account_id, holder_email into v_order_account_id, v_payer_email
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
      return jsonb_build_object(
        'ok', true, 'payment_id', v_existing_payment_id, 'amount_cop', v_amount_cop,
        'payer_email', v_payer_email, 'reused', true
      );
    end if;
    update public.payments set status = 'cancelled', updated_at = now() where id = v_existing_payment_id;
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

create or replace function public.release_order_after_pms_refusal(p_order_id uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
  -- refus Lobby. Avant : `payment_status = 'unpaid'` inconditionnel plus bas — la commande était
  -- dé-payée, payments restait `approved`, et l'argent devenait invisible. La route garde alors
  -- la commande et l'envoie en réconciliation (chemin « relâchement impossible »).
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

  perform public.apply_order_line_ledger_transition(v_released_ids, 'cancelled_by_provider');

  update public.payments
     set status = 'cancelled', updated_at = now()
   where order_id = p_order_id and status = 'pending';

  update public.orders set payment_status = 'unpaid' where id = p_order_id;

  return jsonb_build_object('ok', true, 'released_lines', array_length(v_released_ids, 1));
end;
$function$;

revoke all on function public.claim_order_for_pms_booking(uuid) from public, anon, authenticated;
grant execute on function public.claim_order_for_pms_booking(uuid) to service_role;
revoke all on function public.record_pms_booking(uuid, timestamptz, uuid, text) from public, anon, authenticated;
grant execute on function public.record_pms_booking(uuid, timestamptz, uuid, text) to service_role;
revoke all on function public.release_pms_reserve_claim(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.release_pms_reserve_claim(uuid, timestamptz) to service_role;
