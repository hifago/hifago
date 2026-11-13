-- Frais Mercado Pago déduits de l'option 17 %, « Pagar todo » par bénéficiaire, état de commission
-- lu dans le vrai ledger (Jérôme, 2026-11-12, en réponse aux trois points laissés ouverts par
-- 20261112190000 : « on déduit les frais », « oui je veux ce bouton et on règle le problème »).
--
-- 1. FRAIS MERCADO PAGO (révise spec 19 §10 point 10 pour ce seul cas). Avec l'option « reverser
--    les 17 % » (partner_self_referral_rebates, ligne 17/17/0), Hifago reversait tout l'acompte
--    mais payait la commission Mercado Pago dessus : une perte nette par ligne. Désormais, à
--    l'approbation du paiement, la part des frais de la ligne passe de la part prestataire à la
--    part app (17/17/0 → 17/(17−f)/f) : order_lines.mp_fee_cop (nouvelle colonne) dit combien.
--    Tout le reste suit sans autre changement, parce que tout lit referrer_commission_cop : l'entrée
--    'referral_earned' (montant net), la compensation A3 d'une annulation client payée
--    (apply_order_line_ledger_transition), « Mis comisiones », l'e-mail « Nueva comisión asignada »
--    (envoyé APRÈS la déduction) et les totaux du tableau de bord. Les pourcentages figés (17 % / 0)
--    ne bougent pas : ils disent le barème, mp_fee_cop dit la déduction.
--    - Le montant vient de Mercado Pago lui-même : `fee_details` de la réponse GET /v1/payments
--      (commission + cuotas absorbées par Hifago, jamais une retenue fiscale), aplati en
--      `mp_fee_cop` par toPaymentEvent (packages/domain, partagé par le webhook et le job
--      payments-reconcile). Illisible ou absent (paiement simulé du mode mock compris) : rien
--      n'est déduit, plutôt qu'un montant inventé.
--    - Répartition : la part d'une ligne = frais × acompte de la ligne / montant du paiement,
--      plafonnée à sa part référent. Seules les lignes où Hifago ne garde rien (app_pct = 0) sont
--      concernées : sur une ligne 8/9, les frais restent absorbés par la part app, comme avant.
--    - apply_payment_webhook (extraite par pg_get_functiondef, UN ajout compté) appelle
--      apply_mp_fee_to_full_rebate_lines juste après `payment_status = 'paid'`, donc sous les
--      verrous déjà pris (`orders` puis `payments`, règle 8) et avant les e-mails.
--    - modify_order_line (UN ajout compté) : les frais déjà retenus suivent la nouvelle ligne —
--      payés une fois, ils ne changent pas avec la modification. Avant l'ajout, la nouvelle ligne
--      repartait à 17/17/0 et la déduction était perdue.
--    - notify_order_confirmed (UN remplacement compté) : la ligne d'auto-recomendación de l'e-mail
--      dit « − comisión Mercado Pago $X » à côté du pourcentage.
--    Aucune ligne existante à reprendre : l'option 17 % date de 20261112180000, jamais envoyée en
--    préprod ni en prod.
-- 2. « PAGAR TODO » : mark_partner_ledger_entries_paid règle en une fois les entrées « A pagar »
--    d'un bénéficiaire. Elle reçoit la liste EXACTE des entrées affichées et leur total : sous
--    verrou, toutes doivent être encore 'due', appartenir à ce bénéficiaire et totaliser ce montant
--    — sinon rien n'est marqué (l'admin a viré un montant précis ; une entrée arrivée entre-temps
--    reste « A pagar » pour la fois suivante). Journal admin par entrée, comme mark_ledger_entry_paid.
--    admin_ledger_payables rend en plus le compte Mercado Pago du bénéficiaire (où virer).
-- 3. ÉTAT DE COMMISSION de la fiche commande admin : admin_order_line_ledger rend les entrées
--    réelles de chaque ligne (commission : montant et statut ; compensation : montant et statut) et
--    mp_fee_cop. Avant, l'écran DÉDUISAIT l'état du statut de la ligne : jamais « Pagada », et
--    « Redistribuido » pour une ligne expirée ou une annulation sans paiement, alors qu'aucune
--    compensation n'existait.
-- 4. admin_ledger_entries_list et partner_commissions_list rendent mp_fee_cop (le ledger admin et
--    « Mis comisiones » disent pourquoi 17 % ne font pas 17 %). Types de retour changés : drop +
--    create (règle 7).

select set_config('lock_timeout', '5s', true);

-- ============================================================================================
-- 1a. order_lines.mp_fee_cop
-- ============================================================================================

alter table public.order_lines
  add column mp_fee_cop bigint,
  add constraint order_lines_mp_fee_cop_non_negative check (mp_fee_cop is null or mp_fee_cop >= 0);

comment on column public.order_lines.mp_fee_cop is
  'Frais Mercado Pago retenus sur la part référent d''une ligne où Hifago ne garde rien (option « reverser les 17 % ») et passés à la part app, posés à l''approbation du paiement par apply_mp_fee_to_full_rebate_lines (20261112200000). NULL = aucune déduction.';

-- ============================================================================================
-- 1b. apply_mp_fee_to_full_rebate_lines — interne, appelée par apply_payment_webhook
-- ============================================================================================

