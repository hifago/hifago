-- Transfert d'établissement : rattachement, capacités et produits en une seule transaction.
--
-- 1. transfer_establishment. Jusqu'ici la fonction ne changeait que establishments.partner_id :
--    la capacité operator restait chez l'ancien propriétaire, le nouveau n'en recevait aucune, et
--    products.partner_id (liste du socio, cas d'autoréférence de create_order, destinataire des
--    notifications) ne suivait pas. Elle fait désormais, dans cet ordre et sous un `for update` sur
--    l'établissement :
--    - établissement : partner_id passe au nouveau propriétaire ;
--    - capacités : la ligne operator de l'ancien propriétaire sur CET établissement est retirée (ses
--      lignes sur ses autres établissements restent), la ligne entière est gardée dans
--      audit_log.before ; le nouveau propriétaire reçoit la sienne sans doublon — ligne déjà scopée
--      gardée (réactivée si suspendue), sinon ligne en attente rattachée (même geste que
--      create_establishment), sinon ligne créée après la garantie referrer (même geste que
--      grant_capability) ;
--    - produits : products.partner_id de l'établissement suit le nouveau propriétaire.
--    Ancien = nouveau propriétaire : resynchronisation — rien n'est retiré, la capacité du
--    propriétaire et les produits sont remis en cohérence.
--    Les propositions en attente de l'ancien propriétaire sur l'établissement sont CONSERVÉES (ni
--    rejetées ni transférées), comptées dans la réponse et dans audit_log.after : l'écran de
--    confirmation les annonce avant le geste.
--    La fonction passe en SECURITY DEFINER avec une garde is_admin explicite (42501), comme
--    grant_capability : elle écrit dans partner_capabilities, où aucune session n'a d'écriture
--    directe. EXECUTE révoqué pour PUBLIC et anon, accordé à authenticated seulement.
--    Pas une opération critique au sens de CLAUDE.md §4.1 (aucun compteur de capacité) : pas de
--    squelette anti-survente, le verrou sur l'établissement sérialise deux transferts concurrents.
--
-- 2. create_product_from_proposal. Le produit approuvé appartient au propriétaire de
--    l'établissement au moment de l'approbation, plus à l'auteur de la proposition : une proposition
--    de création déposée avant un transfert crée le produit chez le propriétaire actuel. Lecture
--    sous `for share`, qui attend un transfert en cours sur le même établissement. Signature
--    inchangée (moderate_product_proposal passe toujours partner_id) ; corps repris de
--    pg_get_functiondef sur la version vivante (20260917100000), seules les lignes du propriétaire
--    changent. EXECUTE révoqué pour PUBLIC, anon et authenticated : son seul appelant,
--    moderate_product_proposal, est SECURITY DEFINER (exécutée en propriétaire), et
--    product_creation_proposal.test.sql la décrit déjà comme non appelable directement — ce que
--    seule la garde is_admin assurait jusqu'ici.

