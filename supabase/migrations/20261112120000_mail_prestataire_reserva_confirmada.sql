-- E-mail de confirmation au prestataire (décision Jérôme du 2026-11-12, maquette validée le même
-- jour). Pour toute réservation confirmée, chaque prestataire de la commande reçoit un e-mail qui
-- lui donne de quoi recevoir son client : nom, WhatsApp, e-mail, dates réservées, quantité,
-- montants (total, acompte payé sur Hifago, solde à encaisser) et la note du client.
--
-- Ce que fait cette migration :
--   0. orders.client_note — la note facultative que le client laisse au paiement (« Nota para el
--      establecimiento »), une par commande, montrée à chacun de ses prestataires (choix 1).
--   1. notification_emails.reply_to + paramètre p_reply_to d'enqueue_notification_email : « Répondre »
--      à l'e-mail du prestataire écrit au client (choix 3). L'Edge Function send-notification-emails
--      le transmet à Resend (`reply_to`).
--   2. Trois formateurs internes (date en toutes lettres, heure, montant COP) — les e-mails
--      affichaient `2026-12-19` et `$480000`.
--   3. notify_partner_order_confirmed : le nouvel e-mail. REMPLACE le corps de l'e-mail 6
--      (`partner_payment_confirmed`, « Pago confirmado » sans aucun contenu) : même événement, même
--      destinataires (chaque compte de chaque partenaire propriétaire), même dédoublonnage (event,
--      'orders', commande, compte). Chaque prestataire ne voit que SES prestations vivantes.
--   4. L'e-mail 8 (`partner_camp_evento_blocked`, « recurso bloqueado ») disparaît, fondu dans
--      celui-ci (choix 4) : une ligne camp/evento qui bloque la ressource y porte la mention du
--      blocage. notify_partner_camp_evento_blocked est supprimée. La valeur reste admise par la
--      contrainte notification_emails_event_type_check (lignes historiques).
--   5. create_order : nouveau paramètre p_client_note (drop explicite, règle supabase §7) ; une
--      commande sans rien à payer en ligne envoie le nouvel e-mail dès sa création (elle y envoyait
--      l'e-mail 8 : « la réservation est ferme dès maintenant », 20261023120000).
--   6. notify_order_confirmed : (b) appelle le nouvel e-mail, (d) (l'e-mail 8) disparaît.
--
-- Frontière RLS / RPC-only (CLAUDE.md §3) : orders et notification_emails restent RPC-only, aucune
-- policy ni grant de table nouveau. create_order est critique (§4.1) : son corps est repris de la
-- définition vivante (pg_get_functiondef) par remplacements comptés — la logique de capacité,
-- l'ordre des verrous et le squelette anti-survente sont inchangés ; la note n'est qu'une valeur
-- écrite dans l'insert de la commande.
--
-- Prouvé par supabase/tests/database/partner_order_confirmed_email.test.sql.

-- ============================================================================================
-- 0. La note du client
-- ============================================================================================

alter table public.orders add column client_note text;
alter table public.orders add constraint orders_client_note_length
  check (client_note is null or char_length(client_note) between 1 and 1000);

comment on column public.orders.client_note is
  'Note facultative laissée par le client au paiement, adressée aux prestataires de la commande '
  '(e-mail notify_partner_order_confirmed). 1 000 caractères au plus, jamais une chaîne vide '
  '(create_order la ramène à NULL). 20261112120000.';

-- ============================================================================================
-- 1. Reply-To des e-mails
-- ============================================================================================

alter table public.notification_emails add column reply_to text;

comment on column public.notification_emails.reply_to is
  'Adresse de réponse transmise à Resend (`reply_to`) : celle du client pour l''e-mail de '
  'réservation au prestataire. NULL = pas de Reply-To. 20261112120000.';

-- Nouvelle signature (paramètre ajouté) : drop explicite, sinon deux surcharges rendraient tout
-- appel à 5-7 arguments ambigu. Les appelants plpgsql résolvent par nom à l'exécution : aucun ne
-- change. Corps repris de 20261104130000, seul reply_to est ajouté.
drop function public.enqueue_notification_email(text, text, uuid, text, text, text, uuid);

CREATE FUNCTION public.enqueue_notification_email(p_event_type text, p_recipient_email text, p_recipient_account_id uuid, p_subject text, p_body_html text, p_related_table text DEFAULT NULL::text, p_related_id uuid DEFAULT NULL::uuid, p_reply_to text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  -- 20261104130000 : tour de revue d'une proposition (sa version), '' pour tout le reste.
  v_dedup_scope text := '';
begin
  if p_recipient_email is null or btrim(p_recipient_email) = '' then
    return null;
  end if;

  -- 20261104130000 : une proposition corrigée garde son identifiant. Sans portée, le dédoublonnage
  -- (événement, proposition, destinataire) jetterait en silence l'e-mail « corrigée » à l'admin,
  -- puis le verdict suivant au partenaire — dont l'approbation. La version de la proposition, qui
  -- change à chaque soumission et à chaque décision, distingue les tours ; un même événement
  -- rejoué (même version) reste dédoublonné.
  if p_related_id is not null and p_related_table = 'product_proposals' then
    select version::text into v_dedup_scope from public.product_proposals where id = p_related_id;
  elsif p_related_id is not null and p_related_table = 'establishment_proposals' then
    select version::text into v_dedup_scope from public.establishment_proposals where id = p_related_id;
  end if;
  v_dedup_scope := coalesce(v_dedup_scope, '');

  insert into public.notification_emails (
    event_type, recipient_email, recipient_account_id, subject, body_html, related_table, related_id,
    dedup_scope, reply_to
  )
  values (
    p_event_type, p_recipient_email, p_recipient_account_id, p_subject, p_body_html, p_related_table, p_related_id,
    v_dedup_scope, nullif(btrim(p_reply_to), '')
  )
  on conflict (
    event_type, related_table, related_id,
    coalesce(recipient_account_id, '00000000-0000-0000-0000-000000000000'::uuid), dedup_scope
  ) where related_id is not null
  do nothing
  returning id into v_id;

  return v_id;
end;
$function$;

-- Même ACL que la définition remplacée : postgres et service_role, jamais la Data API.
revoke all on function public.enqueue_notification_email(text, text, uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_notification_email(text, text, uuid, text, text, text, uuid, text) to service_role;

-- ============================================================================================
-- 2. Formateurs internes des e-mails (espagnol, sans dépendre de lc_time / lc_numeric)
-- ============================================================================================

-- 2026-12-19 → « viernes 19 dic. 2026 »
create function public.email_fecha_es(p_date date)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from p_date)::int + 1]
    || ' ' || extract(day from p_date)::int
    || ' ' || (array['ene.','feb.','mar.','abr.','may.','jun.','jul.','ago.','sept.','oct.','nov.','dic.'])[extract(month from p_date)::int]
    || ' ' || extract(year from p_date)::int
$$;

-- 16:30 → « 4:30 p. m. » ; 09:00 → « 9:00 a. m. »
create function public.email_hora_es(p_time time)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_time, 'FMHH12:MI') || case when extract(hour from p_time) < 12 then ' a. m.' else ' p. m.' end
$$;

-- 480000 → « $480.000 COP » (séparateur de milliers colombien)
create function public.email_cop(p_amount bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select '$' || regexp_replace(p_amount::text, '(\d)(?=(\d{3})+$)', '\1.', 'g') || ' COP'
$$;

revoke all on function public.email_fecha_es(date) from public, anon, authenticated, service_role;
revoke all on function public.email_hora_es(time) from public, anon, authenticated, service_role;
revoke all on function public.email_cop(bigint) from public, anon, authenticated, service_role;

-- ============================================================================================
-- 3. L'e-mail de réservation au prestataire
-- ============================================================================================

-- Un e-mail par compte de chaque partenaire propriétaire d'une prestation VIVANTE (status
-- 'reserved') de la commande ; il ne porte que les prestations de ce partenaire. Aucune garde de
-- paiement ici : les appelants décident du moment (notify_order_confirmed pour une commande payée,
-- create_order pour une commande sans rien à payer en ligne). Chaque envoi est isolé (spec 23
-- §8.1) : un échec ne fait jamais échouer l'appelant. INTERNE.
create function public.notify_partner_order_confirmed(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Gabarit d'une ligne « libellé : valeur » ; une valeur NULL fait disparaître la ligne entière.
  c_tr constant text := '<tr><td style="padding:4px 12px 4px 0;color:#5d6670;width:42%;vertical-align:top">';
  c_td constant text := '</td><td style="padding:4px 0;vertical-align:top">';
  c_end constant text := '</td></tr>';
  c_h3 constant text := '<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#5d6670;margin:22px 0 8px">';
  c_table constant text := '<table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px">';
  v_order record;
  v_admin_url text;
  v_reply_to text;
  v_phone text;
  v_client_html text;
  v_note_html text;
  v_partner record;
  v_account record;
  v_lines_html text;
  v_line_count int;
  v_subject text;
  v_body text;
begin
  select o.reference, o.holder_name, o.holder_email, o.holder_phone, o.client_note, o.payment_status
    into v_order
    from public.orders o where o.id = p_order_id;
  if not found then
    return;
  end if;

  select decrypted_secret into v_admin_url
    from vault.decrypted_secrets where name = 'admin_app_public_url';
  if v_admin_url is null then
    raise warning 'notify_partner_order_confirmed: secret Vault admin_app_public_url manquant — e-mail envoyé SANS lien vers la réservation (commande %)', p_order_id;
  end if;

  -- Une adresse sentinelle (`@hifago.local` : ligne manuelle, reprise legacy) n'est ni affichée ni
  -- mise en Reply-To — même règle que l'e-mail d'annulation (20261006192424).
  v_reply_to := case
    when v_order.holder_email is not null and v_order.holder_email not like '%@hifago.local'
      then nullif(btrim(v_order.holder_email), '')
  end;
  v_phone := nullif(btrim(v_order.holder_phone), '');

  v_client_html := c_h3 || 'Cliente</h3>' || c_table
    || c_tr || 'Nombre' || c_td || '<strong>' || coalesce(public.html_text(v_order.holder_name), '') || '</strong>' || c_end
    || coalesce(c_tr || 'WhatsApp' || c_td || '<a href="https://wa.me/' || regexp_replace(v_phone, '\D', '', 'g')
         || '" style="color:#0f6b5c">' || public.html_text(v_phone) || '</a>' || c_end, '')
    || coalesce(c_tr || 'Correo' || c_td || '<a href="mailto:' || public.html_text(v_reply_to)
         || '" style="color:#0f6b5c">' || public.html_text(v_reply_to) || '</a>' || c_end, '')
    || '</table>';

  -- La note : échappée PUIS ses retours à la ligne rendus en <br> (white-space:pre-line n'est pas
  -- lu par tous les clients de messagerie).
  v_note_html := coalesce(
    c_h3 || 'Nota del cliente</h3>'
      || '<div style="background:#fff8e6;border-left:3px solid #e9c46a;padding:10px 14px;border-radius:4px">'
      || replace(replace(public.html_text(v_order.client_note), E'\r', ''), E'\n', '<br>')
      || '</div>',
    ''
  );

  for v_partner in
    select distinct pr.partner_id, pt.display_name
      from public.order_lines ol
      join public.products pr on pr.id = ol.product_id
      join public.partners pt on pt.id = pr.partner_id
     where ol.order_id = p_order_id and ol.status = 'reserved'
  loop
    begin
      select
        string_agg(
          '<div style="border:1px solid #e4e7ea;border-radius:6px;padding:12px 14px;margin:0 0 10px">'
          || '<p style="margin:0;font-weight:bold">'
          || coalesce(public.html_text(coalesce(p.name ->> 'es', p.name ->> 'en')), 'Servicio') || '</p>'
          || coalesce('<p style="margin:0 0 8px;color:#5d6670;font-size:13px">'
               || public.html_text(coalesce(e.name ->> 'es', e.name ->> 'en')) || '</p>', '')
          || c_table
          -- Dates : séjour (end_date = jour de départ), période d'un camp/evento sur plusieurs jours,
          -- sinon un jour (et l'heure du créneau s'il y en a un).
          || case
               when ol.end_date is not null then
                 c_tr || 'Llegada' || c_td || public.email_fecha_es(ol.date) || c_end
                 || c_tr || 'Salida' || c_td || public.email_fecha_es(ol.end_date) || ' · '
                 || (ol.end_date - ol.date) || case when ol.end_date - ol.date = 1 then ' noche' else ' noches' end || c_end
               when p.type in ('camp', 'evento') and coalesce(p.duration_days, 1) > 1 then
                 c_tr || 'Fechas' || c_td || 'del ' || public.email_fecha_es(ol.date)
                 || ' al ' || public.email_fecha_es(ol.date + p.duration_days - 1) || c_end
               else
                 c_tr || 'Fecha' || c_td || public.email_fecha_es(ol.date)
                 || coalesce(' · ' || public.email_hora_es(ol.slot_start_time), '') || c_end
             end
          || c_tr || 'Cantidad' || c_td
          || case
               when p.type = 'lodging' then ol.qty || case when ol.qty = 1 then ' unidad' else ' unidades' end
               when ol.pricing_unit = 'per_hour' then ol.qty || case when ol.qty = 1 then ' hora' else ' horas' end
               when ol.pricing_unit = 'per_activity' then
                 case when ol.qty = 1 then 'actividad completa' else ol.qty || ' actividades' end
               else ol.qty || case when ol.qty = 1 then ' persona' else ' personas' end
             end || c_end
          -- Montants (choix 2) : ce que le client a déjà payé sur Hifago et ce qui reste à encaisser.
          || case
               when ol.total_cop = 0 then c_tr || 'Total' || c_td || 'Gratis' || c_end
               else
                 c_tr || 'Total' || c_td || public.email_cop(ol.total_cop) || c_end
                 || c_tr || 'Pagado en Hifago' || c_td || public.email_cop(ol.acompte_cop) || c_end
                 || '<tr><td style="padding:8px 12px 4px 0;font-weight:bold;border-top:1px solid #e4e7ea">Saldo a cobrar</td>'
                 || '<td style="padding:8px 0 4px;font-weight:bold;border-top:1px solid #e4e7ea">'
                 || public.email_cop(ol.total_cop - ol.acompte_cop) || c_end
             end
          || '</table>'
          -- Ex-e-mail 8 (choix 4) : la prestation bloque la ressource partagée de l'établissement.
          || case
               when p.type = 'camp' or (p.type = 'evento' and p.online_bookable and p.evento_occupies_resource) then
                 '<p style="margin:10px 0 0;font-size:13px;color:#5d6670">Recurso bloqueado '
                 || case when coalesce(p.duration_days, 1) > 1 then 'durante esas fechas' else 'ese día' end
                 || ': otras actividades que comparten este recurso pueden haber quedado no disponibles.</p>'
               else ''
             end
          || coalesce('<p style="margin:12px 0 0"><a href="' || v_admin_url || '/partner/reservations/' || ol.id
               || '" style="display:inline-block;background:#0f6b5c;color:#ffffff;text-decoration:none;'
               || 'padding:10px 18px;border-radius:6px;font-weight:bold">Ver la reserva</a></p>', '')
          || '</div>',
          ''
          order by ol.date, ol.slot_start_time nulls first, ol.created_at, ol.id
        ),
        count(*)
        into v_lines_html, v_line_count
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        left join public.establishments e on e.id = p.establishment_id
       where ol.order_id = p_order_id and ol.status = 'reserved' and p.partner_id = v_partner.partner_id;

      -- Sujet : texte brut (jamais échappé), sans retour à la ligne.
      v_subject := 'Nueva reserva confirmada · ' || v_order.reference || ' · '
        || regexp_replace(coalesce(v_order.holder_name, ''), '[\r\n]+', ' ', 'g');

      v_body := '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1d2329;max-width:560px">'
        || '<h2 style="font-size:19px;margin:0 0 4px">Nueva reserva confirmada</h2>'
        || '<p style="margin:0 0 18px;color:#5d6670;font-size:13px">Pedido <strong>' || public.html_text(v_order.reference)
        || '</strong> · confirmado el ' || public.email_fecha_es(public.today_in_bogota()) || '</p>'
        || '<p>Hola ' || coalesce(public.html_text(v_partner.display_name), '') || ',</p>'
        || '<p>' || coalesce(public.html_text(v_order.holder_name), 'Un cliente')
        || case when v_order.payment_status = 'paid' then ' reservó y pagó en Hifago.' else ' reservó en Hifago.' end
        || ' Estos son los datos de la reserva.</p>'
        || v_client_html
        || c_h3 || case when v_line_count = 1 then 'Tu reserva' else 'Tus reservas (' || v_line_count || ')' end || '</h3>'
        || v_lines_html
        || v_note_html
        || '<p style="color:#5d6670;font-size:12px;margin-top:24px;border-top:1px solid #e4e7ea;padding-top:12px">'
        || 'Escríbele a ' || coalesce(public.html_text(v_order.holder_name), 'tu cliente')
        || case
             when v_phone is not null and v_reply_to is not null then ' por WhatsApp o por correo'
             when v_phone is not null then ' por WhatsApp'
             when v_reply_to is not null then ' por correo'
             else ''
           end
        || ' para coordinar su llegada.'
        || case when v_reply_to is not null then ' Si respondes a este correo, tu respuesta le llega directamente.' else '' end
        || '<br>Si necesitas anular, hazlo desde tu espacio: el cliente recibe un aviso automático.</p>'
        || '</div>';
    exception
      when query_canceled then
        raise warning 'notify_partner_order_confirmed: corps annulé (query_canceled) pour partenaire % — %', v_partner.partner_id, sqlerrm;
        continue;
      when others then
        raise warning 'notify_partner_order_confirmed: échec du corps pour partenaire % — %', v_partner.partner_id, sqlerrm;
        continue;
    end;

    for v_account in
      select pa.id as account_id, au.email
        from public.partner_accounts pa
        join auth.users au on au.id = pa.id
       where pa.partner_id = v_partner.partner_id
    loop
      begin
        perform public.enqueue_notification_email(
          'partner_payment_confirmed', v_account.email, v_account.account_id,
          v_subject, v_body, 'orders', p_order_id, v_reply_to
        );
      exception
        when query_canceled then
          raise warning 'notify_partner_order_confirmed: notification annulée (query_canceled) pour compte % — %', v_account.account_id, sqlerrm;
        when others then
          raise warning 'notify_partner_order_confirmed: échec notification pour compte % — %', v_account.account_id, sqlerrm;
      end;
    end loop;
  end loop;
end;
$$;
revoke all on function public.notify_partner_order_confirmed(uuid) from public, anon, authenticated, service_role;

-- ============================================================================================
-- 4. L'e-mail 8 disparaît (fondu dans le précédent)
-- ============================================================================================

drop function public.notify_partner_camp_evento_blocked(uuid);

-- ============================================================================================
-- 5. create_order — paramètre p_client_note (drop explicite, règle supabase §7)
-- ============================================================================================

drop function public.create_order(text, text, text, boolean);

CREATE FUNCTION public.create_order(p_holder_name text, p_holder_email text DEFAULT NULL::text, p_holder_phone text DEFAULT NULL::text, p_marketing_consent boolean DEFAULT false, p_client_note text DEFAULT NULL::text)
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
  end if;

  return jsonb_build_object('ok', true, 'order_id', v_order_id);
end;
$function$;

-- create_order : même ACL que la définition remplacée (Data API comprise : le tunnel l'appelle).
grant execute on function public.create_order(text, text, text, boolean, text) to anon, authenticated, service_role;

-- ============================================================================================
-- 6. notify_order_confirmed — (b) appelle le nouvel e-mail, (d) disparaît
-- ============================================================================================

CREATE OR REPLACE FUNCTION public.notify_order_confirmed(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_referrer_account record;
  v_order record;
  v_order_summary text;
  v_site_url text;
  v_contacts text;
begin
  if not exists (select 1 from public.orders o where o.id = p_order_id and o.payment_status = 'paid') then
    return;
  end if;

  -- (a) commission attribuée — un email par compte du/des référent(s) externe(s) distinct(s).
  for v_referrer_account in
    select distinct pa.id as account_id, au.email
      from public.order_lines ol
      join public.partner_accounts pa on pa.partner_id = ol.referrer_partner_id
      join auth.users au on au.id = pa.id
     where ol.order_id = p_order_id and ol.commission_case = 'external_referrer'
  loop
    begin
      perform public.enqueue_notification_email(
        'partner_commission_earned', v_referrer_account.email, v_referrer_account.account_id,
        'Nueva comisión asignada',
        '<p>Se te asignó una comisión por una reserva confirmada.</p>',
        'orders', p_order_id
      );
    exception
      when query_canceled then
        raise warning 'notify_order_confirmed: notification commission annulée (query_canceled) pour compte % — %', v_referrer_account.account_id, sqlerrm;
      when others then
        raise warning 'notify_order_confirmed: échec notification commission pour compte % — %', v_referrer_account.account_id, sqlerrm;
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
      from public.orders where id = p_order_id;

    select decrypted_secret into v_site_url
      from vault.decrypted_secrets where name = 'web_app_public_url';
    if v_site_url is null then
      raise warning 'notify_order_confirmed: secret Vault web_app_public_url manquant — email de confirmation envoyé SANS lien vers la réserve (commande %)', p_order_id;
    end if;

    -- Migration 20261002160349 : valeurs venues des données échappées (html_text) — nom de
    -- produit, nom du titulaire, référence. Le sujet est du texte brut.
    select string_agg(
      '<li>' || coalesce(public.html_text(p.name ->> 'es'), 'Producto') || ' — ' || ol.date
        || coalesce(' a ' || ol.end_date, '') || ' — $' || ol.total_cop || ' COP</li>',
      ''
    ) into v_order_summary
    from public.order_lines ol join public.products p on p.id = ol.product_id
    where ol.order_id = p_order_id;

    -- 20261019170000 (décision Jérôme) : le WhatsApp de chaque prestataire de la commande, une
    -- fois par établissement — c'est ce numéro qui sert de contact pour tous ses services. Les
    -- lignes mortes n'en donnent pas : un service annulé ne justifie plus le contact.
    select string_agg(
      '<li>' || coalesce(public.html_text(c.name ->> 'es'), 'Prestador') || ' — <a href="https://wa.me/'
        || substr(c.contact_phone, 2) || '">' || public.html_text(c.contact_phone) || '</a></li>',
      '' order by c.name ->> 'es'
    ) into v_contacts
    from (
      select distinct e.id, e.name, e.contact_phone
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        join public.establishments e on e.id = p.establishment_id
       where ol.order_id = p_order_id and e.contact_phone is not null
         and ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded')
    ) c;

    perform public.enqueue_notification_email(
      'client_order_confirmed', v_order.holder_email, null,
      'Reserva ' || v_order.reference || ' confirmada',
      '<p>Hola ' || coalesce(public.html_text(v_order.holder_name), '') || ', tu reserva fue confirmada.</p>'
        || '<p>Número de reserva : <strong>' || public.html_text(v_order.reference) || '</strong></p>'
        || '<ul>' || coalesce(v_order_summary, '') || '</ul>'
        || coalesce('<p>Para coordinar tus servicios, escríbele directamente a tu prestador por WhatsApp:</p><ul>'
             || v_contacts || '</ul>', '')
        || coalesce(
             '<p><a href="' || v_site_url || '/reserva/' || v_order.access_token || '">'
               || 'Ver tu reserva</a> — guarda este enlace, puedes volver a abrirlo cuando quieras.</p>',
             ''
           ),
      'orders', p_order_id
    );
  exception
    when query_canceled then
      raise warning 'notify_order_confirmed: notification client annulée (query_canceled) pour commande % — %', p_order_id, sqlerrm;
    when others then
      raise warning 'notify_order_confirmed: échec notification client pour commande % — %', p_order_id, sqlerrm;
  end;
end;
$function$;
