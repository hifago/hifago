-- Fiche établissement : le partenaire propose tout ce que l'admin édite (demande du 2026-10-14).
--
-- Constat : sur /admin/establishments/[id], l'admin édite le séjour (check-in, check-out, « ¿Cómo
-- se vende? »), le contact WhatsApp public et les équipements ; le partenaire ne pouvait proposer
-- aucun des trois, ni en édition ni en création. La spec 06 (2026-08-15) n'avait ouvert que les
-- champs de l'époque, et chaque bloc ajouté depuis (spec 24, spec 30, équipements du 2026-09-17)
-- ne l'a été que côté admin — la spec 30 voulait pourtant le contact « rempli par le partenaire ».
-- Consigne : « ce n'est pas à un admin de remplir la fiche d'un partenaire, il faut tout ».
-- Publier/dépublier, operated_directly, is_place et l'activation du connecteur Lobby restent admin.
--
-- Toujours en PROPOSITION modérée (spec 06, décision 2) : le partenaire n'écrit jamais lui-même.
-- Même chemin que les étiquettes (20261013144848) et les équipements de logement (20261013151206).
--
-- Ce que fait cette migration :
--   * establishment_proposal_details (nouvelle, interne) — LA validation, appelée au dépôt ET à
--     l'approbation : check_in_time/check_out_time/mode voyagent ensemble (stay_incomplete sinon :
--     update_establishment_stay_details remplace les trois), heures HH:MM[:SS] (invalid_time),
--     mode dans le domaine (invalid_mode), contact_phone en E.164 (invalid_phone, même motif que la
--     contrainte establishments_contact_phone_e164), tag_ids/amenity_ids RECONSTRUITS depuis les
--     catalogues (opérateur jsonb `?`, jamais un cast de texte client en uuid).
--   * apply_establishment_proposal_details (nouvelle, interne) — LES écritures, communes à la
--     création et à l'édition approuvées : séjour et contact par leurs RPC étroites existantes
--     (update_establishment_stay_details, update_establishment_contact — qui auditent déjà), puis
--     étiquettes et équipements REMPLACÉS. Jamais update_establishment, que trois chemins de
--     modération appellent (.claude/rules/supabase.md).
--   * submit_establishment_creation_proposal accepte ces clés, étiquettes comprises (une création
--     n'en portait aucune) ; submit_establishment_edit_proposal aussi, et refuse un mode
--     d'hébergement sur un lieu (place_has_no_stay_mode) ; moderate_establishment_proposal valide la
--     correction de l'admin AVANT toute écriture, puis applique.
--
-- FORME GARDÉE partout, comme pour les étiquettes : une clé n'entre que si le client l'envoie, et
-- l'approbation n'écrit que si elle y est. Une proposition déposée avant cette migration, ou qui ne
-- touche pas à ces champs, n'en efface donc aucun.
--
-- Frontière RLS / RPC-only (CLAUDE.md §3) : aucune table ni policy nouvelle ; les tables
-- d'assignation gardent leur RLS directe admin-only, le socio n'y écrit toujours pas. Les deux
-- fonctions internes sont fermées à anon/authenticated (revoke explicite : PostgreSQL accorde
-- EXECUTE à PUBLIC sur toute fonction neuve). Aucune signature existante ne change (create or
-- replace suffit, grants conservés). Aucune RPC critique au sens de §4.1 (ni capacité, ni
-- réservation).
--
-- Corps repris des dernières définitions (20260825130000, 20261013144848) par remplacements
-- comptés, jamais retapés — seuls les blocs marqués 20261015004421 sont nouveaux.
-- Prouvé par supabase/tests/database/proposal_establishment_parity.test.sql.

-- ═══ establishment_proposal_details — validation, sans écriture ═══════════════════════════════
-- Rend {ok: true, details: {...}} — les seules clés présentes dans le payload, normalisées — ou
-- {ok: false, reason}. Un tableau d'étiquettes ou d'équipements vide reste un tableau vide : c'est
-- une demande explicite de tout retirer, pas une absence.
create function public.establishment_proposal_details(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_details jsonb := '{}'::jsonb;
  v_check_in text;
  v_check_out text;
  v_mode text;
  v_phone text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', true, 'details', v_details);
  end if;

  -- Séjour : les trois clés ensemble ou aucune. Une seule clé ferait effacer les deux autres par
  -- update_establishment_stay_details, qui les remplace d'un bloc.
  if p_payload ? 'check_in_time' or p_payload ? 'check_out_time' or p_payload ? 'mode' then
    if not (p_payload ? 'check_in_time' and p_payload ? 'check_out_time' and p_payload ? 'mode') then
      return jsonb_build_object('ok', false, 'reason', 'stay_incomplete');
    end if;
    v_check_in := nullif(btrim(p_payload ->> 'check_in_time'), '');
    v_check_out := nullif(btrim(p_payload ->> 'check_out_time'), '');
    v_mode := nullif(btrim(p_payload ->> 'mode'), '');
    if (v_check_in is not null and v_check_in !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')
       or (v_check_out is not null and v_check_out !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_time');
    end if;
    -- Même domaine que update_establishment_stay_details.
    if v_mode is not null and v_mode not in ('rooms', 'whole_house') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_mode');
    end if;
    v_details := v_details || jsonb_build_object(
      'check_in_time', v_check_in, 'check_out_time', v_check_out, 'mode', v_mode);
  end if;

  -- Contact public : vide = retirer le bouton WhatsApp de la fiche (même règle que l'admin).
  if p_payload ? 'contact_phone' then
    v_phone := nullif(btrim(p_payload ->> 'contact_phone'), '');
    if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
    end if;
    v_details := v_details || jsonb_build_object('contact_phone', v_phone);
  end if;

  -- Étiquettes et équipements : listes existantes seulement, jamais créées ici.
  if jsonb_typeof(p_payload -> 'tag_ids') = 'array' then
    v_details := v_details || jsonb_build_object('tag_ids', (
      select coalesce(jsonb_agg(t.id order by t.slug), '[]'::jsonb)
        from public.catalog_tags t
       where (p_payload -> 'tag_ids') ? t.id::text
    ));
  end if;
  if jsonb_typeof(p_payload -> 'amenity_ids') = 'array' then
    v_details := v_details || jsonb_build_object('amenity_ids', (
      select coalesce(jsonb_agg(c.id order by c.slug), '[]'::jsonb)
        from public.catalog_amenities c
       where (p_payload -> 'amenity_ids') ? c.id::text
    ));
  end if;

  return jsonb_build_object('ok', true, 'details', v_details);
end;
$$;

revoke all on function public.establishment_proposal_details(jsonb) from public, anon, authenticated;

-- ═══ apply_establishment_proposal_details — écritures d'une approbation ═══════════════════════
-- Reçoit des détails DÉJÀ validés par establishment_proposal_details. Appelée seulement par
-- moderate_establishment_proposal, après la vérification is_admin de celle-ci : les RPC étroites
-- appelées ici journalisent par log_admin_action, qui refuse tout autre appelant.
create function public.apply_establishment_proposal_details(p_establishment_id uuid, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_details ? 'check_in_time' then
    v_result := public.update_establishment_stay_details(
      p_establishment_id,
      (p_details ->> 'check_in_time')::time,
      (p_details ->> 'check_out_time')::time,
      p_details ->> 'mode'
    );
    -- Validé en amont : un refus ici est un défaut, qui doit annuler toute l'approbation.
    if not coalesce((v_result ->> 'ok')::boolean, false) then
      raise exception 'apply_establishment_proposal_details : séjour refusé (%)', v_result ->> 'reason';
    end if;
  end if;

  if p_details ? 'contact_phone' then
    v_result := public.update_establishment_contact(p_establishment_id, p_details ->> 'contact_phone');
    if not coalesce((v_result ->> 'ok')::boolean, false) then
      raise exception 'apply_establishment_proposal_details : contact refusé (%)', v_result ->> 'reason';
    end if;
  end if;

  -- L'ensemble est REMPLACÉ ; la jointure sur le catalogue écarte un élément supprimé depuis.
  if jsonb_typeof(p_details -> 'tag_ids') = 'array' then
    delete from public.establishment_tag_assignments a
     where a.establishment_id = p_establishment_id
       and not ((p_details -> 'tag_ids') ? a.tag_id::text);

    insert into public.establishment_tag_assignments (establishment_id, tag_id)
    select p_establishment_id, t.id
      from public.catalog_tags t
     where (p_details -> 'tag_ids') ? t.id::text
    on conflict do nothing;
  end if;

  if jsonb_typeof(p_details -> 'amenity_ids') = 'array' then
    delete from public.establishment_amenity_assignments a
     where a.establishment_id = p_establishment_id
       and not ((p_details -> 'amenity_ids') ? a.amenity_id::text);

    insert into public.establishment_amenity_assignments (establishment_id, amenity_id)
    select p_establishment_id, c.id
      from public.catalog_amenities c
     where (p_details -> 'amenity_ids') ? c.id::text
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.apply_establishment_proposal_details(uuid, jsonb) from public, anon, authenticated;

-- ═══ submit_establishment_creation_proposal ═══════════════════════════════════════════════════
create or replace function public.submit_establishment_creation_proposal(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_id uuid;
  v_safe_payload jsonb;
  v_safe_photos jsonb;
  v_lobby_token text;
  v_details jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));
  if v_partner_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_a_partner');
  end if;

  if coalesce(btrim(p_payload -> 'name' ->> 'es'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  if (
    select count(*) from public.establishment_proposals
     where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  if jsonb_typeof(p_payload -> 'photos') = 'array' and jsonb_array_length(p_payload -> 'photos') > 6 then
    return jsonb_build_object('ok', false, 'reason', 'gallery_cap_exceeded');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', photo ->> 'storage_path')), '[]'::jsonb)
    into v_safe_photos
    from jsonb_array_elements(coalesce(p_payload -> 'photos', '[]'::jsonb)) photo
   where coalesce(btrim(photo ->> 'storage_path'), '') <> '';

  v_lobby_token := nullif(btrim(p_payload ->> 'lobby_api_token'), '');

  -- Ajout 20261015004421 : séjour, contact, étiquettes et équipements, validés et filtrés par la
  -- même fonction que l'édition et l'approbation.
  v_details := public.establishment_proposal_details(p_payload);
  if not (v_details ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', v_details ->> 'reason');
  end if;

  v_safe_payload := jsonb_build_object(
      'name', p_payload -> 'name', 'description', p_payload -> 'description',
      'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon',
      'photos', v_safe_photos
    )
    || case when v_lobby_token is not null
         then jsonb_build_object('lobby_api_token', v_lobby_token)
         else '{}'::jsonb end
    || (v_details -> 'details');

  insert into public.establishment_proposals (establishment_id, partner_id, submitted_by, kind, payload)
  values (null, v_partner_id, v_account_id, 'create', v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$$;

-- ═══ submit_establishment_edit_proposal ═══════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.submit_establishment_edit_proposal(p_establishment_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_id uuid;
  v_safe_payload jsonb;
  v_lobby_token text;
  v_details jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));

  if not exists (
    select 1 from public.establishments
     where id = p_establishment_id and partner_id = v_partner_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
  end if;

  if not (select public.has_capability(v_account_id, 'operator', p_establishment_id)) then
    return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
  end if;

  if coalesce(btrim(p_payload -> 'name' ->> 'es'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  if (
    select count(*) from public.establishment_proposals
     where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  v_lobby_token := nullif(btrim(p_payload ->> 'lobby_api_token'), '');

  -- Ajout 20261015004421 : séjour, contact, étiquettes et équipements, validés au DÉPÔT — une
  -- valeur invalide refusée ici, jamais découverte à l'approbation. Un lieu (is_place) n'a pas de
  -- mode d'hébergement : sans ce refus, la contrainte establishments_place_has_no_stay_mode ferait
  -- échouer l'approbation.
  v_details := public.establishment_proposal_details(p_payload);
  if not (v_details ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', v_details ->> 'reason');
  end if;
  if v_details -> 'details' ->> 'mode' is not null
     and (select e.is_place from public.establishments e where e.id = p_establishment_id) then
    return jsonb_build_object('ok', false, 'reason', 'place_has_no_stay_mode');
  end if;

  v_safe_payload := jsonb_build_object(
      'name', p_payload -> 'name', 'description', p_payload -> 'description',
      'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon'
    )
    || case when v_lobby_token is not null
         then jsonb_build_object('lobby_api_token', v_lobby_token)
         else '{}'::jsonb end
    -- Étiquettes (20261013144848), désormais filtrées avec le reste par
    -- establishment_proposal_details (20261015004421) — même reconstruction depuis catalog_tags.
    || (v_details -> 'details');

  insert into public.establishment_proposals (establishment_id, partner_id, submitted_by, kind, payload)
  values (p_establishment_id, v_partner_id, v_account_id, 'edit', v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$function$;

-- ═══ moderate_establishment_proposal ═════════════════════════════════════════════════════════
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
  v_details jsonb;
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
    )
    -- Étiquettes (20261013144848), puis séjour, contact et équipements (20261015004421), en
    -- création comme en édition. Même repli clé par clé que les champs ci-dessus — la correction
    -- de l'admin, sinon la proposition — mais une clé n'entre QUE si l'une des deux la porte :
    -- absente des deux, la valeur en place ne bouge pas (forme gardée).
    || (select coalesce(jsonb_object_agg(k, coalesce(p_corrected_payload -> k, v_proposal.payload -> k)), '{}'::jsonb)
          from unnest(array['check_in_time', 'check_out_time', 'mode', 'contact_phone',
                            'tag_ids', 'amenity_ids']) k
         where (p_corrected_payload ? k) or (v_proposal.payload ? k));

    -- Ajout 20261015004421 : la correction de l'admin ne repasse pas par la whitelist du dépôt,
    -- d'où une nouvelle validation ICI, AVANT toute écriture — une valeur refusée ne laisse
    -- jamais une approbation à moitié écrite. Les tableaux sont reconstruits depuis les catalogues :
    -- une étiquette ou un équipement supprimé depuis le dépôt est écarté, sans échec.
    v_details := public.establishment_proposal_details(v_final_payload);
    if not (v_details ->> 'ok')::boolean then
      return jsonb_build_object('ok', false, 'reason', v_details ->> 'reason');
    end if;
    if v_proposal.kind = 'edit'
       and v_details -> 'details' ->> 'mode' is not null
       and (select e.is_place from public.establishments e where e.id = v_proposal.establishment_id) then
      return jsonb_build_object('ok', false, 'reason', 'place_has_no_stay_mode');
    end if;
    v_final_payload := v_final_payload || (v_details -> 'details');
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

      -- Ajout 20261015004421 : tout ce que le partenaire a rempli à la création est posé ici —
      -- sinon il ne pourrait le compléter qu'une fois sa capacité operator activée par un admin.
      perform public.apply_establishment_proposal_details(v_new_establishment_id, v_details -> 'details');

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

      -- Étiquettes (20261013144848), séjour, contact et équipements (20261015004421) : écrits
      -- ICI et non dans update_establishment, que trois chemins de modération appellent
      -- (.claude/rules/supabase.md).
      perform public.apply_establishment_proposal_details(v_proposal.establishment_id, v_details -> 'details');

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