create or replace function public.transfer_establishment(
  p_establishment_id uuid,
  p_new_partner_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_partner_id uuid;
  v_resync boolean;
  v_previous_capability jsonb;
  v_capability_id uuid;
  v_capability_status text;
  v_capability_origin text;
  v_products_moved integer;
  v_pending_product_proposals integer := 0;
  v_pending_establishment_proposals integer := 0;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'transfer_establishment réservé au rôle admin' using errcode = '42501';
  end if;

  select partner_id into v_before_partner_id
    from public.establishments
   where id = p_establishment_id
   for update;
  if not found then
    raise exception 'établissement introuvable';
  end if;
  v_resync := v_before_partner_id = p_new_partner_id;

  -- 1. Établissement.
  if not v_resync then
    update public.establishments
       set partner_id = p_new_partner_id, updated_at = now()
     where id = p_establishment_id;
  end if;

  -- 2. Capacités. Au plus une ligne : index partner_capabilities_operator_establishment_idx.
  if not v_resync then
    delete from public.partner_capabilities pc
     where pc.partner_id = v_before_partner_id
       and pc.role = 'operator'
       and pc.establishment_id = p_establishment_id
    returning to_jsonb(pc) into v_previous_capability;
  end if;

  if not exists (
    select 1 from public.partner_capabilities
     where partner_id = p_new_partner_id and role = 'referrer'
  ) then
    insert into public.partner_capabilities (partner_id, role, source, status)
    values (p_new_partner_id, 'referrer', 'admin', 'active');
  end if;

  select id, status into v_capability_id, v_capability_status
    from public.partner_capabilities
   where partner_id = p_new_partner_id
     and role = 'operator'
     and establishment_id = p_establishment_id
   for update;
  if found then
    if v_capability_status = 'active' then
      v_capability_origin := 'kept';
    else
      update public.partner_capabilities
         set status = 'active', updated_at = now()
       where id = v_capability_id;
      v_capability_origin := 'reactivated';
    end if;
  else
    -- Au plus une ligne en attente : index partner_capabilities_operator_pending_idx.
    update public.partner_capabilities
       set establishment_id = p_establishment_id, status = 'active', updated_at = now()
     where partner_id = p_new_partner_id
       and role = 'operator'
       and establishment_id is null
    returning id into v_capability_id;
    if found then
      v_capability_origin := 'rescoped';
    else
      insert into public.partner_capabilities (partner_id, establishment_id, role, source, status)
      values (p_new_partner_id, p_establishment_id, 'operator', 'admin', 'active')
      returning id into v_capability_id;
      v_capability_origin := 'created';
    end if;
  end if;

  -- 3. Produits.
  update public.products
     set partner_id = p_new_partner_id, updated_at = now()
   where establishment_id = p_establishment_id
     and partner_id is distinct from p_new_partner_id;
  get diagnostics v_products_moved = row_count;

  -- Propositions en attente de l'ancien propriétaire : comptées, jamais modifiées. Une proposition
  -- de contenu ou de photos n'a que product_id, une proposition de création que establishment_id.
  if not v_resync then
    select count(*) into v_pending_product_proposals
      from public.product_proposals pp
      left join public.products p on p.id = pp.product_id
     where pp.status = 'pending'
       and pp.partner_id = v_before_partner_id
       and coalesce(pp.establishment_id, p.establishment_id) = p_establishment_id;

    select count(*) into v_pending_establishment_proposals
      from public.establishment_proposals ep
     where ep.status = 'pending'
       and ep.partner_id = v_before_partner_id
       and ep.establishment_id = p_establishment_id;
  end if;

  perform public.log_admin_action(
    'establishment.transfer', 'establishments', p_establishment_id,
    jsonb_build_object('partner_id', v_before_partner_id, 'operator_capability', v_previous_capability),
    jsonb_build_object(
      'partner_id', p_new_partner_id,
      'resync', v_resync,
      'operator_capability_id', v_capability_id,
      'operator_capability_origin', v_capability_origin,
      'products_moved', v_products_moved,
      'pending_product_proposals', v_pending_product_proposals,
      'pending_establishment_proposals', v_pending_establishment_proposals
    ),
    p_note
  );

  return jsonb_build_object(
    'ok', true,
    'resync', v_resync,
    'operator_capability_origin', v_capability_origin,
    'products_moved', v_products_moved,
    'pending_product_proposals', v_pending_product_proposals,
    'pending_establishment_proposals', v_pending_establishment_proposals
  );
end;
$$;

revoke all on function public.transfer_establishment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.transfer_establishment(uuid, uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.create_product_from_proposal(p_partner_id uuid, p_establishment_id uuid, p_type text, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product_id uuid;
  v_slug_base text;
  v_slug text;
  v_suffix int := 1;
  v_tag_id text;
  v_slot jsonb;
  v_photo jsonb;
  v_sort int;
  v_default_capacity int;
  v_owner_partner_id uuid;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_product_from_proposal réservé au rôle admin' using errcode = '42501';
  end if;

  -- Propriétaire = celui de l'établissement maintenant, pas l'auteur de la proposition (p_partner_id
  -- reste dans la signature pour moderate_product_proposal, mais ne décide plus du propriétaire).
  select partner_id into v_owner_partner_id
    from public.establishments
   where id = p_establishment_id
   for share;
  if not found then
    raise exception 'établissement introuvable';
  end if;

  v_slug_base := public.slugify(coalesce(p_payload -> 'name' ->> 'es', 'producto'));
  if v_slug_base = '' then
    v_slug_base := 'producto';
  end if;
  v_slug := v_slug_base;
  while exists (select 1 from public.products where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix;
  end loop;

  v_default_capacity := nullif(p_payload ->> 'default_capacity', '')::int;
  if p_type = 'lodging' and v_default_capacity is null then
    v_default_capacity := public.resolve_lodging_default_capacity(
      nullif(p_payload ->> 'lodging_kind', ''),
      nullif(p_payload ->> 'unit_count', '')::int,
      nullif(p_payload ->> 'capacity', '')::int
    );
  end if;

  insert into public.products (
    partner_id, establishment_id, type, name, description, slug, sellable,
    price_cop, price_tiers, min_qty, max_qty,
    address, lat, lon,
    check_in_time, check_out_time, capacity, unit_count, lodging_kind, unit, default_capacity, stay_rates,
    duration_days,
    -- Ajout de cette migration (20260914140000) : parité avec la whitelist de
    -- submit_product_creation_proposal — sans ces 2 colonnes ici, la remise configurée par un
    -- prestataire survivrait dans la proposition mais disparaîtrait à l'approbation.
    group_discount_threshold_qty, group_discount_pct,
    -- Ajout de cette migration (20260916140000) : parité avec la whitelist de
    -- submit_product_creation_proposal — sans cette colonne ici, le programme saisi par un
    -- prestataire survivrait dans la proposition et disparaîtrait à l'approbation.
    program,
    price_label, occurrence_type, occurrence_date, recurrence_frequency_days,
    recurrence_end_date, recurrence_end_count, start_time, duration_minutes, external_booking_url,
    lobby_category_id, lobby_product_id,
    -- 2026-09-16 (transport informatif) : parité avec la whitelist de
    -- submit_product_creation_proposal — sans ces 9 colonnes ici, les horaires et les deux lieux
    -- d'un transport survivraient dans la proposition mais disparaîtraient à l'approbation (le
    -- défaut déjà vécu pour unit_count, lodging_kind puis external_booking_url).
    transport_first_departure_time, transport_last_departure_time, transport_seats_per_departure,
    transport_departure_address, transport_departure_lat, transport_departure_lon,
    transport_arrival_address, transport_arrival_lat, transport_arrival_lon,
    transport_contact_phone
  )
  values (
    v_owner_partner_id, p_establishment_id, p_type,
    p_payload -> 'name', p_payload -> 'description', v_slug,
    true,
    nullif(p_payload ->> 'price_cop', '')::bigint,
    p_payload -> 'price_tiers',
    nullif(p_payload ->> 'min_qty', '')::int,
    nullif(p_payload ->> 'max_qty', '')::int,
    p_payload ->> 'address',
    nullif(p_payload ->> 'lat', '')::double precision,
    nullif(p_payload ->> 'lon', '')::double precision,
    nullif(p_payload ->> 'check_in_time', '')::time,
    nullif(p_payload ->> 'check_out_time', '')::time,
    nullif(p_payload ->> 'capacity', '')::int,
    nullif(p_payload ->> 'unit_count', '')::int,
    nullif(p_payload ->> 'lodging_kind', ''),
    nullif(p_payload ->> 'unit', ''),
    v_default_capacity,
    p_payload -> 'stay_rates',
    nullif(p_payload ->> 'duration_days', '')::int,
    nullif(p_payload ->> 'group_discount_threshold_qty', '')::int,
    nullif(p_payload ->> 'group_discount_pct', '')::numeric,
    -- ⚠️ NORMALISÉ, jamais `p_payload -> 'program'` brut comme price_tiers/stay_rates au-dessus :
    -- un payload {"program": null} donne ici le littéral JSON `null` ('null'::jsonb) et NON un
    -- NULL SQL, et jsonb_typeof('null'::jsonb) = 'null' ferait échouer le CHECK
    -- products_program_is_array (20260916130000) sur TOUTE création de camp sans programme.
    -- Précédent exact : 20260818240000_fix_price_tiers_json_null.sql (11 produits pollués).
    case when jsonb_typeof(p_payload -> 'program') = 'array' then p_payload -> 'program' else null end,
    p_payload ->> 'price_label',
    p_payload ->> 'occurrence_type',
    nullif(p_payload ->> 'occurrence_date', '')::date,
    nullif(p_payload ->> 'recurrence_frequency_days', '')::int,
    nullif(p_payload ->> 'recurrence_end_date', '')::date,
    nullif(p_payload ->> 'recurrence_end_count', '')::int,
    nullif(p_payload ->> 'start_time', '')::time,
    nullif(p_payload ->> 'duration_minutes', '')::int,
    nullif(p_payload ->> 'external_booking_url', ''),
    nullif(p_payload ->> 'lobby_category_id', '')::int,
    nullif(p_payload ->> 'lobby_product_id', '')::int,
    -- Même ordre que la liste de colonnes ci-dessus. Les CHECK products_transport_* font échouer
    -- BRUYAMMENT un payload d'un autre type qui porterait ces clés — échec fermé voulu, pas un
    -- défaut : cette RPC insère pour tous les types depuis un seul `insert`.
    nullif(p_payload ->> 'transport_first_departure_time', '')::time,
    nullif(p_payload ->> 'transport_last_departure_time', '')::time,
    nullif(p_payload ->> 'transport_seats_per_departure', '')::int,
    nullif(p_payload ->> 'transport_departure_address', ''),
    nullif(p_payload ->> 'transport_departure_lat', '')::double precision,
    nullif(p_payload ->> 'transport_departure_lon', '')::double precision,
    nullif(p_payload ->> 'transport_arrival_address', ''),
    nullif(p_payload ->> 'transport_arrival_lat', '')::double precision,
    nullif(p_payload ->> 'transport_arrival_lon', '')::double precision,
    nullif(p_payload ->> 'transport_contact_phone', '')
  )
  returning id into v_product_id;

  if jsonb_typeof(p_payload -> 'tag_ids') = 'array' then
    for v_tag_id in select * from jsonb_array_elements_text(p_payload -> 'tag_ids') loop
      insert into public.product_tag_assignments (product_id, tag_id) values (v_product_id, v_tag_id::uuid);
    end loop;
  end if;

  if jsonb_typeof(p_payload -> 'photos') = 'array' then
    v_sort := 0;
    for v_photo in select * from jsonb_array_elements(p_payload -> 'photos') loop
      insert into public.product_media (product_id, storage_path, sort)
      values (v_product_id, v_photo ->> 'storage_path', v_sort);
      v_sort := v_sort + 1;
    end loop;
  end if;

  if p_type = 'activity' and jsonb_typeof(p_payload -> 'slot_rules') = 'array' then
    for v_slot in select * from jsonb_array_elements(p_payload -> 'slot_rules') loop
      insert into public.product_slot_rules
        (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
      values (
        v_product_id,
        (select array_agg((w)::int order by (w)::int) from jsonb_array_elements_text(v_slot -> 'weekdays') w),
        (v_slot ->> 'start_time')::time,
        (v_slot ->> 'end_time')::time,
        (v_slot ->> 'slot_duration_minutes')::int,
        (v_slot ->> 'capacity')::int
      );
    end loop;
  end if;

  if p_type = 'lodging' and v_default_capacity is not null then
    perform public.open_default_lodging_availability(v_product_id);
  end if;

  perform public.log_admin_action(
    'product_proposal.approve_create', 'products', v_product_id, null,
    jsonb_build_object('partner_id', v_owner_partner_id, 'establishment_id', p_establishment_id, 'type', p_type),
    null
  );

  return v_product_id;
end;
$function$;

revoke all on function public.create_product_from_proposal(uuid, uuid, text, jsonb) from public, anon, authenticated;
