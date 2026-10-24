-- Le prestataire ne voit plus comme une RÉSERVATION une ligne dont le paiement n'est pas fait
-- (2026-10-24, option A de l'orchestrateur après le test en prod de Gabriel).
--
-- LA CONFUSION. `order_lines.status = 'reserved'` tient la place PENDANT le paiement (create_order le pose
-- avant tout encaissement). Un paiement refusé ou jamais fait laisse la ligne `reserved` jusqu'à
-- l'expiration — et partner_agenda_order_lines, partner_reservations_list et partner_reservation_detail
-- la rendaient au prestataire comme une réservation confirmée, sans aucune notion de paiement (il ne lit
-- pas `orders`). Même principe que le WhatsApp du prestataire, masqué avant le paiement
-- (20261019170000).
--
-- LA RÈGLE (`order_awaits_payment`). Une ligne `reserved` est masquée quand sa commande est `unpaid` ou
-- `pending` ET porte un acompte dû (somme des `acompte_cop` des lignes vivantes > 0). Restent visibles :
-- une commande payée (même en `confirming` / `paid_unconfirmed`, le prestataire doit la voir), une commande
-- SANS acompte dû (evento gratuit / sur place, réservations manuelles du prestataire — `acompte_cop = 0`,
-- `payment_status` resté `unpaid` pour toujours) et tout autre statut de ligne (réalisée, absence,
-- annulée…). `acompte_cop` est NOT NULL : il n'y a pas d'acompte « inconnu » à fermer.
--
-- AUTRES DÉCISIONS DE GABRIEL / DE L'ORCHESTRATEUR (2026-10-24) :
--   - une ligne `expired` / annulée d'une commande jamais payée RESTE visible dans la liste et le détail
--     (« Expirada »), mais SANS téléphone ni e-mail du client (`line_never_paid`) : masquer la ligne
--     vivante n'a de sens que si les coordonnées ne ressortent pas par la ligne morte ;
--   - la commande entière attend son paiement dès qu'une de ses lignes vivantes porte un acompte : une
--     ligne gratuite d'une commande à payer est masquée avec elle (même lecture que le client) ;
--   - l'e-mail « Reserva anulada » au prestataire (`partner_order_line_cancelled`) ne part plus pour une
--     ligne jamais confirmée (`notify_order_line_cancelled`) : il ne l'a jamais vue. Le client, lui,
--     reçoit toujours le sien.
--
-- Le dashboard socio et ses compteurs lisent partner_agenda_order_lines : ils suivent sans changement. La
-- disponibilité (get_product_slots, calendriers) compte toujours une ligne tenue — la place EST prise.
--
-- Redéfinitions `create or replace` depuis les définitions VIVANTES, rien d'autre ne bouge (signatures,
-- grants, search_path inchangés ; le seul ajout est le prédicat marqué « Migration 20261024120000 »).

create function public.order_awaits_payment(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select o.payment_status in ('unpaid', 'pending')
            and coalesce((
              select sum(l.acompte_cop)
                from public.order_lines l
               where l.order_id = o.id and l.status in ('reserved', 'fulfilled', 'no_show')
            ), 0) > 0
       from public.orders o
      where o.id = p_order_id),
    false);
$$;
-- INTERNE : appelée par les trois RPC prestataire (security definer, même propriétaire) — jamais par un
-- client. Une fonction neuve est exécutable par PUBLIC tant qu'un revoke explicite ne la ferme pas.
revoke all on function public.order_awaits_payment(uuid) from public, anon, authenticated;

-- Une LIGNE (vivante ou morte) que le prestataire n'a jamais eu à voir comme une réservation : sa commande
-- n'est pas payée (`unpaid` / `pending`) ET soit elle portait elle-même un acompte, soit la commande
-- attend encore son paiement par ses autres lignes vivantes. Une ligne gratuite d'une commande
-- entièrement gratuite (evento gratuit / sur place, réservation manuelle) n'en est pas une : elle était
-- ferme. Sert à masquer les coordonnées d'une ligne morte et à taire l'e-mail d'annulation du prestataire.
create function public.line_never_paid(p_order_line_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select o.payment_status in ('unpaid', 'pending')
            and (l.acompte_cop > 0 or public.order_awaits_payment(l.order_id))
       from public.order_lines l
       join public.orders o on o.id = l.order_id
      where l.id = p_order_line_id),
    false);
$$;
revoke all on function public.line_never_paid(uuid) from public, anon, authenticated;

