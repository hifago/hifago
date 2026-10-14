-- « Nuevo socio » (create_partner_direct) : l'invitation part AUSSI par e-mail quand un e-mail est saisi.
--
-- Constaté en recette de prod le 2026-10-13 : la case « Enviar invitación de conexión » créait
-- l'invitation et n'affichait qu'un lien à copier — aucun e-mail, alors que l'écran Invitaciones
-- (create_partner_invitation) en envoie un depuis la spec 23 (20260824040000). La spec 01 §4.6
-- prévoyait le lien transmis à la main (WhatsApp) ; Gabriel a décidé le 2026-10-13 que le lien
-- part aussi par e-mail quand l'admin saisit l'e-mail du socio. Le lien affiché à l'écran reste.
--
-- Mécanisme repris tel quel de create_partner_invitation (20260826100000) : secret Vault
-- admin_app_public_url, enqueue_notification_email('partner_invitation', …), et l'isolation de la
-- spec 23 §8.1 — un e-mail en échec ne fait JAMAIS échouer la création du socio. Le corps n'interpole
-- que l'URL du secret et le jeton généré (même justification de liste blanche que
-- create_partner_invitation, notification_html_escaping.test.sql).
--
-- Seuls changent par rapport à 20260819160000 : l'e-mail porté par l'invitation (colonne
-- partner_invitations.email, comme create_partner_invitation), l'enqueue, et le drapeau
-- invitation_email_enqueued du retour. Signature et droits inchangés.

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
            'Invitación a unirte a Hifago',
            '<p>Has recibido una invitación para unirte a Hifago.</p>'
              || '<p><a href="' || v_app_base_url || '/partner/join?token=' || v_token || '">Aceptar invitación</a></p>'
              || '<p>Este enlace es de un solo uso y expira pronto.</p>',
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
