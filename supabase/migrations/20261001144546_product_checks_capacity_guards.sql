-- Produits : trois contraintes de forme et deux gardes de capacité.
--
-- 1. get_evento_rsvp_counts (20260915120000) sommait les lignes de commande de N'IMPORTE QUEL
--    produit, alors que son seul appelant (apps/web/lib/catalog/producto.ts) ne l'appelle que pour
--    un evento en mode rsvp. La fonction porte désormais ce contrat elle-même : elle ne compte que
--    pour un evento rsvp et ne rend rien pour tout autre produit. Même signature, grants inchangés
--    (`create or replace` conserve l'ACL) ; elle reste publique par conception
--    (security_definer_exposure.test.sql).
--
-- 2. products.external_booking_url est rendue en lien dans la vitrine (BotonContacto.tsx) mais
--    n'était contrôlée nulle part : le formulaire admin est `noValidate`, et les RPC de proposition
--    l'écrivent telle quelle. Seuls les schémas http et https sont admis (même forme de CHECK par
--    expression régulière que products_transport_contact_phone_e164). Le formulaire refuse aussi la
--    valeur avant l'envoi (productFormRequiredFields.ts), pour ne pas laisser ce refus arriver en
--    23514 générique.
--
-- 3. products.min_qty / max_qty >= 1 (NULL admis : pas de borne). Seul min_qty <= max_qty existait ;
--    une valeur 0 était saisissable (formulaire `noValidate`) et un max_qty à 0 rend le produit
--    invendable (create_order le refuse en qty_cap_exceeded).
--
-- ⚠️ Les trois CHECK valident les lignes EXISTANTES : la migration échoue (et ne pose rien) si une
-- ligne les viole. Compter les écarts sur chaque environnement avant de la pousser.
--
-- 4. set_product_availability et set_provider_resource_capacity refusent une capacité négative en
--    motif `invalid_capacity`, comme set_product_slot_capacity (20260818100000), au même endroit :
--    après les gardes d'identité, avant toute lecture verrouillée. Corps extraits par
--    pg_get_functiondef, une insertion chacun, signatures inchangées.