create function public.apply_mp_fee_to_full_rebate_lines(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_amount_cop bigint;
  v_fee numeric;
begin
  -- Appelée sous les verrous d'apply_payment_webhook (`orders`, puis `payments`) : rien à
  -- verrouiller de plus haut. Le montant est relu dans l'événement que la fonction vient de poser.
  select p.order_id, p.amount_cop,
         case when jsonb_typeof(p.raw_last_event -> 'mp_fee_cop') = 'number'
              then (p.raw_last_event ->> 'mp_fee_cop')::numeric end
    into v_order_id, v_amount_cop, v_fee
    from public.payments p
   where p.id = p_payment_id;

  if v_fee is null or v_fee <= 0 or v_amount_cop is null or v_amount_cop <= 0 then
    return;
  end if;

  -- `mp_fee_cop is null` : une seule déduction par ligne, même si un approved était rejoué.
  update public.order_lines ol
     set mp_fee_cop = s.fee_cop,
         referrer_commission_cop = ol.referrer_commission_cop - s.fee_cop,
         app_commission_cop = ol.app_commission_cop + s.fee_cop
    from (
      select l.id,
             least(l.referrer_commission_cop, round(v_fee * l.acompte_cop / v_amount_cop))::bigint as fee_cop
        from public.order_lines l
       where l.order_id = v_order_id
         and l.status = 'reserved'
         and l.app_pct = 0
         and l.referrer_commission_cop > 0
         and l.mp_fee_cop is null
    ) s
   where ol.id = s.id
     and s.fee_cop > 0;

  -- L'entrée de commission prend le montant net (encore 'estimated' : la prestation n'a pas eu
  -- lieu). Frais ≥ commission (aucun cas réel : quelques % de l'acompte) : l'entrée est annulée,
  -- jamais laissée à un montant que la contrainte amount_cop > 0 refuserait.
  update public.ledger_entries le
     set amount_cop = ol.referrer_commission_cop
    from public.order_lines ol
   where le.order_line_id = ol.id
     and ol.order_id = v_order_id
     and ol.mp_fee_cop > 0
     and ol.referrer_commission_cop > 0
     and le.beneficiary_type = 'referrer'
     and le.status = 'estimated';
  update public.ledger_entries le
     set status = 'void'
    from public.order_lines ol
   where le.order_line_id = ol.id
     and ol.order_id = v_order_id
     and ol.mp_fee_cop > 0
     and ol.referrer_commission_cop = 0
     and le.beneficiary_type = 'referrer'
     and le.status = 'estimated';
end;
$$;

comment on function public.apply_mp_fee_to_full_rebate_lines(uuid) is
  'Interne (apply_payment_webhook) : déduit les frais Mercado Pago du paiement (raw_last_event.mp_fee_cop) de la part référent des lignes où Hifago ne garde rien (option 17 %), au prorata de l''acompte, et ajuste l''entrée de commission. Idempotente (mp_fee_cop is null). 20261112200000.';

revoke all on function public.apply_mp_fee_to_full_rebate_lines(uuid) from public, anon, authenticated;

-- ============================================================================================
-- 1c. apply_payment_webhook — un ajout compté (extraction pg_get_functiondef)
-- ============================================================================================

CREATE OR REPLACE FUNCTION public.apply_payment_webhook(p_mp_payment_id text, p_external_reference uuid, p_status text, p_raw_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payment record;
  -- Migration 20261023120000 : v_order, v_referrer_account, v_owner_account, v_order_summary, v_site_url et
  -- v_contacts sont partis avec les e-mails dans notify_order_confirmed.
  -- Ajout 20260920120000 (durcissement) :
  v_order_id uuid;
  v_has_honorable_line boolean;
  v_other_approved_payment_id uuid;
  v_refund_code text;
  v_refund_reason text;
  -- Ajout 20261002185102 :
  v_prior_refund_code text;
begin
  if p_status not in ('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back') then
    raise exception 'statut de paiement Mercado Pago inconnu : %', p_status;
  end if;

  -- (1) ORDRE DES VERROUS : `orders` d'abord, toujours (cf. en-tête) — lecture non verrouillante de
  -- la commande, verrou sur `orders`, PUIS verrou sur `payments`, dont le statut est relu après.
  select order_id into v_order_id
    from public.payments
   where id = p_external_reference;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  perform 1 from public.orders where id = v_order_id for update;

  select id, order_id, status, mp_payment_id, created_at into v_payment
    from public.payments
   where id = p_external_reference
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  -- Idempotent par construction : un webhook dupliqué ou reçu hors-ordre après approbation est un
  -- no-op — Mercado Pago retente un webhook qui ne renvoie pas 2xx, un no-op DOIT donc renvoyer
  -- ok:true (jamais une erreur), sans quoi le Route Handler entrerait en boucle de retry infinie.
  -- (6) Lot B — `refunded`/`charged_back` (20260921100000). Jusqu'ici le mapper les envoyait sur
  -- `cancelled` : une commande PAYÉE redevenait `unpaid`, lignes toujours `reserved`. Trois cas :
  -- déjà remboursé → no-op ; NOTRE remboursement (payment_refunds vivant, B2) → no-op, jamais une
  -- entrée ; externe (panel MP, contracargo) → entrée `refunded_externally` pour l'admin, et les
  -- statuts ne bougent QUE si ce paiement MP est celui qui a payé la commande. Jamais `unpaid`.
  if p_status in ('refunded', 'charged_back') then
    if v_payment.status in ('refunded', 'charged_back') then
      return jsonb_build_object('ok', true, 'reason', 'already_refunded');
    end if;
    if exists (
      select 1 from public.payment_refunds r
       where r.mp_payment_id = p_mp_payment_id and r.status in ('pending', 'approved')
    ) then
      return jsonb_build_object('ok', true, 'reason', 'own_refund');
    end if;
    insert into public.payment_reconciliation_entries (
      payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code
    )
    values (
      v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event,
      case when p_status = 'charged_back'
           then 'contracargo (charged_back) reçu de Mercado Pago — litige à documenter'
           else 'remboursement effectué hors hifago (panel Mercado Pago)' end,
      'refunded_externally',
      case when p_status = 'charged_back' then 'charged_back' else 'refunded_externally' end
    )
    on conflict (mp_payment_id) where kind = 'refunded_externally' do nothing;

    if v_payment.status = 'approved' and v_payment.mp_payment_id = p_mp_payment_id then
      update public.payments
         set status = p_status, raw_last_event = p_raw_event, updated_at = now()
       where id = v_payment.id;
      update public.orders set payment_status = 'refunded' where id = v_payment.order_id;
    end if;
    return jsonb_build_object('ok', true, 'reason', p_status);
  end if;

  if v_payment.status = 'approved' then
    -- (7) Lot B — double paiement sur le MÊME external_reference : le client a payé deux fois dans
    -- la même session Checkout Pro (m1 puis m2 sous P1). Sans ceci, m2 tombait dans
    -- `already_applied` et l'argent en double restait invisible.
    if p_status = 'approved'
       and v_payment.mp_payment_id is not null
       and v_payment.mp_payment_id <> p_mp_payment_id then
      insert into public.payment_reconciliation_entries (
        payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code
      )
      values (
        v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event,
        'double paiement : ce paiement Mercado Pago double le paiement ' || v_payment.mp_payment_id
          || ' déjà appliqué à la commande',
        'refund_required', 'double_payment'
      )
      on conflict (mp_payment_id) where kind = 'refund_required' do nothing;
      return jsonb_build_object('ok', true, 'reason', 'double_payment');
    end if;
    return jsonb_build_object('ok', true, 'reason', 'already_applied');
  end if;

  -- (5) Un paiement `cancelled` (par le cron d'expiration) ne bouge plus, sauf pour un `approved`
  -- qui est traité par la garde (2) ci-dessous : un `pending` PSE tardif, un `rejected` en retard
  -- ne ressuscitent jamais une commande morte.
  if v_payment.status = 'cancelled' and p_status <> 'approved' then
    return jsonb_build_object('ok', true, 'reason', 'already_cancelled');
  end if;

  -- (2) GARDE « RIEN À HONORER » — cf. en-tête, points (a) (b) (c).
  if p_status = 'approved' then
    -- Migration 20261002185102 — UNE DÉCISION DE REMBOURSEMENT EST DÉFINITIVE par paiement Mercado Pago.
    -- Le job de réconciliation rejoue l'`approved` tant que la commande n'est pas payée, et l'état
    -- qui a fondé le refus peut changer entre-temps (un booking Lobby posé après un refus I2).
    -- Appliquer alors un paiement dont l'admin a déjà la demande de remboursement ferait payer ET
    -- rembourser la même commande.
    select e.reason_code into v_prior_refund_code
      from public.payment_reconciliation_entries e
     where e.mp_payment_id = p_mp_payment_id and e.kind = 'refund_required';
    if found then
      return jsonb_build_object('ok', true, 'reason', v_prior_refund_code);
    end if;

    select exists (
      select 1 from public.order_lines ol
       where ol.order_id = v_payment.order_id
         and ol.status in ('reserved', 'fulfilled', 'no_show')
    ) into v_has_honorable_line;

    select id into v_other_approved_payment_id
      from public.payments
     where order_id = v_payment.order_id
       and status = 'approved'
       and id <> v_payment.id
     limit 1;

    if v_other_approved_payment_id is not null then
      v_refund_code := 'double_payment';
      v_refund_reason := 'double paiement : la commande est déjà payée par le paiement '
        || v_other_approved_payment_id;
    -- Migration 20261002185102 — INTENT REMPLACÉ : create_payment_intent annule le pending quand le
    -- montant de la commande change et en crée un nouveau ; l'ancien onglet Checkout Pro peut encore
    -- payer l'ancien. La commande VIT (une ligne à honorer) et un intent plus récent existe : ce
    -- n'est pas un paiement « après expiration » (texte client faux), c'est un intent remplacé — à
    -- rembourser, comme avant (paid_after_expiry). Un `cancelled` venu de Mercado Pago suivi d'un
    -- nouvel intent tombe aussi ici. Sans intent plus récent : paid_after_expiry, comme avant.
    elsif v_payment.status = 'cancelled' and v_has_honorable_line
                   and exists (
                     select 1 from public.payments newer
                      where newer.order_id = v_payment.order_id and newer.id <> v_payment.id
                        and newer.created_at > v_payment.created_at
                   ) then
      v_refund_code := 'superseded_intent';
      v_refund_reason := 'paiement approuvé sur un intent remplacé par un intent plus récent — '
        || 'rien n''est appliqué, remboursement à traiter';
    elsif v_payment.status = 'cancelled' or not v_has_honorable_line then
      v_refund_code := 'paid_after_expiry';
      v_refund_reason := case
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'expired')
          then 'paiement approuvé après expiration de la commande'
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'cancelled_by_client')
          then 'paiement approuvé après annulation par le client'
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'cancelled_by_provider')
          then 'paiement approuvé après annulation par le prestataire'
        else 'paiement approuvé sans aucune prestation à honorer'
      end;
    -- Migration 20261023120000 : la garde I2 du webhook (pms_booking_missing, 20261002185102) est RETIRÉE.
    -- L'alternative qu'elle laissait ouverte, « appliquer, puis réserver chez Lobby », est retenue
    -- (décision du 2026-10-23, Lobby après l'acompte) : une nuit PMS sans booking est l'état normal
    -- d'une commande qui vient d'être payée — tenue par hold_pms_nights, elle est réservée par
    -- pms-book-paid-orders (demande posée plus bas). Un refus de Lobby part en réconciliation
    -- « commande PAYÉE », jamais en remboursement automatique.
    end if;

    if v_refund_code is not null then
      -- L'argent est chez Mercado Pago : on garde de quoi le rembourser (identifiant MP, événement
      -- brut), sans jamais toucher au statut du paiement ni à celui de la commande.
      update public.payments
         set mp_payment_id = p_mp_payment_id, raw_last_event = p_raw_event, updated_at = now()
       where id = v_payment.id;

      -- (3) Une seule entrée par paiement Mercado Pago, quel que soit le nombre de livraisons.
      insert into public.payment_reconciliation_entries (
        payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code
      )
      values (
        v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event, v_refund_reason,
        'refund_required', v_refund_code
      )
      on conflict (mp_payment_id) where kind = 'refund_required' do nothing;

      return jsonb_build_object('ok', true, 'reason', v_refund_code);
    end if;
  end if;

  -- Migration 20261002185102 — JAMAIS RÉTROGRADER VERS `pending` un paiement qui ne l'est plus quand un
  -- AUTRE intent de la commande est déjà `pending` (retentative dans l'ancienne session Checkout
  -- Pro après un nouvel intent) : l'index payments_one_pending_per_order le refuserait (23505 →
  -- webhook en échec, retenté sans fin), et ce paiement-là n'est plus celui que le client doit
  -- régler. Décidé sous le verrou de la commande (1), comme dans create_payment_intent : ce sont
  -- les deux seuls écrivains d'un `pending`.
  if p_status = 'pending' and v_payment.status <> 'pending' and exists (
    select 1 from public.payments other
     where other.order_id = v_payment.order_id and other.id <> v_payment.id and other.status = 'pending'
  ) then
    return jsonb_build_object('ok', true, 'reason', 'other_intent_pending');
  end if;

  update public.payments
     set status = p_status, mp_payment_id = p_mp_payment_id, raw_last_event = p_raw_event, updated_at = now()
   where id = v_payment.id;

  if p_status = 'approved' then
    update public.orders set payment_status = 'paid' where id = v_payment.order_id;

    -- 20261112200000 (Jérôme, 2026-11-12 : « on déduit les frais ») : avec l'option « reverser les
    -- 17 % », la part des frais Mercado Pago de la ligne passe de la part prestataire à la part app.
    -- Lue dans p_raw_event (mp_fee_cop), posé juste au-dessus ; AVANT les e-mails ci-dessous, qui
    -- annoncent le montant net. Sous les verrous déjà pris (orders puis payments).
    perform public.apply_mp_fee_to_full_rebate_lines(v_payment.id);

    -- (4) Les autres paiements de cette commande n'ont plus lieu d'être : un `rejected` retenté
    -- plus tard chez Mercado Pago tombera dans la garde (2c) au lieu d'être appliqué à son tour.
    update public.payments
       set status = 'cancelled', updated_at = now()
     where order_id = v_payment.order_id
       and id <> v_payment.id
       and status in ('pending', 'rejected');

    -- Migration 20261023120000 (D4, Lobby après l'acompte) — une nuit PMS-backed `reserved` sans booking
    -- Lobby (le cas normal désormais : TENUE par hold_pms_nights, pas encore réservée) → UNE demande
    -- pms_booking_requests, que pms-book-paid-orders traite tout de suite (trigger, après le commit)
    -- ou au cron. Aucun appel réseau ici. Les e-mails de confirmation (5 commission, 6 paiement,
    -- 7 client, 8 « recurso bloqueado ») sont DIFFÉRÉS jusqu'au booking (resolve_pms_booking_request
    -- 'done'), commandes mixtes comprises : rien n'annonce « confirmé » avant le oui de Lobby. Un
    -- webhook en double ne crée qu'une demande (order_id unique) ; une demande close (done,
    -- cancelled) est réarmée, jamais une demande en cours ni une demande qu'un humain tient
    -- (failed, needs_human). Même prédicat qu'isPmsBacked et que create_payment_intent.
    if exists (
      select 1
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
       where ol.order_id = v_payment.order_id
         and ol.status = 'reserved'
         and ol.pms_booking_id is null
         and p.type = 'lodging' and p.lobby_category_id is not null
    ) then
      insert into public.pms_booking_requests as r (order_id)
      values (v_payment.order_id)
      on conflict (order_id) do update
         set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null,
             processed_at = null, updated_at = now()
       where r.status in ('done', 'cancelled');
    else
      -- Les trois e-mails d'avant (et le 8, quittant create_order), à l'identique. Isolés en plus ici
      -- (spec 23 §8.1) : une notification ne fait jamais échouer un paiement.
      begin
        perform public.notify_order_confirmed(v_payment.order_id);
      exception
        when query_canceled then
          raise warning 'apply_payment_webhook: notifications de confirmation annulées (query_canceled) pour commande % — %', v_payment.order_id, sqlerrm;
        when others then
          raise warning 'apply_payment_webhook: échec des notifications de confirmation pour commande % — %', v_payment.order_id, sqlerrm;
      end;
    end if;
  elsif p_status in ('rejected', 'cancelled') then
    -- (5) Jamais rétrograder une commande qu'un AUTRE paiement porte encore (pending) ou a déjà
    -- réglée (approved) — une notification `rejected` en retard sur P1 ne doit pas effacer P2.
    update public.orders
       set payment_status = 'unpaid'
     where id = v_payment.order_id
       and not exists (
         select 1 from public.payments other
          where other.order_id = v_payment.order_id
            and other.id <> v_payment.id
            and other.status in ('pending', 'approved')
       );
  end if;
  -- p_status = 'pending' : orders.payment_status reste 'pending' (déjà posé par create_payment_intent).

  return jsonb_build_object('ok', true);
