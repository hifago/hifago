-- Tous les e-mails de la plateforme aux couleurs de la charte Hifago (décision Jérôme du 2026-11-12 :
-- « le même style pour tous les mails envoyés à tout le monde, tout le temps »).
--
-- UN SEUL POINT DE PASSAGE. Les 15 types d'e-mail (contrainte notification_emails_event_type_check)
-- entrent tous dans la file par enqueue_notification_email — notify_all_admins compris, aucun insert
-- direct ailleurs (vérifié sur la base locale le 2026-11-12). C'est donc LÀ que l'habillage est posé :
-- un e-mail ajouté demain le reçoit sans y penser. Prouvé par charte_tous_les_emails.test.sql.
--
-- Ce que fait cette migration :
--   1. email_layout(titre, contenu) : l'habillage commun — fond clair #f0f6fc, colonne de 600 px,
--      en-tête image, panneau blanc, pied de page marine (« Hifago · Guatapé, Antioquia » + lien or).
--      Les liens nus des anciens corps (`<a href="…">`) prennent le bleu moyen souligné de la charte.
--   2. enqueue_notification_email : enveloppe chaque corps dans email_layout. Titre = le SUJET, sauf
--      si le corps commence par son propre <h2> (e-mails client, prestataire, invitation). Un corps
--      déjà habillé (marqueur data-hifago-email) n'est jamais habillé deux fois.
--   3. notify_partner_order_confirmed (20261112120000) : couleurs de la charte, briques partagées —
--      contenu, logique, destinataires et dédoublonnage inchangés.
--   4. partner_invitation_email_html (20261019130000) : son propre bandeau « HIFAGO » retiré,
--      remplacé par l'habillage commun ; textes, liste et durée de validité inchangés.
--
-- En-tête : l'image `apps/web/public/brand/email-cabecera.jpg` (l'image de partage de la vitrine en
-- JPEG — Outlook ne lit pas le WebP), servie par la vitrine sous le secret Vault web_app_public_url,
-- à adresse ABSOLUE. Secret manquant : un bandeau or « hifago · Guatapé » en texte, jamais une image
-- à adresse relative qu'aucune messagerie ne chargerait. ⚠️ L'image vient avec le CODE de la vitrine :
-- la pousser dans le même lot que cette migration.
-- Charte : docs/specs/41-charte-hifago-toute-la-vitrine.md §0 et §3 ; briques email_titulo,
-- email_seccion, email_boton (20261112140000). Polices Anton/Poppins avec replis Impact/Arial (Gmail
-- ne charge pas les polices web).
--
-- Hors base : les trois gabarits Supabase Auth (supabase/templates/*.html) reçoivent le même
-- habillage en HTML statique, dans le même lot.
--
-- Frontière RLS / RPC-only (CLAUDE.md §3) : aucune table, aucun grant nouveau ; email_layout est
-- interne (révoquée pour tous les rôles), les fonctions remplacées gardent signature et ACL.

-- ============================================================================================
-- 1. L'habillage commun
-- ============================================================================================

create function public.email_layout(p_titulo text, p_contenido text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_url text;
  v_header text;
begin
  select decrypted_secret into v_site_url
    from vault.decrypted_secrets where name = 'web_app_public_url';

  v_header := coalesce(
    '<a href="' || v_site_url || '" style="display:block;text-decoration:none">'
      || '<img src="' || v_site_url || '/brand/email-cabecera.jpg" width="600" '
      || 'alt="Hifago · Guatapé merece más de un día." '
      || 'style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:16px 16px 0 0"></a>',
    '<div style="background:#ddae09;color:#132f61;padding:20px 24px;border-radius:16px 16px 0 0;'
      || 'font-family:Anton,Impact,sans-serif;font-weight:400;font-size:28px;line-height:1.1">hifago · Guatapé</div>'
  );

  return '<div data-hifago-email="1" style="background:#f0f6fc;padding:24px 12px;'
    || 'font-family:Poppins,Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#132f61">'
    || '<div style="max-width:600px;margin:0 auto">'
    || v_header
    || '<div style="background:#ffffff;padding:24px">'
    || coalesce(public.email_titulo(nullif(btrim(p_titulo), '')), '')
    -- Liens nus des anciens corps (href seul) : bleu moyen souligné. Un lien qui porte déjà son style
    -- (bouton, WhatsApp) n'a pas cette forme exacte et reste tel quel.
    || regexp_replace(coalesce(p_contenido, ''), '<a href="([^"]*)">',
         '<a href="\1" style="color:#2a618e;text-decoration:underline">', 'g')
    || '</div>'
    || '<div style="background:#132f61;color:#ffffff;padding:18px 24px;border-radius:0 0 16px 16px;font-size:13px">'
    || '<p style="margin:0;color:#b6cde8">Hifago · Guatapé, Antioquia'
    || coalesce(' · <a href="' || v_site_url || '" style="color:#ddae09;text-decoration:underline">'
         || public.html_text(regexp_replace(v_site_url, '^https?://', '')) || '</a>', '')
    || '</p></div>'
    || '</div></div>';
end;
$$;
revoke all on function public.email_layout(text, text) from public, anon, authenticated, service_role;

-- ============================================================================================
-- 2. enqueue_notification_email — chaque corps passe par l'habillage
-- ============================================================================================

-- Même signature que 20261112120000 : create or replace, ACL inchangée. Corps repris, seul
-- l'habillage (v_body) est ajouté.
CREATE OR REPLACE FUNCTION public.enqueue_notification_email(p_event_type text, p_recipient_email text, p_recipient_account_id uuid, p_subject text, p_body_html text, p_related_table text DEFAULT NULL::text, p_related_id uuid DEFAULT NULL::uuid, p_reply_to text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  -- 20261104130000 : tour de revue d'une proposition (sa version), '' pour tout le reste.
  v_dedup_scope text := '';
  v_body text;
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

  -- 20261112150000 : l'habillage de la charte, pour TOUS les e-mails. Titre = le sujet, sauf si le
  -- corps porte déjà son <h2>. Jamais deux fois (marqueur data-hifago-email).
  v_body := case
    when p_body_html like '%data-hifago-email%' then p_body_html
    else public.email_layout(
      case when p_body_html ~ '^\s*<h2[\s>]' then null else p_subject end,
      p_body_html
    )
  end;

  insert into public.notification_emails (
    event_type, recipient_email, recipient_account_id, subject, body_html, related_table, related_id,
    dedup_scope, reply_to
  )
  values (
    p_event_type, p_recipient_email, p_recipient_account_id, p_subject, v_body, p_related_table, p_related_id,
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

-- ============================================================================================
-- 3. L'e-mail de réservation au prestataire, aux couleurs de la charte
-- ============================================================================================

-- Corps repris de la définition vivante (20261112120000) : seuls les styles changent (palette de la
-- charte, briques partagées) et le corps n'est plus que le contenu (l'habillage vient de l'étape 2).
CREATE OR REPLACE FUNCTION public.notify_partner_order_confirmed(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- Gabarit d'une ligne « libellé : valeur » ; une valeur NULL fait disparaître la ligne entière.
  c_tr constant text := '<tr><td style="padding:4px 12px 4px 0;color:#2a618e;width:42%;vertical-align:top">';
  c_td constant text := '</td><td style="padding:4px 0;color:#132f61;vertical-align:top">';
  c_end constant text := '</td></tr>';
  c_table constant text := '<table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px">';
  c_link constant text := '" style="color:#2a618e;text-decoration:underline">';
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

  v_client_html := public.email_seccion('Cliente') || c_table
    || c_tr || 'Nombre' || c_td || '<strong>' || coalesce(public.html_text(v_order.holder_name), '') || '</strong>' || c_end
    || coalesce(c_tr || 'WhatsApp' || c_td || '<a href="https://wa.me/' || regexp_replace(v_phone, '\D', '', 'g')
         || c_link || public.html_text(v_phone) || '</a>' || c_end, '')
    || coalesce(c_tr || 'Correo' || c_td || '<a href="mailto:' || public.html_text(v_reply_to)
         || c_link || public.html_text(v_reply_to) || '</a>' || c_end, '')
    || '</table>';

  -- La note : échappée PUIS ses retours à la ligne rendus en <br> (white-space:pre-line n'est pas
  -- lu par tous les clients de messagerie). Encadré clair, filet or.
  v_note_html := coalesce(
    public.email_seccion('Nota del cliente')
      || '<div style="background:#f0f6fc;border-left:3px solid #ddae09;padding:10px 14px;border-radius:4px;color:#132f61">'
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
          '<div style="border:1px solid #132f61;border-radius:16px;padding:14px 16px;margin:0 0 12px;background:#ffffff">'
          || '<p style="margin:0;font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:14px;color:#132f61">'
          || coalesce(public.html_text(coalesce(p.name ->> 'es', p.name ->> 'en')), 'Servicio') || '</p>'
          || coalesce('<p style="margin:2px 0 10px;color:#2a618e;font-size:13px">'
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
                 || '<tr><td style="padding:8px 12px 4px 0;font-weight:bold;color:#132f61;border-top:1px solid #132f61">Saldo a cobrar</td>'
                 || '<td style="padding:8px 0 4px;font-weight:bold;color:#132f61;border-top:1px solid #132f61">'
                 || public.email_cop(ol.total_cop - ol.acompte_cop) || c_end
             end
          || '</table>'
          -- Ex-e-mail 8 (choix 4) : la prestation bloque la ressource partagée de l'établissement.
          || case
               when p.type = 'camp' or (p.type = 'evento' and p.online_bookable and p.evento_occupies_resource) then
                 '<p style="margin:10px 0 0;font-size:13px;color:#2a618e">Recurso bloqueado '
                 || case when coalesce(p.duration_days, 1) > 1 then 'durante esas fechas' else 'ese día' end
                 || ': otras actividades que comparten este recurso pueden haber quedado no disponibles.</p>'
               else ''
             end
          || coalesce(public.email_boton(v_admin_url || '/partner/reservations/' || ol.id, 'Ver la reserva'), '')
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

      -- Le CONTENU seulement, qui commence par son titre : l'habillage vient d'enqueue_notification_email.
      v_body := public.email_titulo('Nueva reserva confirmada')
        || '<p style="margin:0 0 18px;color:#2a618e;font-size:13px">Pedido <strong style="color:#132f61">' || public.html_text(v_order.reference)
        || '</strong> · confirmado el ' || public.email_fecha_es(public.today_in_bogota()) || '</p>'
        || '<p style="margin:0 0 10px">Hola ' || coalesce(public.html_text(v_partner.display_name), '') || ',</p>'
        || '<p style="margin:0">' || coalesce(public.html_text(v_order.holder_name), 'Un cliente')
        || case when v_order.payment_status = 'paid' then ' reservó y pagó en Hifago.' else ' reservó en Hifago.' end
        || ' Estos son los datos de la reserva.</p>'
        || v_client_html
        || public.email_seccion(case when v_line_count = 1 then 'Tu reserva' else 'Tus reservas (' || v_line_count || ')' end)
        || v_lines_html
        || v_note_html
        || '<p style="margin:24px 0 0;color:#2a618e;font-size:13px">'
        || 'Escríbele a ' || coalesce(public.html_text(v_order.holder_name), 'tu cliente')
        || case
             when v_phone is not null and v_reply_to is not null then ' por WhatsApp o por correo'
             when v_phone is not null then ' por WhatsApp'
             when v_reply_to is not null then ' por correo'
             else ''
           end
        || ' para coordinar su llegada.'
        || case when v_reply_to is not null then ' Si respondes a este correo, tu respuesta le llega directamente.' else '' end
        || '<br>Si necesitas anular, hazlo desde tu espacio: el cliente recibe un aviso automático.</p>';
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
$function$;

-- ============================================================================================
-- 4. L'invitation partenaire : son bandeau propre remplacé par l'habillage commun
-- ============================================================================================

-- Même signature, ACL inchangée (service_role seulement, service_role_only_functions.test.sql).
-- Textes repris de 20261019130000 ; la première phrase devient le titre (le sujet de l'e-mail).
CREATE OR REPLACE FUNCTION public.partner_invitation_email_html(p_join_url text, p_onboarding_path text, p_display_name text, p_expires_days integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    public.email_titulo('Te damos la bienvenida a Hifago')
    || '<p>Hola' || coalesce(' ' || public.html_text(nullif(btrim(p_display_name), '')), '') || ',</p>'
    || '<p>Con este enlace creas tu cuenta de socio: solo eliges una contraseña y entras directamente a tu espacio.</p>'
    || '<p>Desde allí podrás:</p>'
    || '<ul>'
    || case when p_onboarding_path = 'provider' then
         '<li>completar la ficha de tu establecimiento y de tus servicios,</li>'
         || '<li>gestionar tu disponibilidad y tus reservas,</li>'
         || '<li>compartir tu enlace y tu código QR, y seguir tus comisiones.</li>'
       else
         '<li>obtener tu enlace y tu código QR para recomendar Hifago,</li>'
         || '<li>seguir las comisiones que generan tus recomendaciones.</li>'
       end
    || '</ul>'
    || coalesce(public.email_boton(p_join_url, 'Crear mi cuenta'), '')
    || '<p style="font-size:13px;color:#2a618e">Este enlace es personal, se usa una sola vez y '
    || case
         when p_expires_days is null then 'vence pronto'
         when p_expires_days = 1 then 'vence en 1 día'
         else 'vence en ' || p_expires_days || ' días'
       end
    || '. Regístrate con esta misma dirección de correo.</p>'
$function$;
