-- Édition en ligne des listes admin (demande Jérôme du 2026-10-13) : les cellules des tableaux
-- de /admin deviennent éditables, un bouton « Guardar cambios » valide la page en une fois.
--
-- Trois RPC, une par entité dont la liste gagne une cellule que rien n'écrivait jusqu'ici :
--   * admin_update_product_inline — Catálogo : nom, établissement, type, prix, état, étiquettes ;
--   * admin_rename_establishment  — Establecimientos : nom (le statut garde set_establishment_status) ;
--   * admin_rename_partner        — Partners : nom.
--
-- POURQUOI une RPC et pas l'update direct que la RLS autorise (products_write_admin) : une ligne
-- du tableau porte plusieurs cellules modifiées, et la valider doit être UN aller-retour atomique —
-- soit tout passe, soit rien. Deux écritures client séparées laisseraient une fiche à moitié
-- enregistrée derrière un toast d'erreur. S'y ajoute la trace : le type et l'établissement d'une
-- fiche n'avaient aucun chemin d'écriture, donc aucune ligne d'audit_log à leur nom.
--
-- Frontière RLS / RPC-only (CLAUDE.md §3) : aucune table, aucune policy, aucun grant de table ne
-- change. products, catalog_tags, product_tag_assignments et product_amenity_assignments restent en
-- RLS directe admin-only ; ces RPC sont un chemin de plus, pas un contournement.
--
-- PAS une RPC critique au sens de §4.1, et c'est voulu : aucune de ces fonctions n'écrit une table
-- de capacité (product_availability, product_slot_availability, provider_resource_calendar,
-- product_calendar) ni order_lines. Le changement de type ou d'établissement — seule opération qui
-- aurait pu y toucher — est REFUSÉ dès que la fiche porte la moindre configuration de cupos, au
-- lieu de la nettoyer : la fonction lit ces tables, elle ne les écrit jamais.
--
-- Enveloppe du changement de type / d'établissement (échec fermé, §4.4). Les deux étaient figés à
-- la création ; ils ne deviennent modifiables que pour une fiche encore « vierge » :
--   1. dépubliée (sellable = false, valeur STOCKÉE avant l'appel) — create_order refuse une fiche
--      non vendable, donc aucune commande ne peut naître pendant la bascule ;
--   2. jamais commandée (aucune order_lines, quel que soit le statut — même signal que
--      delete_product, 20260815220000) ;
--   3. non liée à LobbyPMS (lobby_category_id / lobby_product_id) : ces identifiants désignent une
--      catégorie du compte Lobby de l'ÉTABLISSEMENT d'origine ;
--   4. sans proposition socio en attente (elle a été écrite pour le type et le propriétaire actuels) ;
--   5. type seulement — sans cupos, créneaux ni tarifs par date : un cupo de 12 places lu comme
--      12 chambres est une survente.
-- Une fiche jamais commandée peut déjà être supprimée puis recréée sous un autre type : cette
-- enveloppe n'ouvre aucun pouvoir neuf, elle évite de perdre nom, description, photos et étiquettes.
--
-- Au changement de type, sont remis à leur valeur neutre : les colonnes que les CHECK réservent à
-- l'ancien type (products_*_evento_only / _camp_only / _transport_only), sans quoi l'update
-- échouerait ; et default_capacity, parce que roll_lodging_availability_window (cron quotidien)
-- ouvre 6 mois de nuits à toute fiche `lodging` qui en porte un — une activité de 12 places devenue
-- logement se retrouverait en vente avec 12 chambres sans que personne ne l'ait décidé.
--
-- Refus métier : rendus dans `reason` (jamais levés), comme create_order — l'écran les traduit,
-- il n'analyse aucun message. Toute validation précède la première écriture : un `ok:false` ne
-- laisse rien derrière lui.
-- Prouvé par supabase/tests/database/admin_inline_edit.test.sql.

-- ============================================================================================
-- 1. admin_update_product_inline
-- ============================================================================================
create function public.admin_update_product_inline(
  p_product_id uuid,
  p_changes jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  -- État stocké, lu sous verrou.
  v_name jsonb;
  v_type text;
  v_establishment_id uuid;
  v_partner_id uuid;
  v_price_cop bigint;
  v_price_tiers jsonb;
  v_is_free boolean;
  v_sellable boolean;
  v_lobby_category_id int;
  v_lobby_product_id int;
  v_duration_days int;
  v_occurrence_date date;
  v_external_booking_url text;
  v_tag_ids uuid[];
  -- État demandé.
  v_new_name_es text;
  v_new_type text;
  v_new_establishment_id uuid;
  v_new_partner_id uuid;
  v_new_price numeric;
  v_new_sellable boolean;
  v_new_tag_ids uuid[];
  v_type_changes boolean := false;
  v_establishment_changes boolean := false;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_update_product_inline réservé au rôle admin' using errcode = '42501';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'p_changes doit être un objet jsonb';
  end if;

  -- Liste blanche : une clé inconnue est une erreur d'appelant, pas un refus métier — elle lève.
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('name_es', 'establishment_id', 'type', 'price_cop', 'sellable', 'tag_ids') then
      raise exception 'clé non autorisée : %', v_key;
    end if;
  end loop;

  -- `for no key update` : verrouille la ligne contre un autre admin sans bloquer l'insert d'une
  -- order_lines (clé étrangère, `for key share`) — create_order tient déjà ses lignes de capacité
  -- quand il insère, un `for update` ici l'aurait fait attendre sans rien protéger de plus.
  select name, type, establishment_id, partner_id, price_cop, price_tiers, is_free, sellable,
         lobby_category_id, lobby_product_id, duration_days, occurrence_date, external_booking_url
    into v_name, v_type, v_establishment_id, v_partner_id, v_price_cop, v_price_tiers, v_is_free,
         v_sellable, v_lobby_category_id, v_lobby_product_id, v_duration_days, v_occurrence_date,
         v_external_booking_url
    from public.products
   where id = p_product_id
     for no key update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- ---------- Validation de chaque clé présente (aucune écriture avant la fin de ce bloc) ------
  if p_changes ? 'name_es' then
    if jsonb_typeof(p_changes -> 'name_es') <> 'string' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_name');
    end if;
    v_new_name_es := btrim(p_changes ->> 'name_es');
    if v_new_name_es = '' or char_length(v_new_name_es) > 200 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_name');
    end if;
  end if;

  if p_changes ? 'price_cop' then
    if jsonb_typeof(p_changes -> 'price_cop') <> 'number' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_price');
    end if;
    v_new_price := (p_changes ->> 'price_cop')::numeric;
    if v_new_price <= 0 or v_new_price <> trunc(v_new_price) or v_new_price > 1000000000000 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_price');
    end if;
  end if;

  if p_changes ? 'sellable' then
    if jsonb_typeof(p_changes -> 'sellable') <> 'boolean' then
      raise exception 'sellable doit être un booléen';
    end if;
    v_new_sellable := (p_changes ->> 'sellable')::boolean;
  end if;

  if p_changes ? 'type' then
    v_new_type := p_changes ->> 'type';
    if v_new_type is null
       or v_new_type not in ('lodging', 'activity', 'transport', 'camp', 'evento') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_type');
    end if;
    v_type_changes := v_new_type <> v_type;
  end if;

  if p_changes ? 'establishment_id' then
    -- Comparaison en texte : aucune chaîne venue du client n'est castée en uuid (une valeur
    -- malformée donne « introuvable », jamais une erreur de cast).
    select e.id, e.partner_id into v_new_establishment_id, v_new_partner_id
      from public.establishments e
     where e.id::text = p_changes ->> 'establishment_id';
    if v_new_establishment_id is null then
      return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
    end if;
    v_establishment_changes := v_new_establishment_id <> v_establishment_id;
  end if;

  if p_changes ? 'tag_ids' then
    if jsonb_typeof(p_changes -> 'tag_ids') <> 'array' then
      raise exception 'tag_ids doit être un tableau';
    end if;
    -- RECONSTRUIT depuis catalog_tags (opérateur `?`), jamais recopié : un identifiant inconnu
    -- disparaît, aucun texte client n'est casté (même parti pris que 20261013144848).
    select coalesce(array_agg(t.id order by t.id), '{}'::uuid[]) into v_new_tag_ids
      from public.catalog_tags t
     where (p_changes -> 'tag_ids') ? t.id::text;
    select coalesce(array_agg(a.tag_id order by a.tag_id), '{}'::uuid[]) into v_tag_ids
      from public.product_tag_assignments a
     where a.product_id = p_product_id;
  end if;

  -- ---------- Gardes du prix ------------------------------------------------------------------
  if v_new_price is not null and v_new_price is distinct from v_price_cop then
    -- Avec des paliers, price_cop est DÉRIVÉ (le palier le plus bas, productEditPayload.ts) :
    -- l'écrire seul le désynchroniserait de price_tiers. `'null'::jsonb` n'est pas un palier.
    if jsonb_typeof(v_price_tiers) = 'array' and jsonb_array_length(v_price_tiers) > 0 then
      return jsonb_build_object('ok', false, 'reason', 'price_has_tiers');
    end if;
    -- Lu sur le type STOCKÉ : si la fiche quitte `evento` dans ce même appel, is_free repart à
    -- false plus bas et le prix redevient légitime.
    if v_is_free and coalesce(v_new_type, v_type) = 'evento' then
      return jsonb_build_object('ok', false, 'reason', 'price_free_evento');
    end if;
  end if;

  -- ---------- Gardes du changement de type / d'établissement (en-tête, points 1 à 5) ----------
  if v_type_changes or v_establishment_changes then
    if v_sellable then
      return jsonb_build_object('ok', false, 'reason', 'must_unpublish_first');
    end if;
    if exists (select 1 from public.order_lines ol where ol.product_id = p_product_id) then
      return jsonb_build_object('ok', false, 'reason', 'has_orders');
    end if;
    if v_lobby_category_id is not null or v_lobby_product_id is not null then
      return jsonb_build_object('ok', false, 'reason', 'pms_linked');
    end if;
    if exists (
      select 1 from public.product_proposals pp
       where pp.product_id = p_product_id and pp.status = 'pending'
    ) then
      return jsonb_build_object('ok', false, 'reason', 'pending_proposal');
    end if;
  end if;

  if v_type_changes then
    if exists (select 1 from public.product_availability a where a.product_id = p_product_id)
       or exists (select 1 from public.product_slot_availability s where s.product_id = p_product_id)
       or exists (select 1 from public.product_slot_rules r where r.product_id = p_product_id)
       or exists (select 1 from public.product_date_rates d where d.product_id = p_product_id) then
      return jsonb_build_object('ok', false, 'reason', 'has_capacity_config');
    end if;
    -- duration_days et la date d'un evento ne se saisissent qu'à la création (product-form.tsx,
    -- « gap création-only ») : une fiche convertie sans eux resterait incomplète pour toujours.
    if v_new_type = 'camp' and v_duration_days is null then
      return jsonb_build_object('ok', false, 'reason', 'camp_needs_duration');
    end if;
    if v_new_type = 'evento' and v_occurrence_date is null then
      return jsonb_build_object('ok', false, 'reason', 'evento_needs_date');
    end if;
    -- products_price_cop_required_unless_vitrine : hors evento, il faut un prix ou une vitrine.
    if v_new_type <> 'evento'
       and coalesce(v_new_price::bigint, v_price_cop) is null
       and v_external_booking_url is null then
      return jsonb_build_object('ok', false, 'reason', 'type_needs_price');
    end if;
  end if;

  -- ---------- Écritures -----------------------------------------------------------------------
  if v_new_name_es is not null and v_new_name_es is distinct from (v_name ->> 'es') then
    -- Seule la clé `es` bouge : les autres langues du contenu partenaire sont conservées
    -- (CLAUDE.md §5.1). Le slug ne suit pas — il n'est posé qu'à l'insert (products_set_slug),
    -- l'URL publique d'une fiche renommée ne change donc pas.
    update public.products
       set name = coalesce(name, '{}'::jsonb) || jsonb_build_object('es', v_new_name_es)
     where id = p_product_id;
    v_before := v_before || jsonb_build_object('name_es', v_name ->> 'es');
    v_after := v_after || jsonb_build_object('name_es', v_new_name_es);
  end if;

  if v_type_changes then
    update public.products
       set type = v_new_type,
           default_capacity = null,
           -- products_*_evento_only
           online_bookable = false,
           evento_capacity_mode = null,
           is_free = false,
           evento_payment_mode = null,
           evento_occupies_resource = true,
           -- products_group_discount_camp_only / products_program_camp_only
           group_discount_threshold_qty = null,
           group_discount_pct = null,
           program = null,
           -- products_transport_info_transport_only / products_transport_contact_phone_transport_only
           transport_first_departure_time = null,
           transport_last_departure_time = null,
           transport_seats_per_departure = null,
           transport_departure_address = null,
           transport_departure_lat = null,
           transport_departure_lon = null,
           transport_arrival_address = null,
           transport_arrival_lat = null,
           transport_arrival_lon = null,
           transport_contact_phone = null
     where id = p_product_id;
    -- Les équipements structurés n'existent que pour un logement (productTypeGating.hasAmenities).
    if v_type = 'lodging' then
      delete from public.product_amenity_assignments where product_id = p_product_id;
    end if;
    v_before := v_before || jsonb_build_object('type', v_type);
    v_after := v_after || jsonb_build_object('type', v_new_type);
  end if;

  if v_establishment_changes then
    -- partner_id suit l'établissement : products.partner_id = establishments.partner_id est un
    -- invariant du catalogue (transfer_establishment le tient de son côté).
    update public.products
       set establishment_id = v_new_establishment_id,
           partner_id = v_new_partner_id
     where id = p_product_id;
    v_before := v_before
      || jsonb_build_object('establishment_id', v_establishment_id, 'partner_id', v_partner_id);
    v_after := v_after
      || jsonb_build_object('establishment_id', v_new_establishment_id, 'partner_id', v_new_partner_id);
  end if;

  if v_new_price is not null and v_new_price is distinct from v_price_cop then
    update public.products set price_cop = v_new_price::bigint where id = p_product_id;
    v_before := v_before || jsonb_build_object('price_cop', v_price_cop);
    v_after := v_after || jsonb_build_object('price_cop', v_new_price::bigint);
  end if;

  if v_new_tag_ids is not null and v_new_tag_ids is distinct from v_tag_ids then
    delete from public.product_tag_assignments
     where product_id = p_product_id and not (tag_id = any (v_new_tag_ids));
    insert into public.product_tag_assignments (product_id, tag_id)
    select p_product_id, t from unnest(v_new_tag_ids) as t
    on conflict (product_id, tag_id) do nothing;
    v_before := v_before || jsonb_build_object('tag_ids', to_jsonb(v_tag_ids));
    v_after := v_after || jsonb_build_object('tag_ids', to_jsonb(v_new_tag_ids));
  end if;

  if v_after <> '{}'::jsonb then
    update public.products set updated_at = now() where id = p_product_id;
    perform public.log_admin_action(
      'product.update_inline', 'products', p_product_id, v_before, v_after, p_note
    );
  end if;

  -- Publication en DERNIER, sous les mêmes noms d'action que set_product_sellable : le journal
  -- d'audit garde une seule façon de dire « publié / dépublié », quel que soit l'écran.
  if v_new_sellable is not null and v_new_sellable <> v_sellable then
    update public.products set sellable = v_new_sellable, updated_at = now() where id = p_product_id;
    perform public.log_admin_action(
      case when v_new_sellable then 'product.publish' else 'product.unpublish' end,
      'products', p_product_id,
      jsonb_build_object('sellable', v_sellable),
      jsonb_build_object('sellable', v_new_sellable),
      p_note
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Une fonction neuve est exécutable par PUBLIC (.claude/rules/supabase.md, « sens inverse ») :
-- refermer d'abord, puis n'ouvrir qu'à authenticated — la garde is_admin fait le reste.
revoke all on function public.admin_update_product_inline(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_update_product_inline(uuid, jsonb, text) to authenticated;

-- ============================================================================================
-- 2. admin_rename_establishment — le nom seul. update_establishment réécrit SIX colonnes à chaque
--    appel (description, adresse, coordonnées…) : la liste aurait dû les lui renvoyer telles
--    quelles, donc écraser une édition faite entre-temps sur la fiche. RPC étroite, comme le
--    prescrit .claude/rules/supabase.md (« ne pas étendre update_establishment »).
-- ============================================================================================
create function public.admin_rename_establishment(
  p_establishment_id uuid,
  p_name_es text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name jsonb;
  v_new_name_es text := btrim(coalesce(p_name_es, ''));
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_rename_establishment réservé au rôle admin' using errcode = '42501';
  end if;

  if v_new_name_es = '' or char_length(v_new_name_es) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  select name into v_name
    from public.establishments where id = p_establishment_id for no key update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_new_name_es is distinct from (v_name ->> 'es') then
    -- Seule la clé `es` bouge ; le slug (URL publique) reste celui de la création.
    update public.establishments
       set name = coalesce(name, '{}'::jsonb) || jsonb_build_object('es', v_new_name_es),
           updated_at = now()
     where id = p_establishment_id;
    perform public.log_admin_action(
      'establishment.update', 'establishments', p_establishment_id,
      jsonb_build_object('name', v_name),
      jsonb_build_object('name', coalesce(v_name, '{}'::jsonb) || jsonb_build_object('es', v_new_name_es)),
      p_note
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_rename_establishment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_rename_establishment(uuid, text, text) to authenticated;

-- ============================================================================================
-- 3. admin_rename_partner — aucune RPC ne modifiait un partenaire après sa création. La policy
--    partners_update autorise déjà l'admin en direct ; la RPC ajoute seulement la ligne d'audit
--    dans le même aller-retour.
-- ============================================================================================
create function public.admin_rename_partner(
  p_partner_id uuid,
  p_display_name text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_new_display_name text := btrim(coalesce(p_display_name, ''));
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_rename_partner réservé au rôle admin' using errcode = '42501';
  end if;

  if v_new_display_name = '' or char_length(v_new_display_name) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  select display_name into v_display_name
    from public.partners where id = p_partner_id for no key update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_new_display_name is distinct from v_display_name then
    update public.partners
       set display_name = v_new_display_name, updated_at = now()
     where id = p_partner_id;
    perform public.log_admin_action(
      'partner.rename', 'partners', p_partner_id,
      jsonb_build_object('display_name', v_display_name),
      jsonb_build_object('display_name', v_new_display_name),
      p_note
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_rename_partner(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_rename_partner(uuid, text, text) to authenticated;
