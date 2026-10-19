-- E-mail d'invitation du socio (« premier lien de connexion ») : un vrai e-mail de bienvenue.
--
-- Demande Jérôme (2026-10-19), texte validé sur maquette : l'ancien corps (« Has recibido una
-- invitación… » + « Aceptar invitación » + « expira pronto ») ne disait ni ce qu'est le lien, ni ce
-- que le socio trouvera derrière. Le nouveau, court et en espagnol comme tout l'espace socio :
--   - « Hola <nom>, » — nom de la fiche socio (create_partner_direct) ou du partner_hint
--     (create_partner_invitation, rarement rempli) ; sans nom, « Hola, » ;
--   - bienvenue + à quoi sert le lien (créer son compte : une contraseña et on entre) ;
--   - ce que l'espace permet, selon le parcours de l'invitation — les puces reprennent les entrées
--     réelles du menu socio (apps/admin/app/partner/(app)/nav-items.ts) : provider = établissement
--     et services, disponibilité et réservations, lien/QR et commissions ; referrer = lien/QR et
--     commissions (vue référent restreinte, spec 22) ;
--   - bouton « Crear mi cuenta » ;
--   - durée réelle de l'invitation au lieu de « expira pronto », et rappel d'utiliser la même
--     adresse (consume refuse une autre adresse : reason email_mismatch).
-- Sujet : « Te damos la bienvenida a Hifago » (neutre en genre, comme le toast de JoinForm).
--
-- Le corps est construit par UNE fonction, partner_invitation_email_html, appelée par les deux RPC
-- (elles portaient jusqu'ici deux copies du même littéral). Elle échappe le nom par html_text
-- (spec 23, notification_html_escaping.test.sql) — d'où SECURITY DEFINER (méta-test X3 : html_text
-- est révoquée pour anon/authenticated) et révoquée elle aussi : seules les deux RPC l'appellent.
--
-- Les deux CREATE OR REPLACE partent du corps LIVE (pg_get_functiondef, identique aux fichiers
-- 20260826100000 et 20261014024303 au 2026-10-19) : seuls changent le sujet et le corps de l'e-mail.
-- Signatures, droits, isolation de l'enqueue (spec 23 §8.1) et valeurs de retour inchangés.