end;
$function$;

-- ============================================================================================
-- 1d. modify_order_line — un ajout compté (extraction pg_get_functiondef)
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

  -- 20261112200000 : les frais Mercado Pago déjà retenus sur l'ancienne ligne (option 17 %) le
  -- restent sur la nouvelle — payés une fois, au paiement, ils ne changent pas avec la modification.
  -- Sans ceci, la nouvelle ligne repartait à 17/17/0 et la déduction était perdue. Avant l'entrée
  -- du ledger ci-dessous, qui reprend le montant net (nl.referrer_commission_cop).
  update public.order_lines nl
     set mp_fee_cop = least(v_old_line.mp_fee_cop, nl.referrer_commission_cop),
         referrer_commission_cop = nl.referrer_commission_cop - least(v_old_line.mp_fee_cop, nl.referrer_commission_cop),
         app_commission_cop = nl.app_commission_cop + least(v_old_line.mp_fee_cop, nl.referrer_commission_cop)
   where nl.id = v_new_line_id
     and coalesce(v_old_line.mp_fee_cop, 0) > 0;

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
-- 1e. notify_order_confirmed — un remplacement compté (branche self_referral seulement)
-- ============================================================================================

CREATE OR REPLACE FUNCTION public.notify_order_confirmed(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_tr constant text := '<tr><td style="padding:4px 12px 4px 0;color:#132f61;vertical-align:top">';
  c_td constant text := '</td><td style="padding:4px 0;color:#132f61;vertical-align:top;text-align:right;white-space:nowrap">';
  c_end constant text := '</td></tr>';
  c_table constant text := '<table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px">';
  c_subtotal_tr constant text := '<tr><td style="padding:8px 12px 4px 0;font-weight:bold;color:#132f61;border-top:1px solid #132f61">';
  c_subtotal_td constant text := '</td><td style="padding:8px 0 4px;font-weight:bold;color:#132f61;border-top:1px solid #132f61;text-align:right;white-space:nowrap">';
  c_intro_style constant text := '<p style="margin:0 0 8px;color:#2a618e;font-size:14px">';
  v_reference text;
  v_admin_url text;
  v_referrer record;
  v_referrer_account record;
  v_own_lines text;
  v_others_lines text;
  v_body text;
begin
  if not exists (select 1 from public.orders o where o.id = p_order_id and o.payment_status = 'paid') then
    return;
  end if;

  -- (a) commission attribuée — 20261112180000 : tout partenaire à qui une commission est due sur
  -- cette commande, auto-référence comprise, avec le détail de sa commission.
  select o.reference into v_reference from public.orders o where o.id = p_order_id;
  select decrypted_secret into v_admin_url
    from vault.decrypted_secrets where name = 'admin_app_public_url';

  for v_referrer in
    select ol.referrer_partner_id as partner_id,
           coalesce(sum(ol.referrer_commission_cop) filter (where ol.commission_case = 'self_referral'), 0)::bigint as own_cop,
           coalesce(sum(ol.referrer_commission_cop) filter (where ol.commission_case = 'external_referrer'), 0)::bigint as others_cop
      from public.order_lines ol
     where ol.order_id = p_order_id
       and ol.status = 'reserved'
       and ol.commission_case in ('self_referral', 'external_referrer')
       and ol.referrer_partner_id is not null
       and ol.referrer_commission_cop > 0
     group by ol.referrer_partner_id
  loop
    begin
      -- Une ligne par prestation : nom, date et pourcentage, montant à droite.
      select
        string_agg(case when ol.commission_case = 'self_referral' then
            c_tr || coalesce(public.html_text(coalesce(p.name ->> 'es', p.name ->> 'en')), 'Servicio')
            || '<br><span style="font-size:13px;color:#2a618e">' || public.email_fecha_es(ol.date)
            || ' · ' || trim_scale(ol.referrer_pct * 100)::text || ' % de '
            || public.email_cop(ol.total_cop)
            -- 20261112200000 : option 17 %, les frais Mercado Pago retenus sont dits ici.
            || case when coalesce(ol.mp_fee_cop, 0) > 0
                    then ' − comisión Mercado Pago ' || public.email_cop(ol.mp_fee_cop) else '' end
            || '</span>'
            || c_td || public.email_cop(ol.referrer_commission_cop) || c_end
          end, '' order by ol.date, ol.created_at, ol.id),
        string_agg(case when ol.commission_case = 'external_referrer' then
            c_tr || coalesce(public.html_text(coalesce(p.name ->> 'es', p.name ->> 'en')), 'Servicio')
            || '<br><span style="font-size:13px;color:#2a618e">' || public.email_fecha_es(ol.date)
            || ' · ' || trim_scale(ol.referrer_pct * 100)::text || ' % de '
            || public.email_cop(ol.total_cop) || '</span>'
            || c_td || public.email_cop(ol.referrer_commission_cop) || c_end
          end, '' order by ol.date, ol.created_at, ol.id)
        into v_own_lines, v_others_lines
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
       where ol.order_id = p_order_id
         and ol.status = 'reserved'
         and ol.commission_case in ('self_referral', 'external_referrer')
         and ol.referrer_partner_id = v_referrer.partner_id
         and ol.referrer_commission_cop > 0;

      -- Le CONTENU seulement, qui commence par son titre : l'habillage vient d'enqueue_notification_email.
      v_body := public.email_titulo('Nueva comisión asignada')
        || '<p style="margin:0 0 4px;color:#132f61">Se confirmó una reserva hecha con tu código'
        || coalesce(' (pedido <strong>' || public.html_text(v_reference) || '</strong>)', '')
        || '. Esta es la comisión que te corresponde.</p>'
        || case when v_referrer.own_cop > 0 then
             public.email_seccion('Tus propios servicios')
             || c_intro_style || 'Auto-recomendación: el cliente llegó con tu código y reservó un servicio tuyo.</p>'
             || c_table || v_own_lines
             || c_subtotal_tr || 'Subtotal auto-recomendación' || c_subtotal_td || public.email_cop(v_referrer.own_cop) || c_end
             || '</table>'
           else '' end
        || case when v_referrer.others_cop > 0 then
             public.email_seccion('Servicios de otros aliados')
             || c_intro_style || 'Recomendación: el cliente llegó con tu código y reservó el servicio de otro aliado.</p>'
             || c_table || v_others_lines
             || c_subtotal_tr || 'Subtotal recomendación' || c_subtotal_td || public.email_cop(v_referrer.others_cop) || c_end
             || '</table>'
           else '' end
        || case when v_referrer.own_cop > 0 and v_referrer.others_cop > 0 then
             '<table role="presentation" style="width:100%;border-collapse:collapse;font-size:16px;margin-top:16px">'
             || '<tr><td style="padding:10px 12px 4px 0;font-weight:bold;color:#132f61;border-top:2px solid #ddae09">Total de comisiones</td>'
             || '<td style="padding:10px 0 4px;font-weight:bold;color:#132f61;border-top:2px solid #ddae09;text-align:right;white-space:nowrap">'
             || public.email_cop(v_referrer.own_cop + v_referrer.others_cop) || c_end
             || '</table>'
           else '' end
        || '<p style="margin:16px 0 0;font-size:13px;color:#2a618e">La comisión queda estimada hasta que se preste el servicio.</p>'
        || coalesce(public.email_boton(v_admin_url || '/partner/commissions', 'Ver mis comisiones'), '');

      for v_referrer_account in
        select pa.id as account_id, au.email
          from public.partner_accounts pa
          join auth.users au on au.id = pa.id
         where pa.partner_id = v_referrer.partner_id
      loop
        begin
          perform public.enqueue_notification_email(
            'partner_commission_earned', v_referrer_account.email, v_referrer_account.account_id,
            'Nueva comisión asignada' || coalesce(' · ' || v_reference, ''),
            v_body,
            'orders', p_order_id
          );
        exception
          when query_canceled then
            raise warning 'notify_order_confirmed: notification commission annulée (query_canceled) pour compte % — %', v_referrer_account.account_id, sqlerrm;
          when others then
            raise warning 'notify_order_confirmed: échec notification commission pour compte % — %', v_referrer_account.account_id, sqlerrm;
        end;
      end loop;
    exception
      when query_canceled then
        raise warning 'notify_order_confirmed: e-mail de commission annulé (query_canceled) pour partenaire % — %', v_referrer.partner_id, sqlerrm;
      when others then
        raise warning 'notify_order_confirmed: échec de l''e-mail de commission pour partenaire % — %', v_referrer.partner_id, sqlerrm;
    end;
  end loop;

  -- (b) réservation confirmée — 20261112120000 : l'e-mail de réservation au prestataire (client,
  -- dates, montants, note), un par compte de chaque partenaire propriétaire, chacun ne voyant que
  -- ses prestations. Remplace « Pago confirmado » (sans contenu) et l'ex-(d), l'e-mail 8.
  begin
    perform public.notify_partner_order_confirmed(p_order_id);
  exception
    when query_canceled then
      raise warning 'notify_order_confirmed: notification prestataire annulée (query_canceled) pour commande % — %', p_order_id, sqlerrm;
    when others then
      raise warning 'notify_order_confirmed: échec notification prestataire pour commande % — %', p_order_id, sqlerrm;
  end;

  -- (c) confirmation de réservation au client — un seul email par commande, désormais porté par
  -- notify_client_order_confirmed (20261112140000), que create_order appelle aussi quand rien n'est
  -- dû en ligne. Isolé (spec 23 §8.1) : un échec ne fait jamais échouer l'appelant.
  begin
    perform public.notify_client_order_confirmed(p_order_id);
  exception
    when query_canceled then
      raise warning 'notify_order_confirmed: notification client annulée (query_canceled) pour commande % — %', p_order_id, sqlerrm;
    when others then
      raise warning 'notify_order_confirmed: échec notification client pour commande % — %', p_order_id, sqlerrm;
  end;
