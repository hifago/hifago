-- search_path fixé sur les fonctions de `public` qui ne le fixaient pas.
--
-- Toute fonction SECURITY DEFINER le fixe déjà (rls_rpc_only_checklist.test.sql). Restaient huit
-- fonctions SECURITY INVOKER : six RPC d'administration des établissements et produits
-- (set_establishment_status, set_product_sellable, transfer_establishment, update_establishment,
-- update_establishment_contact, update_establishment_stay_details) et deux fonctions trigger
-- (enforce_operator_implies_referrer, auth_users_default_empty_tokens). Une fonction INVOKER
-- s'exécute avec les droits de l'appelant, et ni anon ni authenticated ne peuvent créer d'objet
-- dans un schéma du chemin : le risque est théorique. C'est de l'hygiène, et désormais une règle
-- vérifiée pour TOUTES les fonctions de `public` (assertion (4) de rls_rpc_only_checklist).
--
-- Elles restent INVOKER, grants inchangés : leur garde est la RLS directe (policies
-- *_write_admin), modèle de CLAUDE.md §3.2. Trois corps nommaient leurs tables et log_admin_action
-- sans schéma (set_establishment_status, set_product_sellable, transfer_establishment) : avec un
-- search_path vide, plpgsql ne les trouverait plus à l'exécution — ils sont qualifiés `public.`.
-- Les cinq autres l'étaient déjà. Corps extraits par pg_get_functiondef, signatures inchangées.

CREATE OR REPLACE FUNCTION public.set_establishment_status(p_establishment_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_before text;
begin
  if p_status not in ('active', 'archived') then
    raise exception 'statut invalide : %', p_status;
  end if;

  select status into v_before from public.establishments where id = p_establishment_id;

  update public.establishments set status = p_status, updated_at = now()
   where id = p_establishment_id;

  if not found then
    -- Même discipline que set_product_sellable : un établissement refusé par la RLS (non-admin) et
    -- un établissement inexistant produisent le même message.
    raise exception 'establecimiento introuvable ou non autorisé';
  end if;

  perform public.log_admin_action(
    case when p_status = 'active' then 'establishment.publish' else 'establishment.unpublish' end,
    'establishments', p_establishment_id,
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', p_status),
    p_note
  );
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_product_sellable(p_product_id uuid, p_sellable boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_before boolean;
begin
  select sellable into v_before from public.products where id = p_product_id;

  update public.products set sellable = p_sellable, updated_at = now()
   where id = p_product_id;

  if not found then
    -- Un produit refusé par la RLS (non-admin) et un produit qui n'existe pas produisent le même
    -- message, jamais un révélateur explicite de ce qui a échoué.
    raise exception 'produit introuvable ou non autorisé';
  end if;

  perform public.log_admin_action(
    case when p_sellable then 'product.publish' else 'product.unpublish' end,
    'products', p_product_id,
    jsonb_build_object('sellable', v_before),
    jsonb_build_object('sellable', p_sellable),
    p_note
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_establishment(p_establishment_id uuid, p_new_partner_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_before_partner_id uuid;
begin
  select partner_id into v_before_partner_id from public.establishments where id = p_establishment_id;

  update public.establishments set partner_id = p_new_partner_id, updated_at = now()
   where id = p_establishment_id;

  if not found then
    raise exception 'établissement introuvable ou non autorisé';
  end if;

  perform public.log_admin_action(
    'establishment.transfer', 'establishments', p_establishment_id,
    jsonb_build_object('partner_id', v_before_partner_id),
    jsonb_build_object('partner_id', p_new_partner_id), p_note
  );
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_establishment(p_establishment_id uuid, p_name jsonb, p_description jsonb DEFAULT NULL::jsonb, p_address text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lon double precision DEFAULT NULL::double precision, p_operated_directly boolean DEFAULT false, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_before_name jsonb;
  v_before_description jsonb;
  v_before_address text;
  v_before_lat double precision;
  v_before_lon double precision;
  v_before_operated_directly boolean;
begin
  select name, description, address, lat, lon, operated_directly
    into v_before_name, v_before_description, v_before_address,
         v_before_lat, v_before_lon, v_before_operated_directly
    from public.establishments where id = p_establishment_id;

  update public.establishments
     set name = p_name,
         description = p_description,
         address = p_address,
         lat = p_lat,
         lon = p_lon,
         operated_directly = p_operated_directly,
         updated_at = now()
   where id = p_establishment_id;

  if not found then
    raise exception 'établissement introuvable ou non autorisé';
  end if;

  perform public.log_admin_action(
    'establishment.update', 'establishments', p_establishment_id,
    jsonb_build_object(
      'name', v_before_name, 'description', v_before_description, 'address', v_before_address,
      'lat', v_before_lat, 'lon', v_before_lon, 'operated_directly', v_before_operated_directly
    ),
    jsonb_build_object(
      'name', p_name, 'description', p_description, 'address', p_address,
      'lat', p_lat, 'lon', p_lon, 'operated_directly', p_operated_directly
    ),
    p_note
  );
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_establishment_contact(p_establishment_id uuid, p_contact_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_normalise text;
begin
  -- Une chaîne vide venue d'un champ de formulaire vidé vaut « pas de contact », jamais un numéro
  -- invalide : sans ça, effacer le champ dans l'admin rendrait `invalid_phone` au lieu de retirer
  -- le bouton.
  v_normalise := nullif(btrim(coalesce(p_contact_phone, '')), '');

  if v_normalise is not null and v_normalise !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  update public.establishments
     set contact_phone = v_normalise,
         updated_at = now()
   where id = p_establishment_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
  end if;

  -- ⚠️ Le numéro N'EST PAS écrit au journal d'audit : c'est une donnée de contact, et l'audit doit
  -- dire QUI a changé QUOI, pas recopier la valeur. On journalise sa PRÉSENCE.
  perform public.log_admin_action(
    'establishment.update_contact', 'establishments', p_establishment_id, null,
    jsonb_build_object('contact_phone_defini', v_normalise is not null),
    null
  );

  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_establishment_stay_details(p_establishment_id uuid, p_check_in_time time without time zone DEFAULT NULL::time without time zone, p_check_out_time time without time zone DEFAULT NULL::time without time zone, p_mode text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_mode is not null and p_mode not in ('rooms', 'whole_house') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_mode');
  end if;

  update public.establishments
     set check_in_time = p_check_in_time,
         check_out_time = p_check_out_time,
         mode = p_mode,
         updated_at = now()
   where id = p_establishment_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
  end if;

  perform public.log_admin_action(
    'establishment.update_stay_details', 'establishments', p_establishment_id, null,
    jsonb_build_object('check_in_time', p_check_in_time, 'check_out_time', p_check_out_time, 'mode', p_mode),
    null
  );

  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_operator_implies_referrer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.role = 'operator' and not exists (
    select 1 from public.partner_capabilities
    where partner_id = new.partner_id
      and role = 'referrer'
  ) then
    raise exception
      'partner_capabilities: la capacité operator requiert une capacité referrer existante pour le partner_id %',
      new.partner_id;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.auth_users_default_empty_tokens()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.confirmation_token := coalesce(new.confirmation_token, '');
  new.recovery_token := coalesce(new.recovery_token, '');
  new.email_change_token_new := coalesce(new.email_change_token_new, '');
  new.email_change := coalesce(new.email_change, '');
  return new;
end;
$function$;
