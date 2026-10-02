-- E-mails : les valeurs venues des données sont échappées dans tous les corps HTML ; l'e-mail admin
-- d'une nouvelle proposition porte un lien absolu.
--
-- Sept fonctions redéfinies, une fois chacune, depuis pg_get_functiondef (.claude/rules/supabase.md
-- règle 7, remplacements comptés). Seuls changent les appels à public.html_text (migration
-- 20261002125023 : xmltext plus l'apostrophe, NULL → NULL), leurs commentaires et, dans
-- notify_admin_new_proposal, le lien et un test réécrit :
--   - apply_payment_webhook (confirmation au client) : nom de produit, nom du titulaire, référence ;
--   - create_order (« recurso bloqueado » au partenaire) : xmltext remplacé par html_text, qui
--     échappe aussi l'apostrophe ;
--   - moderate_establishment_proposal, moderate_product_proposal (verdict au partenaire) : nom de
--     la proposition, motif de rejet ;
--   - notify_admin_new_proposal (aux admins) : nom de la proposition, nom du partenaire ; lien
--     absolu via le secret Vault admin_app_public_url (sans lui : chemin relatif et un warning),
--     avec ?entity=establishment pour une proposition d'établissement (sans lui, la page admin
--     répond 404) ; et une proposition d'établissement sans nom (photos, édition) notifie de
--     nouveau — `new.product_id`, préparé sur une ligne sans cette colonne, levait une erreur
--     avalée par le bloc exception ;
--   - notify_client_refund_required (au client) : nom du titulaire, référence ;
--   - payments_reconcile_watchdog (alerte aux admins) : dernier message d'erreur du job.
-- Les sujets restent du texte brut. Les liens n'interpolent que des secrets Vault, des identifiants
-- et des jetons générés. create_partner_invitation n'interpole aucune valeur venue des données :
-- elle figure dans la liste blanche du méta-test (notification_html_escaping.test.sql), qui exige
-- aussi que tout appelant de html_text soit SECURITY DEFINER — html_text est révoquée pour anon et
-- authenticated.

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

  select id, order_id, status, mp_payment_id into v_payment
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