end;
$function$;

-- ============================================================================================
-- 2a. mark_partner_ledger_entries_paid — « Pagar todo »
-- ============================================================================================

create function public.mark_partner_ledger_entries_paid(
  p_beneficiary_partner_id uuid,
  p_ledger_entry_ids uuid[],
  p_expected_total_cop bigint,
  p_comprobante_path text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_found int;
  v_not_due int;
  v_foreign int;
  v_total bigint;
  v_entry record;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'mark_partner_ledger_entries_paid réservé au rôle admin' using errcode = '42501';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'motif obligatoire pour marquer des créances payées';
  end if;
  if p_beneficiary_partner_id is null then
    raise exception 'bénéficiaire obligatoire';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids
    from unnest(coalesce(p_ledger_entry_ids, '{}'::uuid[])) as x
   where x is not null;
  if cardinality(v_ids) = 0 then
    raise exception 'aucune entrée à marquer payée';
  end if;
  if cardinality(v_ids) <> cardinality(p_ledger_entry_ids) then
    raise exception 'liste d''entrées invalide (doublon ou valeur vide)';
  end if;

  -- Verrou de toutes les entrées, dans un ordre fixe (id) : deux « Pagar todo » ou un
  -- « Marcar pagado » concurrents s'attendent, le second relit l'état écrit par le premier.
  perform 1 from public.ledger_entries where id = any(v_ids) order by id for update;

  select count(*),
         count(*) filter (where le.status <> 'due'),
         count(*) filter (where coalesce(le.referrer_partner_id, be.partner_id) is distinct from p_beneficiary_partner_id),
         coalesce(sum(le.amount_cop), 0)::bigint
    into v_found, v_not_due, v_foreign, v_total
    from public.ledger_entries le
    left join public.establishments be on be.id = le.establishment_id
   where le.id = any(v_ids);

  if v_found <> cardinality(v_ids) then
    raise exception 'entrée de ledger introuvable';
  end if;
  if v_foreign > 0 then
    raise exception 'une entrée n''est pas due à ce bénéficiaire';
  end if;
  -- HF003 : refus qu'un admin provoque en usage normal (une page restée ouverte pendant qu'un
  -- autre réglait une entrée) — l'écran le reconnaît par ce code (rpcErrorMessage.ts).
  if v_not_due > 0 then
    raise exception 'une entrée a déjà été traitée ou n''est plus exigible — rechargez la page'
      using errcode = 'HF003';
  end if;
  if p_expected_total_cop is distinct from v_total then
    raise exception 'le total a changé (% COP en base, % COP affichés) — rechargez la page',
      v_total, p_expected_total_cop
      using errcode = 'HF003';
  end if;

  update public.ledger_entries
     set status = 'paid', comprobante_path = p_comprobante_path, note = p_note, paid_at = now()
   where id = any(v_ids);

  for v_entry in select id from public.ledger_entries where id = any(v_ids) order by id loop
    perform public.log_admin_action(
      'ledger_entry.mark_paid', 'ledger_entries', v_entry.id,
      jsonb_build_object('status', 'due'),
      jsonb_build_object('status', 'paid', 'batch_beneficiary_partner_id', p_beneficiary_partner_id,
                         'batch_count', cardinality(v_ids), 'batch_total_cop', v_total),
      p_note
    );
  end loop;

  return jsonb_build_object('ok', true, 'count', cardinality(v_ids), 'total_cop', v_total);
