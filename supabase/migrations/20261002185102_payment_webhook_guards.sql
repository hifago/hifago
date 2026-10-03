-- Paiements : gardes d'apply_payment_webhook, un seul pending par commande, marge de l'intent.
--
-- Quatre fonctions redéfinies, une fois chacune, depuis pg_get_functiondef (.claude/rules/supabase.md
-- règle 7, remplacements comptés) :
--   - apply_payment_webhook :
--       · une décision de remboursement (entrée refund_required) est définitive pour un paiement
--         Mercado Pago : un `approved` rejoué ensuite ne l'applique jamais ;
--       · un `pending` reçu sur un paiement qui ne l'est plus, alors qu'un AUTRE intent de la commande
--         est `pending`, ne le rétrograde pas (reason other_intent_pending) ;
--       · un `approved` sur un intent remplacé (annulé par create_payment_intent, commande vivante,
--         intent plus récent) → refund_required superseded_intent (avant : paid_after_expiry) ;
--       · un `approved` alors qu'une nuit PMS-backed `reserved` n'a pas de booking Lobby (I2) →
--         refund_required pms_booking_missing, rien n'est appliqué (échec fermé, CLAUDE.md §4.4) ;
--   - create_payment_intent : refuse `order_expiring` 30 s avant la limite de paiement (le navigateur
--     appelle ensuite payments/create, qui revérifie la limite) ;
--   - notify_client_refund_required : textes client (provisoires) pour pms_booking_missing et
--     superseded_intent, valeurs échappées (html_text) ;
--   - order_for_client_jsonb : ces deux codes comptent comme « paiement reçu, non honoré » et dans
--     le statut du remboursement affiché au client.
-- reason_code accepte pms_booking_missing et superseded_intent. Puis, sous verrou de la table : un
-- seul pending par commande (le plus récent reste, les autres repassent `rejected`) et l'index unique partiel
-- payments_one_pending_per_order — retiré de la migration 20260930221837 faute de cette garde,
-- réintroduit avec elle.

-- Le verrou de payments D'ABORD, avant l'ALTER de payment_reconciliation_entries : un webhook
-- tient une ligne de payments PUIS insère une entrée ; prendre les deux tables dans l'autre ordre
-- ferait un interblocage avec lui. Une transaction qui lit les entrées PUIS écrit un paiement (une
-- demande de remboursement admin, l'expiration par le job) peut encore en faire un : l'une des deux
-- transactions échoue, à rejouer, sans rien corrompre. Tenu jusqu'à la fin de la migration (une
-- seule transaction).
do $$
begin
  perform set_config('lock_timeout', '5s', true);
  lock table public.payments in exclusive mode;
end;
$$;

alter table public.payment_reconciliation_entries
  drop constraint payment_reconciliation_entries_reason_code_check,
  add constraint payment_reconciliation_entries_reason_code_check check (reason_code = any (array[
    'paid_after_expiry', 'double_payment', 'amount_mismatch', 'refunded_externally', 'charged_back',
    'pms_booking_missing', 'superseded_intent'
  ]));