create or replace function public.partner_agenda_order_lines(p_date_from date, p_date_to date)
returns table (
  id uuid,
  date date,
  end_date date,
  slot_start_time time,
  qty int,
  status text,
  holder_name text,
  product_id uuid,
  product_name jsonb,
  product_type text,
  product_duration_days int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    ol.id, ol.date, ol.end_date, ol.slot_start_time, ol.qty, ol.status, ol.holder_name,
    p.id, p.name, p.type, p.duration_days
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  where public.has_capability(auth.uid(), 'operator', p.establishment_id)
    and ol.date >= p_date_from
    and ol.date <= p_date_to
    and ol.status = any(array['reserved', 'fulfilled', 'no_show'])
    -- Migration 20261024120000 : une ligne `reserved` d'une commande qui attend encore son paiement tient
    -- seulement la place — ce n'est pas une réservation confirmée (`order_awaits_payment`).
    and not (ol.status = 'reserved' and public.order_awaits_payment(ol.order_id));
end;
$$;

create or replace function public.partner_reservations_list(
  p_date_from date default null,
  p_date_to date default null,
  p_product_id uuid default null,
  p_holder_q text default null,
  p_status text default null,
  p_sort_key text default 'date',
  p_sort_desc boolean default false,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  date date,
  qty int,
  status text,
  total_cop bigint,
  holder_name text,
  holder_phone text,
  holder_email text,
  product_name jsonb,
  establishment_name jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    ol.id, ol.date, ol.qty, ol.status, ol.total_cop,
    ol.holder_name,
    -- Migration 20261024120000 : pas de coordonnées du client pour une ligne jamais payée (`expired`,
    -- annulée…) qui reste visible dans l'historique.
    case when public.line_never_paid(ol.id) then null else ol.holder_phone end,
    case when public.line_never_paid(ol.id) then null else ol.holder_email end,
    p.name, e.name,
    count(*) over()
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  where public.has_capability(auth.uid(), 'operator', p.establishment_id)
    and (p_date_from is null or ol.date >= p_date_from)
    and (p_date_to is null or ol.date <= p_date_to)
    and (p_product_id is null or ol.product_id = p_product_id)
    and (p_status is null or ol.status = p_status)
    -- Migration 20261024120000 : jamais une ligne `reserved` d'une commande qui attend encore son paiement
    -- (`order_awaits_payment`). Dans le WHERE : count(*) over() et la pagination restent justes.
    and not (ol.status = 'reserved' and public.order_awaits_payment(ol.order_id))
    and (
      p_holder_q is null
      or ol.holder_name ilike '%' || p_holder_q || '%'
      or ol.holder_email ilike '%' || p_holder_q || '%'
    )
  order by
    case when p_sort_key = 'date' and not p_sort_desc then ol.date end asc nulls last,
    case when p_sort_key = 'date' and p_sort_desc then ol.date end desc nulls last,
    case when p_sort_key = 'created_at' and not p_sort_desc then ol.created_at end asc nulls last,
    case when p_sort_key = 'created_at' and p_sort_desc then ol.created_at end desc nulls last,
    case when p_sort_key = 'qty' and not p_sort_desc then ol.qty end asc nulls last,
    case when p_sort_key = 'qty' and p_sort_desc then ol.qty end desc nulls last,
    case when p_sort_key = 'status' and not p_sort_desc then ol.status end asc nulls last,
    case when p_sort_key = 'status' and p_sort_desc then ol.status end desc nulls last,
    case when p_sort_key = 'total_cop' and not p_sort_desc then ol.total_cop end asc nulls last,
    case when p_sort_key = 'total_cop' and p_sort_desc then ol.total_cop end desc nulls last
  limit p_limit offset p_offset;
end;
$$;

create or replace function public.partner_reservation_detail(p_order_line_id uuid)
returns table (
  id uuid,
  date date,
  end_date date,
  slot_start_time time,
  qty int,
  status text,
  holder_name text,
  holder_phone text,
  holder_email text,
  total_cop bigint,
  created_at timestamptz,
  product_name jsonb,
  product_type text,
  establishment_name jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    ol.id, ol.date, ol.end_date, ol.slot_start_time, ol.qty, ol.status,
    ol.holder_name,
    case when public.line_never_paid(ol.id) then null else ol.holder_phone end,
    case when public.line_never_paid(ol.id) then null else ol.holder_email end,
    ol.total_cop, ol.created_at,
    p.name, p.type, e.name
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  where ol.id = p_order_line_id
    and public.has_capability(auth.uid(), 'operator', p.establishment_id)
    -- Migration 20261024120000 : une ligne masquée de la liste l'est aussi ici — ouverte par un lien
    -- direct, elle répond comme une ligne introuvable (aucune ligne), jamais comme une réservation.
    and not (ol.status = 'reserved' and public.order_awaits_payment(ol.order_id));
end;
$$;

CREATE OR REPLACE FUNCTION public.notify_order_line_cancelled(p_line_id uuid, p_by text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_line record;
  v_dates text;
  v_site_url text;
  v_account record;
begin
  -- Appelée APRÈS la mise à jour du statut : la file d'annulation LobbyPMS est déjà à jour.
  select ol.date, ol.end_date, ol.qty, ol.pms_booking_id, p.name ->> 'es' as product_name, p.partner_id,
         p.establishment_id, p.type as product_type, p.lobby_category_id, o.holder_name, o.holder_email,
         o.reference, o.access_token
    into v_line
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
    join public.orders o on o.id = ol.order_id
   where ol.id = p_line_id;
  if not found then
    return;
  end if;
  -- Des dates civiles, jamais des instants : aucun fuseau n'entre en jeu.
  v_dates := case when v_line.end_date is not null
                  then 'del ' || to_char(v_line.date, 'DD/MM/YYYY') || ' al ' || to_char(v_line.end_date, 'DD/MM/YYYY')
                  else 'del ' || to_char(v_line.date, 'DD/MM/YYYY') end;

  -- Le client : le FAIT de l'annulation, sans un mot sur l'argent (décision du 2026-10-06). Jamais
  -- vers une adresse sentinelle (`@hifago.local` : ligne manuelle, reprise legacy).
  if v_line.holder_email is not null and v_line.holder_email not like '%@hifago.local' then
    begin
      select decrypted_secret into v_site_url
        from vault.decrypted_secrets where name = 'web_app_public_url';
      perform public.enqueue_notification_email(
        'client_order_line_cancelled', v_line.holder_email, null,
        'Anulación en tu reserva ' || v_line.reference,
        '<p>Hola ' || coalesce(public.html_text(v_line.holder_name), '') || ',</p>'
          || '<p>' || case p_by when 'client' then 'Anulaste' when 'admin' then 'Anulamos, a tu pedido,' else 'El establecimiento anuló' end
          || ' «' || coalesce(public.html_text(v_line.product_name), 'tu prestación') || '» ' || v_dates
          || ' en tu reserva <strong>' || public.html_text(v_line.reference) || '</strong>.</p>'
          || coalesce('<p><a href="' || v_site_url || '/reserva/' || v_line.access_token || '">Ver tu reserva</a></p>', ''),
        'order_lines', p_line_id
      );
    exception
      when query_canceled then
        raise warning 'notify_order_line_cancelled : e-mail client annulé (query_canceled) pour la ligne % — %', p_line_id, sqlerrm;
      when others then
        raise warning 'notify_order_line_cancelled : échec de l''e-mail client pour la ligne % — %', p_line_id, sqlerrm;
    end;
  end if;

  -- Le prestataire : un e-mail par compte de connexion du partenaire (spec 23 §8.2), chacun isolé.
  -- Ce que devient la disponibilité est dit sur les FAITS : la file LobbyPMS n'enfile un booking qu'à
  -- sa dernière prestation vivante ; une nuit adossée au PMS n'a jamais pris de place locale.
  -- Migration 20261024120000 : le prestataire n'est pas prévenu de l'annulation d'une ligne qu'il n'a
  -- jamais vue comme une réservation (commande jamais payée, cf. line_never_paid). Le client, lui, l'a
  -- été ci-dessus.
  if public.line_never_paid(p_line_id) then
    return;
  end if;

  for v_account in
    select pa.id as account_id, au.email
      from public.partner_accounts pa
      join auth.users au on au.id = pa.id
     where pa.partner_id = v_line.partner_id
  loop
    begin
      perform public.enqueue_notification_email(
        'partner_order_line_cancelled', v_account.email, v_account.account_id,
        'Reserva anulada: ' || coalesce(v_line.product_name, 'tu producto'),
        '<p>Se anuló «' || coalesce(public.html_text(v_line.product_name), 'tu producto') || '» ' || v_dates
          || ' (cantidad: ' || v_line.qty || '), reserva <strong>' || public.html_text(v_line.reference) || '</strong>.</p>'
          || '<p>Anulada por ' || case p_by when 'client' then 'el cliente'
                                       when 'admin' then 'la administración de Hifago, a pedido del cliente'
                                       else 'el establecimiento' end || '.</p>'
          || case
               when v_line.pms_booking_id is not null and exists (
                      select 1 from public.pms_cancellation_queue q
                       where q.pms_booking_id = v_line.pms_booking_id
                         and q.establishment_id = v_line.establishment_id and q.status = 'pending')
                 then '<p>La anulación se transmite a LobbyPMS.</p>'
               when v_line.pms_booking_id is not null
                 then '<p>La reserva sigue activa en LobbyPMS: otras prestaciones de la misma reserva siguen vigentes.</p>'
               when v_line.product_type = 'lodging' and v_line.lobby_category_id is not null
                 then ''
               else '<p>La disponibilidad quedó liberada.</p>'
             end,
        'order_lines', p_line_id
      );
    exception
      when query_canceled then
        raise warning 'notify_order_line_cancelled : e-mail prestataire annulé (query_canceled) pour le compte % — %', v_account.account_id, sqlerrm;
      when others then
        raise warning 'notify_order_line_cancelled : échec de l''e-mail prestataire pour le compte % — %', v_account.account_id, sqlerrm;
    end;
  end loop;
end;
$function$;
