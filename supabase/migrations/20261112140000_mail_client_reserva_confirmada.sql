-- E-mail de confirmation au client remis au niveau de l'e-mail prestataire (décision Jérôme du
-- 2026-11-12, après lecture du rendu de l'ancien gabarit). L'ancien corps affichait `2026-12-19` et
-- `$480000 COP`, ne disait ni l'anticipo payé ni le solde à régler sur place, listait aussi les
-- prestations annulées, et n'avait aucune mise en page.
--
-- Ce que fait cette migration : le bloc (c) de notify_order_confirmed devient une fonction à part,
-- notify_client_order_confirmed (que create_order appelle aussi quand rien n'est dû en ligne,
-- 20261112160000), au corps refait — même événement
-- (`client_order_confirmed`), même destinataire (holder_email), même sujet, même dédoublonnage,
-- même lien vers /reserva/<jeton> (secret Vault web_app_public_url, envoyé sans lien s'il manque).
-- Les blocs (a) commission et (b) e-mail prestataire sont repris tels quels de 20261112120000.
--
-- Le nouveau corps, sur le modèle de notify_partner_order_confirmed (20261112120000) :
--   - une carte par prestation VIVANTE (status 'reserved'), triée par date : nom, établissement,
--     dates en toutes lettres (séjour : arrivée, départ, nuits ; camp/evento de plusieurs jours :
--     période ; sinon jour et heure du créneau), quantité, montants ;
--   - montants avec les libellés de la page /reserva (apps/web/messages/es/OrderResultPage.json) :
--     Total, « Anticipo (pago en línea) », « A pagar en el establecimiento » ;
--   - un récapitulatif des montants dès qu'il y a plus d'une prestation ;
--   - le WhatsApp de chaque établissement, une fois par établissement (20261019170000) ;
--   - le lien « Ver tu reserva » en bouton.
-- Formateurs : email_fecha_es, email_hora_es, email_cop (20261112120000).
--
-- Charte Hifago (docs/specs/41-charte-hifago-toute-la-vitrine.md §0 et §3, demande de Jérôme du même
-- jour) : texte marine #132f61, texte discret et liens en bleu moyen #2a618e (sur clair seulement) ;
-- cartes à bordure marine arrondies à 16 px. Trois briques partagées par tous les e-mails, créées
-- ici : email_titulo (titre Anton 400 + point or), email_seccion (titre de section Anton 20 px, point
-- or, trait marine), email_boton (or + texte marine, 48 px, rayon 8 px — D4). L'habillage commun
-- (en-tête image, panneau blanc, pied marine) est posé par enqueue_notification_email
-- (20261112150000) : ce corps n'est que le CONTENU, il commence par son propre titre.
-- Les polices de la charte (Anton, Poppins) ne se chargent pas dans Gmail : replis Impact, Arial.
--
-- Frontière RLS / RPC-only (CLAUDE.md §3) : aucune table, aucun grant nouveau ; la fonction reste
-- interne (ACL inchangée par create or replace, même signature).
--
-- Prouvé par supabase/tests/database/client_order_confirmed_email.test.sql ; l'échappement par
-- notification_html_escaping.test.sql (W1-W3b, S1).

-- ============================================================================================
-- Briques de la charte, partagées par tous les e-mails (INTERNES : appelées par des fonctions
-- SECURITY DEFINER seulement). Texte brut en entrée, échappé ici (html_text).
-- ============================================================================================

-- Titre d'un e-mail : Anton 400, « titre à point » or. Pas de second point si le texte finit déjà
-- par une ponctuation (un sujet repris en titre peut en porter une).
create function public.email_titulo(p_texto text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select '<h2 style="font-family:Anton,Impact,sans-serif;font-weight:400;font-size:30px;line-height:1.15;'
    || 'color:#132f61;margin:0 0 6px">' || public.html_text(p_texto)
    || case when p_texto ~ '[.!?…:]\s*$' then '' else '<span style="color:#ddae09">.</span>' end
    || '</h2>'
$$;

-- Titre de section : Anton 20 px (jamais moins), point or, trait marine.
create function public.email_seccion(p_texto text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select '<h3 style="font-family:Anton,Impact,sans-serif;font-weight:400;font-size:20px;line-height:1.2;'
    || 'color:#132f61;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #132f61">'
    || public.html_text(p_texto) || '<span style="color:#ddae09">.</span></h3>'
$$;

-- Bouton principal : or + texte marine, 48 px de haut, rayon 8 px (D4). STRICT : sans URL, pas de
-- bouton (NULL) — l'appelant l'enveloppe dans un coalesce. L'URL vient des appelants (Vault,
-- jeton généré, identifiant), jamais d'une saisie.
create function public.email_boton(p_url text, p_texto text)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select '<p style="margin:28px 0 8px"><a href="' || p_url || '" style="display:inline-block;background:#ddae09;'
    || 'color:#132f61;text-decoration:none;font-weight:700;font-size:16px;line-height:20px;padding:14px 24px;'
    || 'border-radius:8px">' || public.html_text(p_texto) || '</a></p>'
$$;

revoke all on function public.email_titulo(text) from public, anon, authenticated, service_role;
revoke all on function public.email_seccion(text) from public, anon, authenticated, service_role;
revoke all on function public.email_boton(text, text) from public, anon, authenticated, service_role;

-- L'e-mail de confirmation au client, sorti de notify_order_confirmed (bloc (c)) pour servir aussi
-- à create_order : une commande sans rien à payer en ligne est ferme dès sa création et doit le
-- recevoir (20261112160000). AUCUNE garde de paiement ici : les appelants décident du moment
-- (notify_order_confirmed pour une commande payée, create_order quand rien n'est dû en ligne). La
-- phrase d'accueil suit l'état de paiement. Un seul e-mail par commande (dédoublonnage de la file).
-- SPEC 33 : il porte le numéro et le lien vers /reserva/<jeton> (cahier client §2b.9) — pour un
-- client sans compte, c'est son canal de suivi. URL publique du VAULT (web_app_public_url) ; secret
-- manquant : la confirmation part quand même, sans lien. INTERNE.
create function public.notify_client_order_confirmed(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  -- Gabarit d'une ligne « libellé : valeur », aux couleurs de la charte (voir l'en-tête).
  c_tr constant text := '<tr><td style="padding:4px 12px 4px 0;color:#2a618e;width:46%;vertical-align:top">';
  c_td constant text := '</td><td style="padding:4px 0;color:#132f61;vertical-align:top">';
  c_end constant text := '</td></tr>';
  c_table constant text := '<table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px">';
  c_total_tr constant text := '<tr><td style="padding:8px 12px 4px 0;font-weight:bold;color:#132f61;border-top:1px solid #132f61">';
  c_total_td constant text := '</td><td style="padding:8px 0 4px;font-weight:bold;color:#132f61;border-top:1px solid #132f61">';
  v_order record;
  v_site_url text;
  v_lines_html text;
  v_line_count int;
  v_total bigint;
  v_acompte bigint;
  v_establishment_count int;
  v_summary_html text;
  v_contacts text;
begin
  select holder_name, holder_email, reference, access_token, payment_status into v_order
    from public.orders where id = p_order_id;

  select decrypted_secret into v_site_url
    from vault.decrypted_secrets where name = 'web_app_public_url';
  if v_site_url is null then
    raise warning 'notify_client_order_confirmed: secret Vault web_app_public_url manquant — email de confirmation envoyé SANS lien vers la réserve (commande %)', p_order_id;
  end if;

  -- Une carte par prestation vivante. Valeurs venues des données échappées (html_text) ; dates,
  -- heures et montants sortent des formateurs.
  select
    string_agg(
      '<div style="border:1px solid #132f61;border-radius:16px;padding:14px 16px;margin:0 0 12px;background:#ffffff">'
      || '<p style="margin:0;font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:14px;color:#132f61">'
      || coalesce(public.html_text(coalesce(p.name ->> 'es', p.name ->> 'en')), 'Servicio') || '</p>'
      || coalesce('<p style="margin:2px 0 10px;color:#2a618e;font-size:13px">'
           || public.html_text(coalesce(e.name ->> 'es', e.name ->> 'en')) || '</p>', '')
      || c_table
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
      || case
           when ol.total_cop = 0 then c_tr || 'Total' || c_td || 'Gratis' || c_end
           else
             c_tr || 'Total' || c_td || public.email_cop(ol.total_cop) || c_end
             || c_tr || 'Anticipo (pago en línea)' || c_td || public.email_cop(ol.acompte_cop) || c_end
             || c_total_tr || 'A pagar en el establecimiento' || c_total_td
             || public.email_cop(ol.total_cop - ol.acompte_cop) || c_end
         end
      || '</table></div>',
      ''
      order by ol.date, ol.slot_start_time nulls first, ol.created_at, ol.id
    ),
    count(*),
    coalesce(sum(ol.total_cop), 0),
    coalesce(sum(ol.acompte_cop), 0),
    count(distinct p.establishment_id)
    into v_lines_html, v_line_count, v_total, v_acompte, v_establishment_count
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
    left join public.establishments e on e.id = p.establishment_id
   where ol.order_id = p_order_id and ol.status = 'reserved';

  -- Récapitulatif : seulement quand il y a plusieurs prestations (une seule : sa carte suffit).
  v_summary_html := case
    when v_line_count > 1 and v_total > 0 then
      public.email_seccion('Resumen') || c_table
      || c_tr || 'Total' || c_td || public.email_cop(v_total) || c_end
      || c_tr || 'Anticipo (pago en línea)' || c_td || public.email_cop(v_acompte) || c_end
      || c_total_tr
      || case when v_establishment_count > 1 then 'A pagar en los establecimientos' else 'A pagar en el establecimiento' end
      || c_total_td || public.email_cop(v_total - v_acompte) || c_end
      || '</table>'
    else ''
  end;

  -- 20261019170000 (décision Jérôme) : le WhatsApp de chaque prestataire de la commande, une
  -- fois par établissement — c'est ce numéro qui sert de contact pour tous ses services. Les
  -- lignes mortes n'en donnent pas : un service annulé ne justifie plus le contact.
  select string_agg(
    c_tr || coalesce(public.html_text(c.name ->> 'es'), 'Prestador') || c_td
      || '<a href="https://wa.me/' || substr(c.contact_phone, 2) || '" style="color:#2a618e;text-decoration:underline">'
      || public.html_text(c.contact_phone) || '</a>' || c_end,
    '' order by c.name ->> 'es'
  ) into v_contacts
  from (
    select distinct e.id, e.name, e.contact_phone
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
      join public.establishments e on e.id = p.establishment_id
     where ol.order_id = p_order_id and e.contact_phone is not null
       and ol.status = 'reserved'
  ) c;

  -- Le CONTENU seulement : en-tête, panneau et pied sont posés par enqueue_notification_email
  -- (email_layout, 20261112150000). Le corps commence par son titre : l'habillage n'en ajoute pas.
  perform public.enqueue_notification_email(
    'client_order_confirmed', v_order.holder_email, null,
    'Reserva ' || v_order.reference || ' confirmada',
    public.email_titulo('Tu reserva está confirmada')
      || '<p style="margin:0 0 18px;color:#2a618e;font-size:13px">Reserva <strong style="color:#132f61">' || public.html_text(v_order.reference)
      || '</strong> · confirmada el ' || public.email_fecha_es(public.today_in_bogota()) || '</p>'
      || '<p style="margin:0 0 10px">Hola ' || coalesce(public.html_text(v_order.holder_name), '') || ',</p>'
      || '<p style="margin:0">' || case when v_order.payment_status = 'paid'
             then 'Recibimos tu pago y tu reserva está confirmada.'
             else 'Tu reserva está confirmada: no tienes ningún pago pendiente en línea.' end
        || ' Estos son los detalles.</p>'
      || public.email_seccion(case when v_line_count = 1 then 'Tu reserva' else 'Tus reservas (' || v_line_count || ')' end)
      || coalesce(v_lines_html, '')
      || v_summary_html
      || coalesce(
           public.email_seccion('Contacto')
             || '<p style="margin:0 0 6px">Para coordinar tu llegada, escríbele directamente a tu prestador por WhatsApp:</p>'
             || c_table || v_contacts || '</table>',
           ''
         )
      || coalesce(
           public.email_boton(v_site_url || '/reserva/' || v_order.access_token, 'Ver tu reserva')
             || '<p style="margin:0;color:#2a618e;font-size:13px">Guarda este enlace: puedes volver a abrirlo cuando quieras.</p>',
           ''
         )
      || case when v_total > v_acompte
             then '<p style="margin:24px 0 0;color:#2a618e;font-size:13px">El saldo se paga directamente al establecimiento, con los medios que este acepte.</p>'
             else '' end,
    'orders', p_order_id
  );
end;
$function$;
revoke all on function public.notify_client_order_confirmed(uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_order_confirmed(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_referrer_account record;
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