-- ── 1. get_evento_rsvp_counts ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_evento_rsvp_counts(p_product_id uuid, p_from date, p_to date)
 RETURNS TABLE(occurrence_date date, registered_qty integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select ol.date, sum(ol.qty)::int
    from public.order_lines ol
    join public.products p
      on p.id = ol.product_id
     and p.type = 'evento'
     and p.evento_capacity_mode = 'rsvp'
   where ol.product_id = p_product_id
     and ol.date between p_from and p_to
     and ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded')
   group by ol.date;
$function$;

-- ── 2-3. Contraintes ────────────────────────────────────────────────────────────────────────────
alter table public.products
  add constraint products_external_booking_url_scheme
  check (external_booking_url is null or external_booking_url ~* '^https?://');

alter table public.products
  add constraint products_min_qty_positive check (min_qty is null or min_qty >= 1);

alter table public.products
  add constraint products_max_qty_positive check (max_qty is null or max_qty >= 1);

-- ── 4. Gardes de capacité ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_product_availability(p_product_id uuid, p_date date, p_capacity integer, p_open boolean DEFAULT true, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_is_admin boolean;
  v_partner_id uuid;
  v_establishment_id uuid;
  v_before_capacity int;
  v_before_booked int;
  v_before_open boolean;
  v_lodging_kind text;
  v_unit_count int;
  v_unit_capacity int;
  v_max_capacity int;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_is_admin := (select public.is_admin(v_account_id));

  -- Garde-fous 1+2+3 (identité/propriété/capacité), mêmes que submit_product_proposal (feature
  -- 15), même ordre — UNIQUEMENT pour un appelant non-admin. Le chemin admin reste strictement
  -- inchangé : verrouillage et logique de capacité identiques à avant.
  -- Une seule lecture de `products` pour les deux besoins (propriété ET capacité physique) :
  -- le chemin non-admin la faisait déjà, le garde-fou physique la refaisait 25 lignes plus bas.
  select establishment_id, lodging_kind, unit_count, capacity
    into v_establishment_id, v_lodging_kind, v_unit_count, v_unit_capacity
    from public.products where id = p_product_id;

  if not v_is_admin then
    v_partner_id := (select public.partner_id_for_account(v_account_id));

    if v_establishment_id is null or not exists (
      select 1 from public.establishments
       where id = v_establishment_id and partner_id = v_partner_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'product_not_found');
    end if;

    if not (select public.has_capability(v_account_id, 'operator', v_establishment_id)) then
      return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
    end if;
  end if;

  -- Capacité négative refusée en motif métier, comme set_product_slot_capacity : sans cette
  -- garde, une ligne neuve heurtait la contrainte booked <= capacity (23514, message générique)
  -- et une ligne existante répondait below_booked « 0 plazas ».
  if p_capacity < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capacity');
  end if;

  -- Garde-fou physique, PORTÉ depuis set_room_type_availability (20260817210000), que T3 étape 2
  -- a supprimée avec les chambres. Il empêche d'ouvrir plus de places qu'il n'en existe
  -- réellement — un dortoir de 6 lits en 2 exemplaires ne peut pas vendre 30 nuitées.
  --
  -- La formule suit ce qu'on VEND, et c'est celle d'origine transposée de kind/quantity vers
  -- lodging_kind/unit_count : un dortoir se vend au LIT (unit_count × capacity), une chambre
  -- privée ou une maison entière se vend à l'UNITÉ (unit_count). `whole_house`, qui n'existait pas
  -- du temps des chambres, suit private — on ne loue pas une maison à la personne.
  --
  -- Ne s'applique qu'aux logements dont unit_count est renseigné : une activité n'a pas de capacité
  -- physique en ce sens, et un logement sans unit_count n'a rien à quoi se comparer. Le chemin des
  -- autres types reste donc strictement inchangé.
  if v_unit_count is not null then
    v_max_capacity := case
      when v_lodging_kind is null then v_unit_count * coalesce(v_unit_capacity, 1)
      when v_lodging_kind = 'dorm' then v_unit_count * coalesce(v_unit_capacity, 1)
      else v_unit_count
    end;
    if p_capacity > v_max_capacity then
      return jsonb_build_object('ok', false, 'reason', 'capacity_exceeds_physical', 'max', v_max_capacity);
    end if;
  end if;

  select capacity, booked into v_before_capacity, v_before_booked
    from public.product_availability
   where product_id = p_product_id and date = p_date
   for update;

  if found and p_capacity < v_before_booked then
    return jsonb_build_object('ok', false, 'reason', 'below_booked', 'booked', v_before_booked);
  end if;

  if found then
    update public.product_availability set capacity = p_capacity
     where product_id = p_product_id and date = p_date;
  else
    insert into public.product_availability (product_id, date, capacity, booked)
    values (p_product_id, p_date, p_capacity, 0);
  end if;

  select open into v_before_open from public.product_calendar
   where product_id = p_product_id and date = p_date;

  insert into public.product_calendar (product_id, date, open)
  values (p_product_id, p_date, p_open)
  on conflict (product_id, date) do update set open = excluded.open;

  -- Journalisation réservée aux écritures admin : un socio qui gère sa propre disponibilité n'a
  -- pas besoin d'être audité comme un admin (cahier des charges socio §3d, "lui appartient par
  -- nature") — et log_admin_action refuserait l'appel de toute façon pour un non-admin.
  if v_is_admin then
    perform public.log_admin_action(
      'product.set_availability', 'product_availability', p_product_id,
      jsonb_build_object('date', p_date, 'capacity', v_before_capacity, 'booked', v_before_booked, 'open', v_before_open),
      jsonb_build_object('date', p_date, 'capacity', p_capacity, 'open', p_open),
      p_note
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_provider_resource_capacity(p_establishment_id uuid, p_date date, p_capacity integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_before_capacity int;
  v_before_booked int;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'set_provider_resource_capacity réservé au rôle admin' using errcode = '42501';
  end if;

  -- Capacité négative refusée en motif métier, comme set_product_slot_capacity : sans cette
  -- garde, une ligne neuve heurtait la contrainte booked <= capacity (23514, message générique)
  -- et une ligne existante répondait below_booked « 0 plazas ».
  if p_capacity < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capacity');
  end if;

  select capacity, booked into v_before_capacity, v_before_booked
    from public.provider_resource_calendar
   where establishment_id = p_establishment_id and slot_date = p_date
   for update;

  if found and p_capacity < v_before_booked then
    return jsonb_build_object('ok', false, 'reason', 'below_booked', 'booked', v_before_booked);
  end if;

  if found then
    update public.provider_resource_calendar set capacity = p_capacity
     where establishment_id = p_establishment_id and slot_date = p_date;
  else
    insert into public.provider_resource_calendar (establishment_id, slot_date, capacity, booked)
    values (p_establishment_id, p_date, p_capacity, 0);
  end if;

  perform public.log_admin_action(
    'establishment.set_resource_capacity', 'provider_resource_calendar', p_establishment_id,
    jsonb_build_object('date', p_date, 'capacity', v_before_capacity, 'booked', v_before_booked),
    jsonb_build_object('date', p_date, 'capacity', p_capacity), p_note
  );
  return jsonb_build_object('ok', true);
end;
$function$;