CREATE OR REPLACE FUNCTION public.create_order(p_holder_name text, p_holder_email text DEFAULT NULL::text, p_holder_phone text DEFAULT NULL::text, p_marketing_consent boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        -- Ajout de la migration 20260929112240 : le nom est échappé avant d'être interpolé dans le
        -- HTML — par public.html_text depuis la migration 20261002160349 (xmltext plus l'apostrophe,
        -- NULL → NULL).
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
              '<p>Se reservó "' || coalesce(public.html_text(v_camp_product_name), 'tu producto') || '".</p>'
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

CREATE OR REPLACE FUNCTION public.moderate_establishment_proposal(p_proposal_id uuid, p_decision text, p_expected_version integer, p_corrected_payload jsonb DEFAULT NULL::jsonb, p_rejection_reason text DEFAULT NULL::text, p_activate_pms_connector boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_proposal record;
  v_final_payload jsonb;
  v_stored_payload jsonb;
  v_reviewer_email text;
  v_current_operated_directly boolean;
  v_new_establishment_id uuid;
  v_photo jsonb;
  v_next_sort int;
  v_submitted_by uuid;
  v_submitted_by_email text;
  v_entity_name text;
  v_subject text;
  v_body text;
  v_lobby_token text;
  v_target_establishment_id uuid;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'moderate_establishment_proposal réservé au rôle admin' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'décision invalide : %', p_decision;
  end if;
  if p_decision = 'reject' and (p_rejection_reason is null or btrim(p_rejection_reason) = '') then
    raise exception 'motif obligatoire pour un rejet';
  end if;

  select id, establishment_id, partner_id, kind, payload, status, version, reviewed_by
    into v_proposal
    from public.establishment_proposals where id = p_proposal_id for update;

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

  if p_decision = 'approve' and v_proposal.kind = 'photos' then
    v_final_payload := coalesce(p_corrected_payload, v_proposal.payload);

    select coalesce(max(sort), -1) + 1 into v_next_sort
      from public.establishment_media where establishment_id = v_proposal.establishment_id;

    for v_photo in select * from jsonb_array_elements(v_final_payload -> 'photos')
    loop
      insert into public.establishment_media (establishment_id, storage_path, sort)
      values (v_proposal.establishment_id, v_photo ->> 'storage_path', v_next_sort);
      v_next_sort := v_next_sort + 1;
    end loop;

    update public.establishment_proposals
       set status = 'approved', payload = v_final_payload, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('establishment_proposal.approve_photos', 'establishment_media',
      v_proposal.establishment_id, null, v_final_payload, null);

  elsif p_decision = 'approve' then
    v_final_payload := jsonb_build_object(
      'name', coalesce(p_corrected_payload -> 'name', v_proposal.payload -> 'name'),
      'description', coalesce(p_corrected_payload -> 'description', v_proposal.payload -> 'description'),
      'address', coalesce(p_corrected_payload -> 'address', v_proposal.payload -> 'address'),
      'lat', coalesce(p_corrected_payload -> 'lat', v_proposal.payload -> 'lat'),
      'lon', coalesce(p_corrected_payload -> 'lon', v_proposal.payload -> 'lon'),
      'photos', coalesce(v_proposal.payload -> 'photos', '[]'::jsonb)
    );
    v_lobby_token := nullif(btrim(coalesce(
      p_corrected_payload ->> 'lobby_api_token', v_proposal.payload ->> 'lobby_api_token'
    )), '');

    if v_proposal.kind = 'create' then
      select public.create_establishment(
        v_proposal.partner_id,
        v_final_payload -> 'name',
        v_final_payload -> 'description',
        v_final_payload ->> 'address',
        nullif(v_final_payload ->> 'lat', '')::double precision,
        nullif(v_final_payload ->> 'lon', '')::double precision,
        false
      ) into v_new_establishment_id;

      if jsonb_typeof(v_final_payload -> 'photos') = 'array' then
        v_next_sort := 0;
        for v_photo in select * from jsonb_array_elements(v_final_payload -> 'photos') loop
          insert into public.establishment_media (establishment_id, storage_path, sort)
          values (v_new_establishment_id, v_photo ->> 'storage_path', v_next_sort);
          v_next_sort := v_next_sort + 1;
        end loop;
      end if;

      v_target_establishment_id := v_new_establishment_id;

      if v_lobby_token is not null then
        perform public.set_establishment_pms_connector(
          v_new_establishment_id, v_lobby_token, p_activate_pms_connector,
          'Aprobado desde propuesta ' || p_proposal_id
        );
      end if;

      v_stored_payload := v_final_payload - 'lobby_api_token';
      if v_lobby_token is not null then
        v_stored_payload := v_stored_payload || jsonb_build_object('lobby_api_token_provided', true);
      end if;

      update public.establishment_proposals
         set status = 'approved', establishment_id = v_new_establishment_id, payload = v_stored_payload,
             reviewed_by = auth.uid(), reviewed_at = now(), version = version + 1, updated_at = now()
       where id = p_proposal_id;
    else
      select operated_directly into v_current_operated_directly
        from public.establishments where id = v_proposal.establishment_id;

      perform public.update_establishment(
        v_proposal.establishment_id,
        v_final_payload -> 'name',
        v_final_payload -> 'description',
        v_final_payload ->> 'address',
        nullif(v_final_payload ->> 'lat', '')::double precision,
        nullif(v_final_payload ->> 'lon', '')::double precision,
        v_current_operated_directly,
        'Aprobado desde propuesta ' || p_proposal_id
      );

      v_target_establishment_id := v_proposal.establishment_id;

      if v_lobby_token is not null then
        perform public.set_establishment_pms_connector(
          v_proposal.establishment_id, v_lobby_token, p_activate_pms_connector,
          'Aprobado desde propuesta ' || p_proposal_id
        );
      end if;

      v_stored_payload := v_final_payload - 'lobby_api_token';
      if v_lobby_token is not null then
        v_stored_payload := v_stored_payload || jsonb_build_object('lobby_api_token_provided', true);
      end if;

      update public.establishment_proposals
         set status = 'approved', payload = v_stored_payload, reviewed_by = auth.uid(),
             reviewed_at = now(), version = version + 1, updated_at = now()
       where id = p_proposal_id;
    end if;
  else
    -- Rejet : rédaction du token avant stockage, même invariant que l'approbation/le retrait.
    v_stored_payload := case when v_proposal.payload ? 'lobby_api_token'
      then (v_proposal.payload - 'lobby_api_token') || jsonb_build_object('lobby_api_token_provided', true)
      else v_proposal.payload end;

    update public.establishment_proposals
       set status = 'rejected', payload = v_stored_payload, rejection_reason = p_rejection_reason,
           reviewed_by = auth.uid(), reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('establishment_proposal.reject', 'establishment_proposals',
      p_proposal_id, null, null, p_rejection_reason);
  end if;

  -- Spec 23 §0/§7 — notification partenaire du verdict, isolée (§8.1).
  begin
    select submitted_by into v_submitted_by from public.establishment_proposals where id = p_proposal_id;
    select email into v_submitted_by_email from auth.users where id = v_submitted_by;
    -- Migration 20261002160349 : v_entity_name ne sert qu'au corps HTML, échappé dès l'affectation ;
    -- le motif, stocké brut, est échappé à l'interpolation (html_text).
    v_entity_name := coalesce(public.html_text(v_proposal.payload -> 'name' ->> 'es'), 'Establecimiento sin nombre');

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
      'establishment_proposals', p_proposal_id
    );
  exception
    when query_canceled then
      raise warning 'moderate_establishment_proposal: notification annulée (query_canceled) pour % — %', p_proposal_id, sqlerrm;
    when others then
      raise warning 'moderate_establishment_proposal: échec notification pour % — %', p_proposal_id, sqlerrm;
  end;

  return jsonb_build_object('ok', true);
end;
$function$;

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
           price_cop = nullif(v_final_payload ->> 'price_cop', '')::bigint,
           price_tiers = v_final_payload -> 'price_tiers',
           min_qty = nullif(v_final_payload ->> 'min_qty', '')::int,
           max_qty = nullif(v_final_payload ->> 'max_qty', '')::int,
           check_in_time = nullif(v_final_payload ->> 'check_in_time', '')::time,
           check_out_time = nullif(v_final_payload ->> 'check_out_time', '')::time,
           capacity = nullif(v_final_payload ->> 'capacity', '')::int,
           unit_count = nullif(v_final_payload ->> 'unit_count', '')::int,
           lodging_kind = nullif(v_final_payload ->> 'lodging_kind', ''),
           unit = nullif(v_final_payload ->> 'unit', ''),
           default_capacity = nullif(v_final_payload ->> 'default_capacity', '')::int,
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
           price_label = case when v_final_payload ? 'price_label'
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
           updated_at = now()
     where id = v_proposal.product_id;

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

CREATE OR REPLACE FUNCTION public.notify_admin_new_proposal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_entity_name text;
  v_partner_name text;
  v_subject text;
  v_body text;
  v_app_base_url text;
begin
  begin
    v_entity_name := new.payload -> 'name' ->> 'es';

    if v_entity_name is null then
      -- Migration 20261002160349 : tests imbriqués. PL/pgSQL prépare l'expression entière d'un IF :
      -- `new.product_id` sur une ligne d'establishment_proposals (sans cette colonne) levait une
      -- erreur, avalée par le bloc exception — aucun e-mail pour une proposition d'établissement
      -- sans nom (photos, édition).
      if tg_table_name = 'product_proposals' then
        if new.product_id is not null then
          select p.name ->> 'es' into v_entity_name from public.products p where p.id = new.product_id;
        end if;
      elsif tg_table_name = 'establishment_proposals' and new.establishment_id is not null then
        select e.name ->> 'es' into v_entity_name from public.establishments e where e.id = new.establishment_id;
      end if;
    end if;

    if tg_table_name = 'product_proposals' then
      v_subject := 'Nueva propuesta de producto pendiente de moderación';
    else
      v_subject := 'Nueva propuesta de establecimiento pendiente de moderación';
    end if;

    select display_name into v_partner_name from public.partners where id = new.partner_id;

    -- Migration 20261002160349 : lien absolu (secret Vault admin_app_public_url) — sans le secret, on
    -- retombe sur le chemin relatif (jamais un e-mail en moins) ; une proposition d'établissement
    -- s'ouvre avec ?entity=establishment (sans lui, la page cherche une proposition de produit :
    -- 404) ; noms de l'entité et du partenaire échappés (html_text).
    select decrypted_secret into v_app_base_url
      from vault.decrypted_secrets where name = 'admin_app_public_url';
    if v_app_base_url is null then
      raise warning 'notify_admin_new_proposal: secret Vault admin_app_public_url manquant — lien relatif dans l''e-mail';
    end if;

    v_body := '<p>' || coalesce(public.html_text(v_entity_name), 'Sin nombre') || '</p>'
      || '<p>Propuesto por: ' || coalesce(public.html_text(v_partner_name), 'Socio desconocido') || '</p>'
      || '<p><a href="' || coalesce(v_app_base_url, '') || '/admin/proposals/' || new.id
      || case when tg_table_name = 'establishment_proposals' then '?entity=establishment' else '' end
      || '">Ver propuesta</a></p>';

    perform public.notify_all_admins(
      'admin_new_proposal', v_subject, v_body, tg_table_name, new.id
    );
  exception
    when query_canceled then
      raise warning 'notify_admin_new_proposal: annulé (query_canceled) pour % % — %', tg_table_name, new.id, sqlerrm;
    when others then
      raise warning 'notify_admin_new_proposal: échec pour % % — %', tg_table_name, new.id, sqlerrm;
  end;

  return new;
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
    else
      v_event := 'client_payment_received_not_honored';
      v_subject := 'Recibimos tu pago — tu reserva ' || v_order.reference || ' no pudo confirmarse';
      v_body := '<p>Hola ' || coalesce(public.html_text(v_order.holder_name), '') || ',</p>'
        || '<p>Recibimos tu pago de $' || v_amount || ' COP, pero tu reserva <strong>' || public.html_text(v_order.reference)
        || '</strong> no pudo confirmarse: '
        || case when new.reason_code = 'amount_mismatch'
             then 'el monto recibido no coincide con el anticipo de la reserva.'
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

CREATE OR REPLACE FUNCTION public.payments_reconcile_watchdog()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hb record;
begin
  select * into v_hb from public.job_heartbeats where job_name = 'payments-reconcile';
  if not found then
    return;
  end if;
  if coalesce(v_hb.last_ok_at, v_hb.created_at) < now() - interval '15 minutes'
     and (v_hb.alerted_at is null or v_hb.alerted_at < coalesce(v_hb.last_ok_at, v_hb.created_at)) then
    -- Migration 20261002160349 : last_error, texte d'origine externe, échappé (html_text).
    perform public.notify_all_admins(
      'admin_job_stalled',
      'El job de conciliación de pagos no responde desde hace 15 min',
      '<p>Última ejecución exitosa: ' || coalesce(v_hb.last_ok_at::text, 'nunca') || '.</p>'
        || '<p>Último error: ' || coalesce(public.html_text(v_hb.last_error), '—') || '.</p>'
        || '<p>Mientras esté detenido, ninguna reserva expira y ningún pago tardío se concilia: revisar secrets, despliegue de la Edge Function y net._http_response.</p>',
      'job_heartbeats', null
    );
    update public.job_heartbeats set alerted_at = now() where job_name = 'payments-reconcile';
  end if;
end;
$function$;
