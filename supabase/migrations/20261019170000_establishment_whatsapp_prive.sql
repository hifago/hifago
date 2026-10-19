-- Le WhatsApp du prestataire : OBLIGATOIRE à la création d'un établissement, COLOMBIEN (+57), et
-- PRIVÉ jusqu'à ce que le client ait finalisé sa réservation — décision Jérôme du 2026-10-19 :
-- « à aucun moment le numéro du prestataire ne doit apparaître avant que le client ait finalisé sa
-- réservation ». Ce numéro sert de contact avec le prestataire pour tous les services réservés.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- CE QUE CETTE MIGRATION RÉVISE
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- `establishments.contact_phone` (20260908202000, spec 30 §3.2) était un contact PUBLIC : lisible
-- par `anon`, affiché en bouton WhatsApp sur la fiche établissement. Cette décision est renversée
-- par Jérôme le 2026-10-19. La colonne reste la même (aucune donnée ne bouge), son statut change :
--
--   1. LECTURE. `grant select (contact_phone)` est RETIRÉ à `anon` ET `authenticated` — un client
--      connecté à la vitrine est `authenticated`, retirer `anon` seul laisserait le numéro à un
--      `select` PostgREST de n'importe quel compte. Plus personne ne lit la colonne en direct :
--        - le client, par `order_for_client_jsonb` (security definer), et seulement une fois la
--          commande finalisée — voir plus bas ;
--        - l'admin, par `get_establishment_contact_phone` (security definer, `is_admin`).
--      ⚠️ Une requête qui la sélectionne encore tombe en `permission denied for column` (piège
--      §11.1) : la vitrine (`apps/web/lib/catalog/establecimiento.ts`) et la fiche admin ne la
--      demandent plus, dans le même lot.
--
--   2. ÉCRITURE. Le numéro est exigé par `create_establishment` (admin), par
--      `submit_establishment_creation_proposal` (socio) et donc par `moderate_establishment_
--      proposal` à l'approbation d'une création. `update_establishment_contact` ne permet plus de
--      l'EFFACER (il ne permet que de le remplacer) : un numéro obligatoire qu'on peut vider n'est
--      pas obligatoire. Les établissements nés avant cette migration gardent `null` — aucune
--      valeur ne s'invente — et l'admin le renseigne depuis leur fiche.
--
--   3. FORME. +57 suivi de 10 chiffres, rien d'autre (les mobiles colombiens 3xx et les fixes
--      60x ont tous deux 10 chiffres). La contrainte E.164 d'origine reste en place ; la nouvelle
--      est posée `not valid` : elle s'impose à toute écriture future, sans faire échouer la
--      migration sur un numéro étranger saisi en préprod depuis le 2026-09-08 — ce cas ne se
--      corrige pas en silence, il se voit quand l'admin enregistre la fiche.
--
-- FRONTIÈRE §3 : `establishments` reste en RLS directe (aucun compteur, aucune écriture
-- concurrente). La LECTURE du numéro, elle, devient une lecture des données d'une autre identité
-- (le prestataire, lue par un client) sous condition : §3.1, d'où le passage par deux fonctions
-- `security definer` et l'absence de tout grant colonne.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- La règle de forme, écrite UNE fois et appelée par les quatre écritures
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Rend le numéro canonique (`+573001234567`) ou `null` s'il n'en est pas un. Les espaces, tirets,
-- points et parenthèses sont ôtés d'abord : « +57 300 123 4567 » est le même numéro, le refuser
-- serait du zèle de saisie. Rien d'autre n'est deviné (pas d'ajout du +57 ici : c'est l'écran qui
-- le porte en préfixe fixe, cf. apps/admin/lib/establishments/colombianWhatsApp.ts).
create function public.colombian_whatsapp_or_null(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when regexp_replace(coalesce(p_phone, ''), '[[:space:]().-]', '', 'g') ~ '^\+57[0-9]{10}$'
      then regexp_replace(p_phone, '[[:space:]().-]', '', 'g')
  end;
$$;

comment on function public.colombian_whatsapp_or_null is
  'Numéro WhatsApp colombien canonique (+57 + 10 chiffres) ou null. Seule définition de la forme, '
  'appelée par create_establishment, submit_establishment_creation_proposal, '
  'moderate_establishment_proposal et update_establishment_contact (2026-10-19).';

alter table public.establishments
  add constraint establishments_contact_phone_colombia
  check (contact_phone is null or contact_phone ~ '^\+57[0-9]{10}$') not valid;

comment on column public.establishments.contact_phone is
  'WhatsApp du prestataire, +57 et 10 chiffres. PRIVÉ (2026-10-19) : aucun grant de lecture à '
  'anon/authenticated. Rendu au client par order_for_client_jsonb UNIQUEMENT sur une commande '
  'finalisée, et dans l''e-mail de confirmation ; à l''admin par get_establishment_contact_phone. '
  'Obligatoire à la création (create_establishment, submit_establishment_creation_proposal).';

-- ⚠️ LE CŒUR DE LA MIGRATION. Sans ces deux lignes, tout le reste est cosmétique : le numéro
-- resterait à un `select contact_phone from establishments` de n'importe quel visiteur.
revoke select (contact_phone) on public.establishments from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Lecture admin
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create function public.get_establishment_contact_phone(p_establishment_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.contact_phone
    from public.establishments e
   where e.id = p_establishment_id
     and (select public.is_admin((select auth.uid())));
$$;

comment on function public.get_establishment_contact_phone is
  'WhatsApp du prestataire pour la fiche admin — null pour tout appelant non admin. Remplace la '
  'lecture directe de la colonne, retirée à authenticated le 2026-10-19.';

revoke all on function public.get_establishment_contact_phone(uuid) from public, anon;
grant execute on function public.get_establishment_contact_phone(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- create_establishment : le numéro devient un paramètre, exigé
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Nouvelle signature, donc `drop` d'abord (.claude/rules/supabase.md §7). Le paramètre a un défaut
-- `null` seulement parce qu'il suit des paramètres qui en ont : l'omettre fait échouer l'appel,
-- avec un message que l'écran sait lire.
drop function public.create_establishment(uuid, jsonb, jsonb, text, double precision, double precision, boolean);

create function public.create_establishment(
  p_partner_id uuid,
  p_name jsonb,
  p_description jsonb default null,
  p_address text default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_operated_directly boolean default false,
  p_contact_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_establishment_id uuid;
  v_contact_phone text := public.colombian_whatsapp_or_null(p_contact_phone);
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_establishment réservé au rôle admin' using errcode = '42501';
  end if;

  -- Le MESSAGE est le code lu par l'écran (NewEstablishmentForm.tsx) — ne pas le traduire.
  if v_contact_phone is null then
    raise exception '%', case when coalesce(btrim(p_contact_phone), '') = ''
                              then 'contact_phone_required' else 'contact_phone_invalid' end
      using errcode = '22023';
  end if;

  insert into public.establishments (
    partner_id, name, description, address, lat, lon, operated_directly, contact_phone
  )
  values (
    p_partner_id, p_name, p_description, p_address, p_lat, p_lon, p_operated_directly, v_contact_phone
  )
  returning id into v_establishment_id;

  update public.partner_capabilities
     set establishment_id = v_establishment_id
   where partner_id = p_partner_id
     and role = 'operator'
     and establishment_id is null;

  if not found then
    insert into public.partner_capabilities (partner_id, establishment_id, role, source, status)
    values (p_partner_id, v_establishment_id, 'operator', 'admin', 'active');
  end if;

  -- Le numéro n'entre pas au journal (même règle que update_establishment_contact) : sa présence.
  perform public.log_admin_action(
    'establishment.create', 'establishments', v_establishment_id, null,
    jsonb_build_object('partner_id', p_partner_id, 'name', p_name, 'contact_phone_defini', true), null
  );

  return v_establishment_id;
end;
$function$;

revoke all on function public.create_establishment(uuid, jsonb, jsonb, text, double precision, double precision, boolean, text) from public, anon;
grant execute on function public.create_establishment(uuid, jsonb, jsonb, text, double precision, double precision, boolean, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- update_establishment_contact : colombien, et plus jamais vidé
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.update_establishment_contact(
  p_establishment_id uuid,
  p_contact_phone    text default null
)
returns jsonb
language plpgsql
-- search_path fixé comme sur toute fonction de public, invoker compris (20261002123023,
-- rls_rpc_only_checklist.test.sql) : `create or replace` sans lui l'aurait perdu.
set search_path = ''
as $$
declare
  v_normalise text := public.colombian_whatsapp_or_null(p_contact_phone);
begin
  if coalesce(btrim(p_contact_phone), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'phone_required');
  end if;
  if v_normalise is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  update public.establishments
     set contact_phone = v_normalise,
         updated_at = now()
   where id = p_establishment_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
  end if;

  perform public.log_admin_action(
    'establishment.update_contact', 'establishments', p_establishment_id, null,
    jsonb_build_object('contact_phone_defini', true),
    null
  );

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.update_establishment_contact is
  'Remplace le WhatsApp (privé) du prestataire. security invoker : la policy '
  'establishments_write_admin décide. Ne l''efface jamais (obligatoire depuis le 2026-10-19).';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Les trois fonctions longues, reprises de leur définition VIVANTE (pg_get_functiondef) et
-- modifiées par occurrences comptées — jamais retapées (.claude/rules/supabase.md §7).
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_establishment_creation_proposal(p_payload jsonb)
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
  v_safe_photos jsonb;
  v_lobby_token text;
  -- 20261019170000 : le WhatsApp du prestataire, obligatoire.
  v_contact_phone text := public.colombian_whatsapp_or_null(p_payload ->> 'contact_phone');
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

  -- 20261019170000 : refusé AVANT tout insert — une proposition sans numéro ne pourrait pas être
  -- approuvée (create_establishment l'exige), elle n'entre donc jamais dans la file.
  if v_contact_phone is null then
    return jsonb_build_object('ok', false, 'reason',
      case when coalesce(btrim(p_payload ->> 'contact_phone'), '') = ''
           then 'contact_phone_required' else 'contact_phone_invalid' end);
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

  v_safe_payload := jsonb_build_object(
      'name', p_payload -> 'name', 'description', p_payload -> 'description',
      'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon',
      'photos', v_safe_photos,
      'contact_phone', v_contact_phone
    )
    || case when v_lobby_token is not null
         then jsonb_build_object('lobby_api_token', v_lobby_token)
         else '{}'::jsonb end;

  insert into public.establishment_proposals (establishment_id, partner_id, submitted_by, kind, payload)
  values (null, v_partner_id, v_account_id, 'create', v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$function$;

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
  v_attached_count int := 0;
  -- 20261019170000 :
  v_contact_phone_saisi text;
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
    -- Ajout de cette migration (20261013144848) : étiquettes, édition seulement (une proposition
    -- de création n'en porte pas). Même repli clé par clé que les champs ci-dessus — la correction
    -- de l'admin, sinon la proposition — mais la clé n'entre QUE si un tableau existe : absente,
    -- les étiquettes en place ne bougent pas.
    || case when v_proposal.kind = 'edit'
              and jsonb_typeof(coalesce(p_corrected_payload -> 'tag_ids', v_proposal.payload -> 'tag_ids')) = 'array'
         then jsonb_build_object(
           'tag_ids', coalesce(p_corrected_payload -> 'tag_ids', v_proposal.payload -> 'tag_ids'))
         else '{}'::jsonb end;
    v_lobby_token := nullif(btrim(coalesce(
      p_corrected_payload ->> 'lobby_api_token', v_proposal.payload ->> 'lobby_api_token'
    )), '');

    if v_proposal.kind = 'create' then
      -- 20261019170000 : le WhatsApp — la correction de l'admin, sinon la proposition. Une
      -- proposition déposée avant cette migration n'en porte pas : l'admin le saisit à la
      -- validation (ModerateEstablishmentProposalForm.tsx). Vérifié ICI pour rendre un motif
      -- lisible au lieu de l'exception de create_establishment.
      v_contact_phone_saisi := coalesce(
        nullif(btrim(p_corrected_payload ->> 'contact_phone'), ''), v_proposal.payload ->> 'contact_phone');
      if public.colombian_whatsapp_or_null(v_contact_phone_saisi) is null then
        return jsonb_build_object('ok', false, 'reason',
          case when coalesce(btrim(v_contact_phone_saisi), '') = ''
               then 'contact_phone_required' else 'contact_phone_invalid' end);
      end if;
      v_final_payload := v_final_payload
        || jsonb_build_object('contact_phone', public.colombian_whatsapp_or_null(v_contact_phone_saisi));

      select public.create_establishment(
        v_proposal.partner_id,
        v_final_payload -> 'name',
        v_final_payload -> 'description',
        v_final_payload ->> 'address',
        nullif(v_final_payload ->> 'lat', '')::double precision,
        nullif(v_final_payload ->> 'lon', '')::double precision,
        false,
        v_final_payload ->> 'contact_phone'
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

      -- 20261019120000 : les activités déposées avec cet établissement reçoivent son identifiant
      -- et RESTENT en attente — l'admin les accepte ou les refuse ensuite, une par une. version + 1 :
      -- un écran de modération ouvert avant ce rattachement doit être rechargé.
      update public.product_proposals
         set establishment_id = v_new_establishment_id, version = version + 1, updated_at = now()
       where establishment_proposal_id = p_proposal_id and status = 'pending';
      get diagnostics v_attached_count = row_count;
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

      -- Étiquettes (20261013144848) : écrites ICI et non dans update_establishment, que trois
      -- chemins de modération appellent (.claude/rules/supabase.md). L'ensemble est remplacé, et
      -- la jointure sur catalog_tags écarte une étiquette supprimée depuis le dépôt.
      if jsonb_typeof(v_final_payload -> 'tag_ids') = 'array' then
        delete from public.establishment_tag_assignments a
         where a.establishment_id = v_proposal.establishment_id
           and not ((v_final_payload -> 'tag_ids') ? a.tag_id::text);

        insert into public.establishment_tag_assignments (establishment_id, tag_id)
        select v_proposal.establishment_id, t.id
          from public.catalog_tags t
         where (v_final_payload -> 'tag_ids') ? t.id::text
        on conflict do nothing;
      end if;

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

    -- 20261019120000 (arbitrage Jérôme, 2026-10-19 : refus en cascade) : une activité ne peut pas
    -- exister sans son établissement — celles qui attendaient celui-ci sont refusées avec lui,
    -- jamais laissées orphelines dans la file de l'admin.
    update public.product_proposals
       set status = 'rejected', rejection_reason = 'Establecimiento rechazado: ' || p_rejection_reason,
           reviewed_by = auth.uid(), reviewed_at = now(), version = version + 1, updated_at = now()
     where establishment_proposal_id = p_proposal_id and status = 'pending';
    get diagnostics v_attached_count = row_count;

    if v_attached_count > 0 then
      perform public.log_admin_action('product_proposal.reject_with_establishment', 'establishment_proposals',
        p_proposal_id, null, jsonb_build_object('product_proposals_rejected', v_attached_count),
        p_rejection_reason);
    end if;
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
      v_body := '<p>Tu propuesta para "' || v_entity_name || '" fue aprobada.</p>'
        -- 20261019120000 : un seul e-mail pour l'établissement et ses activités.
        || case when v_attached_count > 0
             then '<p>' || v_attached_count || ' actividad(es) propuesta(s) con este establecimiento siguen en revisión.</p>'
             else '' end;
    else
      v_subject := 'Tu propuesta fue rechazada';
      v_body := '<p>Tu propuesta para "' || v_entity_name || '" fue rechazada.</p>'
        || '<p>Motivo: ' || coalesce(public.html_text(p_rejection_reason), '') || '</p>'
        || case when v_attached_count > 0
             then '<p>' || v_attached_count || ' actividad(es) propuesta(s) con este establecimiento también fueron rechazadas.</p>'
             else '' end;
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

CREATE OR REPLACE FUNCTION public.order_for_client_jsonb(p_order orders)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with lignes as (
    select
      jsonb_build_object(
        'id', ol.id,
        'product_name', p.name,
        'product_type', p.type,
        'product_slug', p.slug,
        'establishment_name', e.name,
        'establishment_slug', case when e.is_place then null else e.slug end,
        -- 20261019170000 (décision Jérôme) : le WhatsApp du prestataire n'apparaît JAMAIS avant
        -- que la réservation soit finalisée — ligne vivante, ET commande payée, OU rien n'y est dû
        -- en ligne (evento gratuit / payable sur place : l'état « confirmed » d'orderState.ts).
        -- Une commande « unpaid » avec un acompte dû, ou « pending », rend null.
        'establishment_contact_phone', case
          when ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded')
           and ((p_order).payment_status in ('paid', 'partially_refunded')
                or ((p_order).payment_status = 'unpaid'
                    and not exists (
                      select 1 from public.order_lines due
                       where due.order_id = (p_order).id and due.acompte_cop > 0
                         and due.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded'))))
          then e.contact_phone
        end,
        'date', ol.date,
        'end_date', ol.end_date,
        -- `duration_days` — NUL pour tout ce qui n'est pas `camp` (contrainte
        -- `products_duration_days_required_for_camp`, 20260814220000). L'écran reconstitue la
        -- date de fin d'un camp à partir de `date` + cette valeur, jamais l'inverse.
        'duration_days', p.duration_days,
        'slot_start_time', ol.slot_start_time,
        'qty', ol.qty,
        'price_cop', ol.price_cop,
        'total_cop', ol.total_cop,
        'acompte_cop', ol.acompte_cop,
        'status', ol.status
      ) as ligne,
      ol.created_at as ligne_created_at,
      ol.id as ligne_id,
      ol.total_cop as ligne_total_cop,
      ol.acompte_cop as ligne_acompte_cop,
      (ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded'))
        as vivante
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
    left join public.establishments e on e.id = p.establishment_id
    where ol.order_id = (p_order).id
  )
  select jsonb_build_object(
    'id', (p_order).id,
    'reference', (p_order).reference,
    'payment_status', (p_order).payment_status,
    'created_at', (p_order).created_at,
    'holder_name', (p_order).holder_name,
    'holder_phone', (p_order).holder_phone,
    'holder_email', (p_order).holder_email,
    'total_cop', coalesce(sum(ligne_total_cop) filter (where vivante), 0),
    'acompte_cop', coalesce(sum(ligne_acompte_cop) filter (where vivante), 0),
    -- Spec 39 D3 (20260922100000) : le client a payé, rien n'est honoré — vrai tant qu'une entrée
    -- refund_required (payé après expiration/annulation, écart de montant ; nuit PMS sans booking,
    -- intent remplacé : migration 20261002185102) est ouverte. Un DOUBLE
    -- paiement n'y entre pas : sa réservation EST honorée, seul le doublon est remboursé.
    'payment_received_not_honored', exists (
      select 1 from public.payment_reconciliation_entries e
      join public.payments pay on pay.id = e.payment_id
      where pay.order_id = (p_order).id and e.kind = 'refund_required'
        and e.reason_code in ('paid_after_expiry', 'amount_mismatch', 'pms_booking_missing', 'superseded_intent')
        and e.status in ('open', 'retrying')
    ),
    -- Le dernier remboursement lié à ces mêmes entrées : pending → « en cours », approved → « te
    -- reembolsamos », rejected → l'admin reprend la main (le client reste sur « te contactamos »).
    'refund_status', (
      select r.status from public.payment_refunds r
      join public.payment_reconciliation_entries e on e.id = r.entry_id
      join public.payments pay on pay.id = e.payment_id
      where pay.order_id = (p_order).id
        and e.reason_code in ('paid_after_expiry', 'amount_mismatch', 'pms_booking_missing', 'superseded_intent')
      -- Par PRIORITÉ, pas par date : approved (l'argent est rendu) prime sur pending, qui prime
      -- sur rejected — plusieurs entrées peuvent viser la même commande.
      order by case r.status when 'approved' then 0 when 'pending' then 1 else 2 end, r.created_at desc
      limit 1
    ),
    -- Ordre INCHANGÉ (20260911100000) : les assertions pgTAP indexent `lines,0`.
    'lines', coalesce(jsonb_agg(ligne order by ligne_created_at, ligne_id), '[]'::jsonb)
  )
  from lignes;
$function$;

CREATE OR REPLACE FUNCTION public.apply_payment_webhook(p_mp_payment_id text, p_external_reference uuid, p_status text, p_raw_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payment record;
  v_order record;
  v_referrer_account record;
  v_owner_account record;
  v_order_summary text;
  v_site_url text;
  -- Ajout 20260920120000 (durcissement) :
  v_order_id uuid;
  v_has_honorable_line boolean;
  v_other_approved_payment_id uuid;
  v_refund_code text;
  v_refund_reason text;
  -- Ajout 20261002185102 :
  v_prior_refund_code text;
  -- Ajout 20261019170000 :
  v_contacts text;
begin
  if p_status not in ('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back') then
    raise exception 'statut de paiement Mercado Pago inconnu : %', p_status;
  end if;

  -- (1) ORDRE DES VERROUS : `orders` d'abord, toujours (cf. en-tête) — lecture non verrouillante de
  -- la commande, verrou sur `orders`, PUIS verrou sur `payments`, dont le statut est relu après.
  select order_id into v_order_id
    from public.payments
   where id = p_external_reference;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  perform 1 from public.orders where id = v_order_id for update;

  select id, order_id, status, mp_payment_id, created_at into v_payment
    from public.payments
   where id = p_external_reference
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  -- Idempotent par construction : un webhook dupliqué ou reçu hors-ordre après approbation est un
  -- no-op — Mercado Pago retente un webhook qui ne renvoie pas 2xx, un no-op DOIT donc renvoyer
  -- ok:true (jamais une erreur), sans quoi le Route Handler entrerait en boucle de retry infinie.
  -- (6) Lot B — `refunded`/`charged_back` (20260921100000). Jusqu'ici le mapper les envoyait sur
  -- `cancelled` : une commande PAYÉE redevenait `unpaid`, lignes toujours `reserved`. Trois cas :
  -- déjà remboursé → no-op ; NOTRE remboursement (payment_refunds vivant, B2) → no-op, jamais une
  -- entrée ; externe (panel MP, contracargo) → entrée `refunded_externally` pour l'admin, et les
  -- statuts ne bougent QUE si ce paiement MP est celui qui a payé la commande. Jamais `unpaid`.
  if p_status in ('refunded', 'charged_back') then
    if v_payment.status in ('refunded', 'charged_back') then
      return jsonb_build_object('ok', true, 'reason', 'already_refunded');
    end if;
    if exists (
      select 1 from public.payment_refunds r
       where r.mp_payment_id = p_mp_payment_id and r.status in ('pending', 'approved')
    ) then
      return jsonb_build_object('ok', true, 'reason', 'own_refund');
    end if;
    insert into public.payment_reconciliation_entries (
      payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code
    )
    values (
      v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event,
      case when p_status = 'charged_back'
           then 'contracargo (charged_back) reçu de Mercado Pago — litige à documenter'
           else 'remboursement effectué hors hifago (panel Mercado Pago)' end,
      'refunded_externally',
      case when p_status = 'charged_back' then 'charged_back' else 'refunded_externally' end
    )
    on conflict (mp_payment_id) where kind = 'refunded_externally' do nothing;

    if v_payment.status = 'approved' and v_payment.mp_payment_id = p_mp_payment_id then
      update public.payments
         set status = p_status, raw_last_event = p_raw_event, updated_at = now()
       where id = v_payment.id;
      update public.orders set payment_status = 'refunded' where id = v_payment.order_id;
    end if;
    return jsonb_build_object('ok', true, 'reason', p_status);
  end if;

  if v_payment.status = 'approved' then
    -- (7) Lot B — double paiement sur le MÊME external_reference : le client a payé deux fois dans
    -- la même session Checkout Pro (m1 puis m2 sous P1). Sans ceci, m2 tombait dans
    -- `already_applied` et l'argent en double restait invisible.
    if p_status = 'approved'
       and v_payment.mp_payment_id is not null
       and v_payment.mp_payment_id <> p_mp_payment_id then
      insert into public.payment_reconciliation_entries (
        payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code
      )
      values (
        v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event,
        'double paiement : ce paiement Mercado Pago double le paiement ' || v_payment.mp_payment_id
          || ' déjà appliqué à la commande',
        'refund_required', 'double_payment'
      )
      on conflict (mp_payment_id) where kind = 'refund_required' do nothing;
      return jsonb_build_object('ok', true, 'reason', 'double_payment');
    end if;
    return jsonb_build_object('ok', true, 'reason', 'already_applied');
  end if;

  -- (5) Un paiement `cancelled` (par le cron d'expiration) ne bouge plus, sauf pour un `approved`
  -- qui est traité par la garde (2) ci-dessous : un `pending` PSE tardif, un `rejected` en retard
  -- ne ressuscitent jamais une commande morte.
  if v_payment.status = 'cancelled' and p_status <> 'approved' then
    return jsonb_build_object('ok', true, 'reason', 'already_cancelled');
  end if;

  -- (2) GARDE « RIEN À HONORER » — cf. en-tête, points (a) (b) (c).
  if p_status = 'approved' then
    -- Migration 20261002185102 — UNE DÉCISION DE REMBOURSEMENT EST DÉFINITIVE par paiement Mercado Pago.
    -- Le job de réconciliation rejoue l'`approved` tant que la commande n'est pas payée, et l'état
    -- qui a fondé le refus peut changer entre-temps (un booking Lobby posé après un refus I2).
    -- Appliquer alors un paiement dont l'admin a déjà la demande de remboursement ferait payer ET
    -- rembourser la même commande.
    select e.reason_code into v_prior_refund_code
      from public.payment_reconciliation_entries e
     where e.mp_payment_id = p_mp_payment_id and e.kind = 'refund_required';
    if found then
      return jsonb_build_object('ok', true, 'reason', v_prior_refund_code);
    end if;

    select exists (
      select 1 from public.order_lines ol
       where ol.order_id = v_payment.order_id
         and ol.status in ('reserved', 'fulfilled', 'no_show')
    ) into v_has_honorable_line;

    select id into v_other_approved_payment_id
      from public.payments
     where order_id = v_payment.order_id
       and status = 'approved'
       and id <> v_payment.id
     limit 1;

    if v_other_approved_payment_id is not null then
      v_refund_code := 'double_payment';
      v_refund_reason := 'double paiement : la commande est déjà payée par le paiement '
        || v_other_approved_payment_id;
    -- Migration 20261002185102 — INTENT REMPLACÉ : create_payment_intent annule le pending quand le
    -- montant de la commande change et en crée un nouveau ; l'ancien onglet Checkout Pro peut encore
    -- payer l'ancien. La commande VIT (une ligne à honorer) et un intent plus récent existe : ce
    -- n'est pas un paiement « après expiration » (texte client faux), c'est un intent remplacé — à
    -- rembourser, comme avant (paid_after_expiry). Un `cancelled` venu de Mercado Pago suivi d'un
    -- nouvel intent tombe aussi ici. Sans intent plus récent : paid_after_expiry, comme avant.
    elsif v_payment.status = 'cancelled' and v_has_honorable_line
                   and exists (
                     select 1 from public.payments newer
                      where newer.order_id = v_payment.order_id and newer.id <> v_payment.id
                        and newer.created_at > v_payment.created_at
                   ) then
      v_refund_code := 'superseded_intent';
      v_refund_reason := 'paiement approuvé sur un intent remplacé par un intent plus récent — '
        || 'rien n''est appliqué, remboursement à traiter';
    elsif v_payment.status = 'cancelled' or not v_has_honorable_line then
      v_refund_code := 'paid_after_expiry';
      v_refund_reason := case
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'expired')
          then 'paiement approuvé après expiration de la commande'
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'cancelled_by_client')
          then 'paiement approuvé après annulation par le client'
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'cancelled_by_provider')
          then 'paiement approuvé après annulation par le prestataire'
        else 'paiement approuvé sans aucune prestation à honorer'
      end;
    -- Migration 20261002185102 — I2 AU WEBHOOK : une nuit PMS-backed `reserved` sans booking Lobby (une
    -- modification admin recrée la ligne sans booking, et une préférence encore vivante la paie).
    -- Échec fermé (CLAUDE.md §4.4) : rien n'est appliqué, l'admin traite le remboursement à la main
    -- (refund_required) — jamais de remboursement automatique. Décision encore ouverte (Jérôme) :
    -- l'alternative « appliquer, puis re-réserver chez Lobby » n'est pas écartée. Même prédicat que
    -- create_payment_intent (isPmsBacked).
    elsif exists (
      select 1
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
       where ol.order_id = v_payment.order_id
         and ol.status = 'reserved'
         and ol.pms_booking_id is null
         and p.type = 'lodging' and p.lobby_category_id is not null
    ) then
      v_refund_code := 'pms_booking_missing';
      v_refund_reason := 'paiement approuvé alors qu''une nuit PMS n''a pas de booking Lobby — '
        || 'rien n''est appliqué, remboursement à traiter';
    end if;

    if v_refund_code is not null then
      -- L'argent est chez Mercado Pago : on garde de quoi le rembourser (identifiant MP, événement
      -- brut), sans jamais toucher au statut du paiement ni à celui de la commande.
      update public.payments
         set mp_payment_id = p_mp_payment_id, raw_last_event = p_raw_event, updated_at = now()
       where id = v_payment.id;

      -- (3) Une seule entrée par paiement Mercado Pago, quel que soit le nombre de livraisons.
      insert into public.payment_reconciliation_entries (
        payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code
      )
      values (
        v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event, v_refund_reason,
        'refund_required', v_refund_code
      )
      on conflict (mp_payment_id) where kind = 'refund_required' do nothing;

      return jsonb_build_object('ok', true, 'reason', v_refund_code);
    end if;
  end if;

  -- Migration 20261002185102 — JAMAIS RÉTROGRADER VERS `pending` un paiement qui ne l'est plus quand un
  -- AUTRE intent de la commande est déjà `pending` (retentative dans l'ancienne session Checkout
  -- Pro après un nouvel intent) : l'index payments_one_pending_per_order le refuserait (23505 →
  -- webhook en échec, retenté sans fin), et ce paiement-là n'est plus celui que le client doit
  -- régler. Décidé sous le verrou de la commande (1), comme dans create_payment_intent : ce sont
  -- les deux seuls écrivains d'un `pending`.
  if p_status = 'pending' and v_payment.status <> 'pending' and exists (
    select 1 from public.payments other
     where other.order_id = v_payment.order_id and other.id <> v_payment.id and other.status = 'pending'
  ) then
    return jsonb_build_object('ok', true, 'reason', 'other_intent_pending');
  end if;

  update public.payments
     set status = p_status, mp_payment_id = p_mp_payment_id, raw_last_event = p_raw_event, updated_at = now()
   where id = v_payment.id;

  if p_status = 'approved' then
    update public.orders set payment_status = 'paid' where id = v_payment.order_id;

    -- (4) Les autres paiements de cette commande n'ont plus lieu d'être : un `rejected` retenté
    -- plus tard chez Mercado Pago tombera dans la garde (2c) au lieu d'être appliqué à son tour.
    update public.payments
       set status = 'cancelled', updated_at = now()
     where order_id = v_payment.order_id
       and id <> v_payment.id
       and status in ('pending', 'rejected');

    -- (a) commission attribuée — un email par compte du/des référent(s) externe(s) distinct(s).
    for v_referrer_account in
      select distinct pa.id as account_id, au.email
        from public.order_lines ol
        join public.partner_accounts pa on pa.partner_id = ol.referrer_partner_id
        join auth.users au on au.id = pa.id
       where ol.order_id = v_payment.order_id and ol.commission_case = 'external_referrer'
    loop
      begin
        perform public.enqueue_notification_email(
          'partner_commission_earned', v_referrer_account.email, v_referrer_account.account_id,
          'Nueva comisión asignada',
          '<p>Se te asignó una comisión por una reserva confirmada.</p>',
          'orders', v_payment.order_id
        );
      exception
        when query_canceled then
          raise warning 'apply_payment_webhook: notification commission annulée (query_canceled) pour compte % — %', v_referrer_account.account_id, sqlerrm;
        when others then
          raise warning 'apply_payment_webhook: échec notification commission pour compte % — %', v_referrer_account.account_id, sqlerrm;
      end;
    end loop;

    -- (b) paiement effectué — un email par compte du/des partenaire(s) propriétaire(s) distinct(s)
    -- des produits commandés (spec 23 §10 point 8 : lecture retenue, à confirmer par Jérôme).
    for v_owner_account in
      select distinct pa.id as account_id, au.email
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        join public.partner_accounts pa on pa.partner_id = p.partner_id
        join auth.users au on au.id = pa.id
       where ol.order_id = v_payment.order_id
    loop
      begin
        perform public.enqueue_notification_email(
          'partner_payment_confirmed', v_owner_account.email, v_owner_account.account_id,
          'Pago confirmado',
          '<p>Se confirmó el pago de una reserva en tu establecimiento.</p>',
          'orders', v_payment.order_id
        );
      exception
        when query_canceled then
          raise warning 'apply_payment_webhook: notification paiement annulée (query_canceled) pour compte % — %', v_owner_account.account_id, sqlerrm;
        when others then
          raise warning 'apply_payment_webhook: échec notification paiement pour compte % — %', v_owner_account.account_id, sqlerrm;
      end;
    end loop;

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
        from public.orders where id = v_payment.order_id;

      select decrypted_secret into v_site_url
        from vault.decrypted_secrets where name = 'web_app_public_url';
      if v_site_url is null then
        raise warning 'apply_payment_webhook: secret Vault web_app_public_url manquant — email de confirmation envoyé SANS lien vers la réserve (commande %)', v_payment.order_id;
      end if;

      -- Migration 20261002160349 : valeurs venues des données échappées (html_text) — nom de
      -- produit, nom du titulaire, référence. Le sujet est du texte brut.
      select string_agg(
        '<li>' || coalesce(public.html_text(p.name ->> 'es'), 'Producto') || ' — ' || ol.date
          || coalesce(' a ' || ol.end_date, '') || ' — $' || ol.total_cop || ' COP</li>',
        ''
      ) into v_order_summary
      from public.order_lines ol join public.products p on p.id = ol.product_id
      where ol.order_id = v_payment.order_id;

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
         where ol.order_id = v_payment.order_id and e.contact_phone is not null
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
        'orders', v_payment.order_id
      );
    exception
      when query_canceled then
        raise warning 'apply_payment_webhook: notification client annulée (query_canceled) pour commande % — %', v_payment.order_id, sqlerrm;
      when others then
        raise warning 'apply_payment_webhook: échec notification client pour commande % — %', v_payment.order_id, sqlerrm;
    end;
  elsif p_status in ('rejected', 'cancelled') then
    -- (5) Jamais rétrograder une commande qu'un AUTRE paiement porte encore (pending) ou a déjà
    -- réglée (approved) — une notification `rejected` en retard sur P1 ne doit pas effacer P2.
    update public.orders
       set payment_status = 'unpaid'
     where id = v_payment.order_id
       and not exists (
         select 1 from public.payments other
          where other.order_id = v_payment.order_id
            and other.id <> v_payment.id
            and other.status in ('pending', 'approved')
       );
  end if;
  -- p_status = 'pending' : orders.payment_status reste 'pending' (déjà posé par create_payment_intent).

  return jsonb_build_object('ok', true);
end;
$function$;