CREATE OR REPLACE FUNCTION public.apply_payment_webhook(p_mp_payment_id text, p_external_reference uuid, p_status text, p_raw_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payment record;
  v_order record;
  v_referrer_account record;
  v_owner_account record;
  v_order_summary text;
  v_site_url text;
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
    -- Migration 20261002185102 — I2 AU WEBHOOK : une nuit PMS-backed `reserved` sans booking Lobby (une
    -- modification admin recrée la ligne sans booking, et une préférence encore vivante la paie).
    -- Échec fermé (CLAUDE.md §4.4) : rien n'est appliqué, l'admin traite le remboursement à la main
    -- (refund_required) — jamais de remboursement automatique. Décision encore ouverte (Jérôme) :
    -- l'alternative « appliquer, puis re-réserver chez Lobby » n'est pas écartée. Même prédicat que
    -- create_payment_intent (isPmsBacked).
    elsif exists (
      select 1
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
       where ol.order_id = v_payment.order_id
         and ol.status = 'reserved'
         and ol.pms_booking_id is null
         and p.type = 'lodging' and p.lobby_category_id is not null
    ) then
      v_refund_code := 'pms_booking_missing';
      v_refund_reason := 'paiement approuvé alors qu''une nuit PMS n''a pas de booking Lobby — '
        || 'rien n''est appliqué, remboursement à traiter';
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

    -- (4) Les autres paiements de cette commande n'ont plus lieu d'être : un `rejected` retenté
    -- plus tard chez Mercado Pago tombera dans la garde (2c) au lieu d'être appliqué à son tour.
    update public.payments
       set status = 'cancelled', updated_at = now()
     where order_id = v_payment.order_id
       and id <> v_payment.id
       and status in ('pending', 'rejected');

    -- (a) commission attribuée — un email par compte du/des référent(s) externe(s) distinct(s).
    for v_referrer_account in
      select distinct pa.id as account_id, au.email
        from public.order_lines ol
        join public.partner_accounts pa on pa.partner_id = ol.referrer_partner_id
        join auth.users au on au.id = pa.id
       where ol.order_id = v_payment.order_id and ol.commission_case = 'external_referrer'
    loop
      begin
        perform public.enqueue_notification_email(
          'partner_commission_earned', v_referrer_account.email, v_referrer_account.account_id,
          'Nueva comisión asignada',
          '<p>Se te asignó una comisión por una reserva confirmada.</p>',
          'orders', v_payment.order_id
        );
      exception
        when query_canceled then
          raise warning 'apply_payment_webhook: notification commission annulée (query_canceled) pour compte % — %', v_referrer_account.account_id, sqlerrm;
        when others then
          raise warning 'apply_payment_webhook: échec notification commission pour compte % — %', v_referrer_account.account_id, sqlerrm;
      end;
    end loop;

    -- (b) paiement effectué — un email par compte du/des partenaire(s) propriétaire(s) distinct(s)
    -- des produits commandés (spec 23 §10 point 8 : lecture retenue, à confirmer par Jérôme).
    for v_owner_account in
      select distinct pa.id as account_id, au.email
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        join public.partner_accounts pa on pa.partner_id = p.partner_id
        join auth.users au on au.id = pa.id
       where ol.order_id = v_payment.order_id
    loop
      begin
        perform public.enqueue_notification_email(
          'partner_payment_confirmed', v_owner_account.email, v_owner_account.account_id,
          'Pago confirmado',
          '<p>Se confirmó el pago de una reserva en tu establecimiento.</p>',
          'orders', v_payment.order_id
        );
      exception
        when query_canceled then
          raise warning 'apply_payment_webhook: notification paiement annulée (query_canceled) pour compte % — %', v_owner_account.account_id, sqlerrm;
        when others then
          raise warning 'apply_payment_webhook: échec notification paiement pour compte % — %', v_owner_account.account_id, sqlerrm;
      end;
    end loop;

    -- (c) confirmation de réservation au client — un seul email par commande.
    --
    -- ⚠️ SPEC 33 : CET EMAIL PORTE DÉSORMAIS LE NUMÉRO ET LE LIEN. Le commentaire qu'il remplace
    -- disait « lien vers /orders/[id]/status non ajouté en v1, à confirmer par Jérôme » — c'est
    -- confirmé et tranché (cahier client §2b.9, 2026-09-07) : l'adresse de la commande « part aussi
    -- dans l'email de confirmation, ce qui la rend retrouvable des mois plus tard ». Pour un client
    -- sans compte, cet email EST le canal de suivi : le WhatsApp pré-rempli a été retiré le même
    -- jour, et la zone tunnel n'a pas de pied de page.
    --
    -- ⚠️ L'URL publique du site vient du VAULT, comme `admin_app_public_url` pour l'email
    -- d'invitation partenaire (20260824040000) et `pms_functions_base_url` pour les crons
    -- (20260819140000). Une première version de la spec 33 avait inventé un jeton de gabarit
    -- `{{SITE_URL}}` résolu à l'envoi par l'Edge Function, en justifiant que « Postgres ne connaît
    -- pas l'URL publique du site » — c'était FAUX : ce dépôt a déjà ce mécanisme, pour exactement
    -- cette raison (« seedée par environnement, jamais une valeur en dur, elle diffère
    -- local/preprod/prod »). Deux patrons concurrents pour mettre un lien dans un email, c'est un
    -- de trop.
    --
    -- ⚠️ DIFFÉRENCE ASSUMÉE avec l'invitation partenaire : là-bas, un secret manquant fait SAUTER
    -- l'email (le lien reste affiché à l'écran, donc rien n'est perdu). Ici le client a PAYÉ et
    -- n'a plus l'écran sous les yeux : on envoie la confirmation dans tous les cas, avec le lien
    -- si le secret existe, sans lui sinon. Un email de confirmation sans lien reste utile ; pas
    -- d'email du tout ne l'est pas.
    begin
      select holder_name, holder_email, reference, access_token into v_order
        from public.orders where id = v_payment.order_id;

      select decrypted_secret into v_site_url
        from vault.decrypted_secrets where name = 'web_app_public_url';
      if v_site_url is null then
        raise warning 'apply_payment_webhook: secret Vault web_app_public_url manquant — email de confirmation envoyé SANS lien vers la réserve (commande %)', v_payment.order_id;
      end if;

      -- Migration 20261002160349 : valeurs venues des données échappées (html_text) — nom de
      -- produit, nom du titulaire, référence. Le sujet est du texte brut.
      select string_agg(
        '<li>' || coalesce(public.html_text(p.name ->> 'es'), 'Producto') || ' — ' || ol.date
          || coalesce(' a ' || ol.end_date, '') || ' — $' || ol.total_cop || ' COP</li>',
        ''
      ) into v_order_summary
      from public.order_lines ol join public.products p on p.id = ol.product_id
      where ol.order_id = v_payment.order_id;

      perform public.enqueue_notification_email(
        'client_order_confirmed', v_order.holder_email, null,
        'Reserva ' || v_order.reference || ' confirmada',
        '<p>Hola ' || coalesce(public.html_text(v_order.holder_name), '') || ', tu reserva fue confirmada.</p>'
          || '<p>Número de reserva : <strong>' || public.html_text(v_order.reference) || '</strong></p>'
          || '<ul>' || coalesce(v_order_summary, '') || '</ul>'
          || coalesce(
               '<p><a href="' || v_site_url || '/reserva/' || v_order.access_token || '">'
                 || 'Ver tu reserva</a> — guarda este enlace, puedes volver a abrirlo cuando quieras.</p>',
               ''
             ),
        'orders', v_payment.order_id
      );
    exception
      when query_canceled then
        raise warning 'apply_payment_webhook: notification client annulée (query_canceled) pour commande % — %', v_payment.order_id, sqlerrm;
      when others then
        raise warning 'apply_payment_webhook: échec notification client pour commande % — %', v_payment.order_id, sqlerrm;
    end;
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
  -- Migration 20261002185102 — MARGE DE 30 s : le navigateur appelle cette fonction PUIS payments/create,
  -- qui revérifie la limite (28 min) avant de créer la préférence. Un intent accepté dans les
  -- toutes dernières secondes posait un `pending` (écran « confirmando ») que payments/create
  -- refusait aussitôt. Jamais une fonction d'abandon du pending : un écrivain de plus de
  -- payments.status pour un défaut d'écran.
  if now() >= public.order_payment_deadline(v_order_created_at) - interval '30 seconds'
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
  -- est remboursé : refund_required superseded_intent (migration 20261002185102). Avant :
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

CREATE OR REPLACE FUNCTION public.notify_client_refund_required()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order record;
  v_amount bigint;
  v_site_url text;
  v_event text;
  v_subject text;
  v_body text;
  v_link text;
begin
  begin
    if new.kind <> 'refund_required' or new.payment_id is null then
      return new;
    end if;
    select o.holder_name, o.holder_email, o.reference, o.access_token, p.amount_cop
      into v_order
      from public.payments p
      join public.orders o on o.id = p.order_id
     where p.id = new.payment_id;
    if not found or v_order.holder_email is null then
      return new;
    end if;
    v_amount := coalesce(
      nullif(round((new.raw_event ->> 'transaction_amount')::numeric), 0)::bigint,
      v_order.amount_cop
    );
    select decrypted_secret into v_site_url
      from vault.decrypted_secrets where name = 'web_app_public_url';
    v_link := coalesce(
      '<p><a href="' || v_site_url || '/reserva/' || v_order.access_token || '">Ver tu reserva</a></p>',
      ''
    );

    -- Migration 20261002160349 : nom du titulaire et référence échappés (html_text) dans le corps ;
    -- les sujets sont du texte brut.
    if new.reason_code = 'double_payment' then
      v_event := 'client_duplicate_payment_refund';
      v_subject := 'Recibimos un pago duplicado para tu reserva ' || v_order.reference;
      v_body := '<p>Hola ' || coalesce(public.html_text(v_order.holder_name), '') || ',</p>'
        || '<p>Tu reserva <strong>' || public.html_text(v_order.reference) || '</strong> está confirmada. Recibimos un segundo pago de $'
        || v_amount || ' COP para la misma reserva: te lo reembolsaremos por el mismo medio de pago en los próximos días.</p>'
        || v_link;
    -- Migration 20261002185102 — intent remplacé : ce paiement-ci (fait avec un lien qui n'était plus
    -- le lien courant) n'est pas appliqué. Texte provisoire, à valider (Jérôme).
    elsif new.reason_code = 'superseded_intent' then
      v_event := 'client_payment_received_not_honored';
      v_subject := 'Recibimos un pago hecho con un enlace anterior de tu reserva ' || v_order.reference;
      v_body := '<p>Hola ' || coalesce(public.html_text(v_order.holder_name), '') || ',</p>'
        || '<p>Recibimos un pago de $' || v_amount || ' COP hecho con un enlace de pago anterior de tu reserva <strong>'
        || public.html_text(v_order.reference) || '</strong>. Ese enlace ya no estaba vigente (había sido reemplazado por uno '
        || 'nuevo), así que este pago no se aplicó: te contactamos en las próximas horas para reembolsarlo.</p>'
        || v_link;
    else
      v_event := 'client_payment_received_not_honored';
      v_subject := 'Recibimos tu pago — tu reserva ' || v_order.reference || ' no pudo confirmarse';
      v_body := '<p>Hola ' || coalesce(public.html_text(v_order.holder_name), '') || ',</p>'
        || '<p>Recibimos tu pago de $' || v_amount || ' COP, pero tu reserva <strong>' || public.html_text(v_order.reference)
        || '</strong> no pudo confirmarse: '
        || case when new.reason_code = 'amount_mismatch'
             then 'el monto recibido no coincide con el anticipo de la reserva.'
             when new.reason_code = 'pms_booking_missing'
             then 'no logramos confirmar la disponibilidad del alojamiento con el establecimiento.'
             else 'la reserva ya había expirado o había sido anulada cuando llegó el pago.' end
        || '</p><p>Te contactamos en las próximas horas para reembolsarte o volver a reservar. No necesitas hacer nada.</p>'
        || v_link;
    end if;

    perform public.enqueue_notification_email(
      v_event, v_order.holder_email, null, v_subject, v_body,
      'payment_reconciliation_entries', new.id
    );
  exception
    when query_canceled then
      raise warning 'notify_client_refund_required: annulé (query_canceled) pour % — %', new.id, sqlerrm;
    when others then
      raise warning 'notify_client_refund_required: échec pour % — %', new.id, sqlerrm;
  end;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.order_for_client_jsonb(p_order orders)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with lignes as (
    select
      jsonb_build_object(
        'id', ol.id,
        'product_name', p.name,
        'product_type', p.type,
        'product_slug', p.slug,
        'establishment_name', e.name,
        'establishment_slug', e.slug,
        'establishment_contact_phone', e.contact_phone,
        'date', ol.date,
        'end_date', ol.end_date,
        -- `duration_days` — NUL pour tout ce qui n'est pas `camp` (contrainte
        -- `products_duration_days_required_for_camp`, 20260814220000). L'écran reconstitue la
        -- date de fin d'un camp à partir de `date` + cette valeur, jamais l'inverse.
        'duration_days', p.duration_days,
        'slot_start_time', ol.slot_start_time,
        'qty', ol.qty,
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
    -- Ordre INCHANGÉ (20260911100000) : les assertions pgTAP indexent `lines,0`.
    'lines', coalesce(jsonb_agg(ligne order by ligne_created_at, ligne_id), '[]'::jsonb)
  )
  from lignes;
$function$;

do $$
begin
  -- Échoue vite plutôt que de bloquer les paiements si une transaction longue tient la table.
  perform set_config('lock_timeout', '5s', true);
  -- EXCLUSIVE : attend la fin des transactions qui tiennent des lignes de payments (le webhook,
  -- create_payment_intent) et bloque les suivantes jusqu'à la fin de la migration — aucun double
  -- pending ne peut naître entre la déduplication et l'index.
  lock table public.payments in exclusive mode;
  -- Un seul pending par commande : le plus récent reste (celui que create_payment_intent réutilise,
  -- `order by created_at desc`). Les plus anciens repassent `rejected` — l'état que la garde
  -- other_intent_pending laisse à un intent qui n'est plus le pending courant (un double pending ne
  -- naissait que d'un `rejected` relancé dans l'ancienne session) : un `approved` qui suivrait
  -- s'appliquerait, jamais remboursé.
  update public.payments p
     set status = 'rejected', updated_at = now()
   where p.status = 'pending'
     and exists (
       select 1 from public.payments q
        where q.order_id = p.order_id and q.status = 'pending'
          and (q.created_at, q.id) > (p.created_at, p.id)
     );
  create unique index payments_one_pending_per_order on public.payments (order_id) where status = 'pending';
end;
$$;