create function public.partner_invitation_email_html(
  p_join_url text,
  p_onboarding_path text,
  p_display_name text,
  p_expires_days int
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select
    '<div style="max-width:520px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1d2633">'
    || '<div style="background:#132f61;color:#ffffff;padding:18px 24px;font-weight:bold;font-size:18px;letter-spacing:2px">HIFAGO</div>'
    || '<div style="padding:24px 24px 8px">'
    || '<p>Hola' || coalesce(' ' || public.html_text(nullif(btrim(p_display_name), '')), '') || ',</p>'
    || '<p>Te damos la bienvenida a Hifago. Con este enlace creas tu cuenta de socio: solo eliges una contraseña y entras directamente a tu espacio.</p>'
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
    || '<p style="margin:24px 0"><a href="' || p_join_url || '" style="display:inline-block;background:#ddae0c;color:#132f61;font-weight:bold;text-decoration:none;padding:12px 26px;border-radius:6px">Crear mi cuenta</a></p>'
    || '<p style="font-size:13px;color:#5b6675">Este enlace es personal, se usa una sola vez y '
    || case
         when p_expires_days is null then 'vence pronto'
         when p_expires_days = 1 then 'vence en 1 día'
         else 'vence en ' || p_expires_days || ' días'
       end
    || '. Regístrate con esta misma dirección de correo.</p>'
    || '</div></div>'
$$;

comment on function public.partner_invitation_email_html(text, text, text, int) is
  'Corps HTML de l''e-mail partner_invitation (bienvenue socio). Nom échappé par html_text ; le lien est construit par l''appelant depuis le secret Vault et le jeton généré.';

revoke all on function public.partner_invitation_email_html(text, text, text, int) from public, anon, authenticated;

create or replace function public.create_partner_invitation(
  p_code text,
  p_onboarding_path text,
  p_partner_hint jsonb default null,
  p_expires_days int default 7,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_token_hash text;
  v_invitation_id uuid;
  v_email text;
  v_app_base_url text;
  v_existing_code_partner uuid;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_partner_invitation réservé au rôle admin' using errcode = '42501';
  end if;
  if p_onboarding_path not in ('referrer', 'provider') then
    raise exception 'onboarding_path invalide : %', p_onboarding_path;
  end if;

  -- Verrouille la ligne du code (si elle existe) le temps de la vérification + de l'écriture —
  -- évite qu'un second appel concurrent sur le même code passe entre la lecture et l'écriture.
  select partner_id into v_existing_code_partner
    from public.partner_codes where code = p_code for update;

  if found and v_existing_code_partner is not null then
    raise exception 'Ese código ya está asignado a otro socio' using errcode = '23505';
  end if;

  insert into public.partner_codes (code) values (p_code) on conflict (code) do nothing;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_email := nullif(btrim(p_email), '');

  insert into public.partner_invitations (
    token_hash, promo_code, onboarding_path, partner_hint, expires_at, created_by, email
  ) values (
    v_token_hash, p_code, p_onboarding_path, p_partner_hint,
    now() + (p_expires_days || ' days')::interval, auth.uid(), v_email
  )
  returning id into v_invitation_id;

  perform public.log_admin_action(
    'partner_invitation.create', 'partner_invitations', v_invitation_id,
    null, jsonb_build_object('code', p_code, 'onboarding_path', p_onboarding_path), null
  );

  -- Isolation (spec 23 §8.1) : un email cassé ne doit jamais faire échouer la création de
  -- l'invitation elle-même — le jeton reste utilisable via le lien affiché à l'écran même si
  -- l'enqueue échoue. when others seul ne suffit pas (query_canceled en est exclu par construction).
  if v_email is not null then
    begin
      -- Base URL publique de apps/admin, seedée par environnement (jamais une valeur en dur, elle
      -- diffère local/preprod/prod) — même mécanisme Vault que pms_functions_base_url
      -- (20260819140000_pms_jobs_cron.sql), secret distinct car sémantiquement différent (URL
      -- publique cliquable par un humain, pas un endpoint Edge Function interne).
      select decrypted_secret into v_app_base_url
        from vault.decrypted_secrets where name = 'admin_app_public_url';
      if v_app_base_url is null then
        raise warning 'create_partner_invitation: secret Vault admin_app_public_url manquant — email non enqueue (lien affiché à l''écran reste la seule voie)';
      else
        perform public.enqueue_notification_email(
          'partner_invitation',
          v_email,
          null,
          'Te damos la bienvenida a Hifago',
          public.partner_invitation_email_html(
            v_app_base_url || '/partner/join?token=' || v_token,
            p_onboarding_path,
            p_partner_hint->>'display_name',
            p_expires_days
          ),
          'partner_invitations',
          v_invitation_id
        );
      end if;
    exception
      when query_canceled then
        raise warning 'create_partner_invitation: enqueue annulé (query_canceled) pour % — %', v_invitation_id, sqlerrm;
      when others then
        raise warning 'create_partner_invitation: échec enqueue pour % — %', v_invitation_id, sqlerrm;
    end;
  end if;

  return jsonb_build_object('ok', true, 'invitation_id', v_invitation_id, 'token', v_token);
end;
$$;

create or replace function public.create_partner_direct(
  p_display_name text,
  p_roles text[],
  p_legal_name text default null,
  p_identification_type text default null,
  p_identification_number text default null,
  p_partner_city text default null,
  p_email text default null,
  p_phone text default null,
  p_establishment_id uuid default null,
  p_code text default null,
  p_commission_enabled boolean default true,
  p_crm_profile jsonb default null,
  p_send_invitation boolean default true,
  p_invitation_expires_days int default 14
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner_id uuid;
  v_roles text[] := p_roles;
  v_role text;
  v_capability_ids uuid[] := '{}';
  v_capability_id uuid;
  v_existing_code_partner uuid;
  v_token text;
  v_token_hash text;
  v_invitation_id uuid;
  v_onboarding_path text;
  v_email text := nullif(btrim(p_email), '');
  v_app_base_url text;
  v_email_enqueued boolean := false;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'create_partner_direct réservé au rôle admin' using errcode = '42501';
  end if;
  if v_roles is null or array_length(v_roles, 1) is null then
    raise exception 'au moins un rôle (referrer ou operator) est requis';
  end if;
  if exists (select 1 from unnest(v_roles) r where r not in ('referrer', 'operator')) then
    raise exception 'rôle invalide dans p_roles (seuls referrer/operator sont autorisés ici)';
  end if;
  if 'operator' = any(v_roles) and not ('referrer' = any(v_roles)) then
    v_roles := array_prepend('referrer', v_roles);
  end if;
  if p_send_invitation and p_code is null then
    raise exception 'un code d''attribution (p_code) est requis pour envoyer une invitation';
  end if;

  insert into public.partners (
    display_name, legal_name, identification_type, identification_number,
    partner_city, email, phone
  ) values (
    p_display_name, p_legal_name, p_identification_type, p_identification_number,
    p_partner_city, p_email, p_phone
  )
  returning id into v_partner_id;

  foreach v_role in array v_roles loop
    insert into public.partner_capabilities (
      partner_id, establishment_id, role, source
    ) values (
      v_partner_id,
      case when v_role = 'operator' then p_establishment_id else null end,
      v_role,
      'admin'
    )
    returning id into v_capability_id;
    v_capability_ids := array_append(v_capability_ids, v_capability_id);
  end loop;

  if p_code is not null then
    select partner_id into v_existing_code_partner from public.partner_codes where code = p_code for update;
    if not found then
      insert into public.partner_codes (code, partner_id, commission_enabled)
      values (p_code, v_partner_id, coalesce(p_commission_enabled, true));
    elsif v_existing_code_partner is null then
      update public.partner_codes
         set partner_id = v_partner_id, commission_enabled = coalesce(p_commission_enabled, true), updated_at = now()
       where code = p_code;
    else
      raise exception 'code déjà attribué à un autre partenaire' using errcode = '23505';
    end if;
  end if;

  if p_crm_profile is not null then
    insert into public.partner_crm_profile (
      partner_id, bank, address, barrio, tags, commercial_status, notes, lat, lon
    ) values (
      v_partner_id,
      p_crm_profile->'bank',
      p_crm_profile->>'address',
      p_crm_profile->>'barrio',
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(p_crm_profile->'tags')),
        '{}'
      ),
      coalesce(p_crm_profile->>'commercial_status', 'prospecto'),
      p_crm_profile->>'notes',
      nullif(p_crm_profile->>'lat', '')::double precision,
      nullif(p_crm_profile->>'lon', '')::double precision
    );
  end if;

  if p_send_invitation then
    v_onboarding_path := case when 'operator' = any(v_roles) then 'provider' else 'referrer' end;
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

    insert into public.partner_invitations (
      token_hash, promo_code, onboarding_path, partner_hint, expires_at, created_by, partner_id, email
    ) values (
      v_token_hash, p_code, v_onboarding_path,
      jsonb_build_object('display_name', p_display_name, 'partner_city', p_partner_city),
      now() + (p_invitation_expires_days || ' days')::interval, auth.uid(), v_partner_id, v_email
    )
    returning id into v_invitation_id;

    -- Isolation (spec 23 §8.1), comme create_partner_invitation : le socio et son invitation sont
    -- créés même si l'e-mail ne peut pas partir — le lien affiché à l'écran reste utilisable.
    if v_email is not null then
      begin
        select decrypted_secret into v_app_base_url
          from vault.decrypted_secrets where name = 'admin_app_public_url';
        if v_app_base_url is null then
          raise warning 'create_partner_direct: secret Vault admin_app_public_url manquant — email non enqueue (lien affiché à l''écran reste la seule voie)';
        else
          perform public.enqueue_notification_email(
            'partner_invitation',
            v_email,
            null,
            'Te damos la bienvenida a Hifago',
            public.partner_invitation_email_html(
              v_app_base_url || '/partner/join?token=' || v_token,
              v_onboarding_path,
              p_display_name,
              p_invitation_expires_days
            ),
            'partner_invitations',
            v_invitation_id
          );
          v_email_enqueued := true;
        end if;
      exception
        when query_canceled then
          raise warning 'create_partner_direct: enqueue annulé (query_canceled) pour % — %', v_invitation_id, sqlerrm;
        when others then
          raise warning 'create_partner_direct: échec enqueue pour % — %', v_invitation_id, sqlerrm;
      end;
    end if;
  end if;

  perform public.log_admin_action(
    'partner.create_direct', 'partners', v_partner_id, null,
    jsonb_build_object('display_name', p_display_name, 'roles', v_roles, 'code', p_code, 'invitation_id', v_invitation_id),
    null
  );

  return jsonb_build_object(
    'ok', true,
    'partner_id', v_partner_id,
    'capability_ids', v_capability_ids,
    'roles', v_roles,
    'code', p_code,
    'invitation_id', v_invitation_id,
    'invitation_token', v_token,
    'invitation_email_enqueued', v_email_enqueued
  );
end;
$$;