end;
$$;

comment on function public.mark_partner_ledger_entries_paid(uuid, uuid[], bigint, text, text) is
  '« Pagar todo » (admin) : marque payées en une fois les entrées « A pagar » affichées pour un bénéficiaire. Tout ou rien : toutes encore due, à ce bénéficiaire, au total affiché. Journal admin par entrée. 20261112200000.';

revoke all on function public.mark_partner_ledger_entries_paid(uuid, uuid[], bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_partner_ledger_entries_paid(uuid, uuid[], bigint, text, text)
  to authenticated;

-- ============================================================================================
-- 2b. admin_ledger_payables — + le compte Mercado Pago du bénéficiaire
-- ============================================================================================

drop function public.admin_ledger_payables();

create function public.admin_ledger_payables()
returns table (
  beneficiary_partner_id uuid,
  beneficiary_name text,
  due_count bigint,
  due_cop bigint,
  estimated_cop bigint,
  mercadopago_account text
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
    coalesce(sum(le.amount_cop) filter (where le.status = 'estimated'), 0)::bigint,
    ppa.mercadopago_account
  from public.ledger_entries le
  left join public.establishments be on be.id = le.establishment_id
  join public.partners bp on bp.id = coalesce(le.referrer_partner_id, be.partner_id)
  left join public.partner_payout_accounts ppa on ppa.partner_id = bp.id
  where le.status in ('due', 'estimated')
  group by bp.id, bp.display_name, ppa.mercadopago_account
  having count(*) filter (where le.status = 'due') > 0
  order by 4 desc, bp.display_name;
end;
$$;

revoke all on function public.admin_ledger_payables() from public, anon, authenticated;
grant execute on function public.admin_ledger_payables() to authenticated;

-- ============================================================================================
-- 3. admin_ledger_entries_list — + mp_fee_cop
-- ============================================================================================

drop function public.admin_ledger_entries_list(date, date, text, text, uuid, uuid, text, boolean, int, int, uuid);

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
  mp_fee_cop bigint,
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
    ol.mp_fee_cop,
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
    case when p_sort_key = 'amount_cop' and p_sort_desc then le.amount_cop end desc nulls last,
    le.id
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.admin_ledger_entries_list(date, date, text, text, uuid, uuid, text, boolean, int, int, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_ledger_entries_list(date, date, text, text, uuid, uuid, text, boolean, int, int, uuid)
  to authenticated;

-- ============================================================================================
-- 3b. partner_commissions_list — + mp_fee_cop
-- ============================================================================================

drop function public.partner_commissions_list(uuid, date, date, text, text, boolean, int, int);

create function public.partner_commissions_list(
  p_entry_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_status text default null,
  p_sort_key text default 'created_at',
  p_sort_desc boolean default true,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  amount_cop bigint,
  status text,
  date date,
  total_cop bigint,
  holder_name text,
  referrer_pct numeric,
  product_name jsonb,
  establishment_name jsonb,
  mp_fee_cop bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_partner_id uuid := public.partner_id_for_account(auth.uid());
begin
  return query
  select
    le.id, le.amount_cop, le.status,
    ol.date, ol.total_cop, ol.holder_name, ol.referrer_pct,
    p.name, e.name,
    ol.mp_fee_cop,
    count(*) over()
  from public.ledger_entries le
  join public.order_lines ol on ol.id = le.order_line_id
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  where le.beneficiary_type = 'referrer'
    and le.referrer_partner_id = v_partner_id
    and (p_entry_id is null or le.id = p_entry_id)
    and (p_date_from is null or ol.date >= p_date_from)
    and (p_date_to is null or ol.date <= p_date_to)
    and (p_status is null or le.status = p_status)
  order by
    case when p_sort_key = 'created_at' and not p_sort_desc then le.created_at end asc nulls last,
    case when p_sort_key = 'created_at' and p_sort_desc then le.created_at end desc nulls last
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.partner_commissions_list(uuid, date, date, text, text, boolean, int, int)
  from public, anon, authenticated;
grant execute on function public.partner_commissions_list(uuid, date, date, text, text, boolean, int, int)
  to authenticated;

-- ============================================================================================
-- 3c. admin_order_line_ledger — les entrées réelles de chaque ligne
-- ============================================================================================

drop function public.admin_order_line_ledger(uuid);

create function public.admin_order_line_ledger(p_order_id uuid)
returns table (
  id uuid,
  date date,
  qty integer,
  status text,
  total_cop bigint,
  acompte_cop bigint,
  referrer_commission_cop bigint,
  app_commission_cop bigint,
  commission_case text,
  product_name jsonb,
  mp_fee_cop bigint,
  commission_entry_status text,
  commission_entry_amount_cop bigint,
  compensation_entry_status text,
  compensation_entry_amount_cop bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_order_line_ledger réservé au rôle admin' using errcode = '42501';
  end if;

  -- Une ligne porte au plus une commission (re-pointée à la modification, 20261112190000) et une
  -- compensation (A3) ; la plus récente si jamais il y en avait deux.
  return query
  select
    ol.id, ol.date, ol.qty, ol.status, ol.total_cop, ol.acompte_cop,
    ol.referrer_commission_cop, ol.app_commission_cop, ol.commission_case,
    p.name,
    ol.mp_fee_cop,
    ce.status, ce.amount_cop,
    ke.status, ke.amount_cop
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  left join lateral (
    select le.status, le.amount_cop from public.ledger_entries le
     where le.order_line_id = ol.id and le.entry_type = 'referral_earned'
     order by le.created_at desc, le.id limit 1
  ) ce on true
  left join lateral (
    select le.status, le.amount_cop from public.ledger_entries le
     where le.order_line_id = ol.id and le.entry_type = 'establishment_compensation'
     order by le.created_at desc, le.id limit 1
  ) ke on true
  where ol.order_id = p_order_id
  order by ol.date asc;
end;
$$;

revoke all on function public.admin_order_line_ledger(uuid) from public, anon, authenticated;
grant execute on function public.admin_order_line_ledger(uuid) to authenticated;
