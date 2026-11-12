-- La note du client (`orders.client_note`, migration 20261112120000) visible ailleurs que dans l'e-mail
-- au prestataire (demande de Jérôme, 2026-11-12) :
--
--   1. partner_reservation_detail rend `client_note` — la fiche réservation du prestataire l'affiche en
--      entier ;
--   2. partner_reservations_list rend `has_client_note` — un repère dans la liste, pour savoir sans
--      ouvrir chaque fiche qu'un client a laissé un mot. Un booléen, pas le texte : la liste n'en a
--      pas besoin.
--
-- La note suit la règle des coordonnées (migration 20261024120000) : rien pour une ligne jamais payée
-- (`line_never_paid`). Le client l'écrit librement et y met souvent son numéro ou ses horaires ; une
-- ligne morte d'une commande jamais confirmée n'a jamais été une réservation pour le prestataire.
--
-- La commande admin (/admin/orders/[id]) lit `orders` directement (policy orders_select, l'admin lit
-- tout) : aucune RPC à modifier pour elle.
--
-- Les deux RPC changent de type de retour : `drop function` explicite (règle supabase §7). Corps repris
-- de pg_get_functiondef, une seule colonne ajoutée à chacun. Grants à l'identique des précédents.

-- 1. partner_reservation_detail ----------------------------------------------------------------------

drop function public.partner_reservation_detail(uuid);

CREATE FUNCTION public.partner_reservation_detail(p_order_line_id uuid)
 RETURNS TABLE(id uuid, date date, end_date date, slot_start_time time without time zone, qty integer, status text, holder_name text, holder_phone text, holder_email text, total_cop bigint, created_at timestamp with time zone, product_name jsonb, product_type text, establishment_name jsonb, pricing_unit text, client_note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return query
  select
    ol.id, ol.date, ol.end_date, ol.slot_start_time, ol.qty, ol.status,
    ol.holder_name,
    case when public.line_never_paid(ol.id) then null else ol.holder_phone end,
    case when public.line_never_paid(ol.id) then null else ol.holder_email end,
    ol.total_cop, ol.created_at,
    p.name, p.type, e.name,
    -- Migration 20261025140000 (spec 43) : « 3 h » plutôt que « 3 pers. ».
    ol.pricing_unit,
    -- Migration 20261112170000 : la note du client, masquée comme ses coordonnées.
    case when public.line_never_paid(ol.id) then null else o.client_note end
  from public.order_lines ol
  join public.orders o on o.id = ol.order_id
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  where ol.id = p_order_line_id
    and public.has_capability(auth.uid(), 'operator', p.establishment_id)
    -- Migration 20261024120000 : une ligne masquée de la liste l'est aussi ici — ouverte par un lien
    -- direct, elle répond comme une ligne introuvable (aucune ligne), jamais comme une réservation.
    and not (ol.status = 'reserved' and public.order_awaits_payment(ol.order_id));
end;
$function$;

revoke all on function public.partner_reservation_detail(uuid) from public, anon;
grant execute on function public.partner_reservation_detail(uuid) to authenticated, service_role;

-- 2. partner_reservations_list -----------------------------------------------------------------------

drop function public.partner_reservations_list(date, date, uuid, text, text, text, boolean, int, int);

CREATE FUNCTION public.partner_reservations_list(p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_product_id uuid DEFAULT NULL::uuid, p_holder_q text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_sort_key text DEFAULT 'date'::text, p_sort_desc boolean DEFAULT false, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, date date, qty integer, status text, total_cop bigint, holder_name text, holder_phone text, holder_email text, product_name jsonb, establishment_name jsonb, total_count bigint, has_client_note boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    count(*) over(),
    -- Migration 20261112170000 : un repère, pas le texte ; masqué comme les coordonnées.
    (o.client_note is not null and not public.line_never_paid(ol.id))
  from public.order_lines ol
  join public.orders o on o.id = ol.order_id
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
$function$;

revoke all on function public.partner_reservations_list(date, date, uuid, text, text, text, boolean, int, int)
  from public, anon;
grant execute on function public.partner_reservations_list(date, date, uuid, text, text, text, boolean, int, int)
  to authenticated, service_role;
