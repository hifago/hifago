-- Invitation liée à son adresse (arbitrage de Gabriel au nom de Jérôme, 2026-10-14 : option B).
--
-- Une invitation qui porte une adresse (partner_invitations.email, posée par
-- create_partner_invitation et par create_partner_direct quand l'invitation part par e-mail) ne se
-- consomme que par un compte de CETTE adresse. Une invitation sans adresse (lien partagé) est
-- inchangée.
--
-- 1. check_partner_invitation : la réponse positive ajoute `invited_email` (texte, ou null pour un
--    lien partagé) — rendu au seul détenteur du jeton. Corps repris de 20260815260000 (dernière
--    définition) par trois remplacements comptés ; signature et grants inchangés.
-- 2. consume_partner_invitation : `{ok: false, reason: 'email_mismatch'}` si l'adresse du compte
--    connecté diffère de celle de l'invitation (casse et espaces ignorés), AVANT toute écriture —
--    l'invitation reste `pending`. Autorité unique, mot de passe comme Google. Corps repris de
--    20260909200000 (dernière définition) par trois remplacements comptés ; signature inchangée.

-- ============================================================================================
-- 1. check_partner_invitation
-- ============================================================================================
create or replace function public.check_partner_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_invitation record;
begin
  select status, expires_at, email into v_invitation
    from public.partner_invitations
   where token_hash = v_token_hash;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invitation_not_found');
  end if;

  if v_invitation.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_' || v_invitation.status);
  end if;

  if v_invitation.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- Migration 20261014 : l'adresse à laquelle l'invitation a été envoyée (null pour un lien partagé),
  -- rendue au seul détenteur du jeton — le lien est arrivé dans cette boîte. L'écran d'inscription
  -- la propose ; consume_partner_invitation reste l'autorité qui l'exige.
  return jsonb_build_object('ok', true, 'invited_email', nullif(btrim(v_invitation.email), ''));
end;
$$;

-- ============================================================================================
-- 2. consume_partner_invitation
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.consume_partner_invitation(p_token text, p_signer_name text, p_document_version text, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_token_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_invitation record;
  v_existing_partner_id uuid;
  v_partner_id uuid;
  v_roles text[];
  v_role text;
  v_full_name text := nullif(btrim(coalesce(p_signer_name, '')), '');
  v_account_email text;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- 2026-09-09 — PREMIÈRE APPLICATION DE LA LISTE BLANCHE (décision Jérôme du même jour : une RPC
  -- refuse un visiteur anonyme SAUF si elle l'autorise nommément ; échec fermé, CLAUDE.md §4.4).
  --
  -- Devenir partenaire est l'exemple type de ce qu'une identité jetable ne doit pas pouvoir faire.
  -- Reproduit en réel avant correctif, sous une session anonyme (is_anonymous vrai, aucun email)
  -- détenant un lien d'invitation : retour {"ok": true, "roles": ["referrer"]}, capacité `referrer`
  -- ACTIVE, et surtout des `role_agreements` avec explicit_consent = true signés par un compte non
  -- ré-identifiable — un consentement contractuel sans personne derrière. La garde d'origine était
  -- `auth.uid() is null` en entier : elle disait « quelqu'un est connecté », ce qui cessera de
  -- vouloir dire « quelqu'un existe » le jour où les sessions anonymes s'ouvriront.
  --
  -- Placée APRÈS not_authenticated et AVANT toute lecture de l'invitation, volontairement : un
  -- anonyme ne doit pas non plus apprendre si un jeton est valide (le refus serait sinon un oracle).
  if (select public.is_anonymous_session()) then
    return jsonb_build_object('ok', false, 'reason', 'anonymous_not_allowed');
  end if;

  select id, promo_code, onboarding_path, status, expires_at, partner_hint, partner_id, email
    into v_invitation
    from public.partner_invitations
   where token_hash = v_token_hash
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invitation_not_found');
  end if;

  if v_invitation.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_' || v_invitation.status);
  end if;

  if v_invitation.expires_at < now() then
    update public.partner_invitations set status = 'expired' where id = v_invitation.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- Migration 20261014 (option B, arbitrage du 2026-10-14) : une invitation ENVOYÉE à une adresse ne
  -- se consomme que par un compte de cette adresse (casse et espaces ignorés), quel que soit le mode
  -- de connexion (mot de passe ou Google) — c'est ici, et nulle part ailleurs, que la règle tient.
  -- Avant toute écriture : l'invitation reste `pending` pour le bon destinataire. Un lien partagé
  -- (sans adresse) est inchangé. Un compte sans adresse ne correspond à aucune.
  if nullif(btrim(v_invitation.email), '') is not null then
    select email into v_account_email from auth.users where id = v_account_id;
    if lower(btrim(v_account_email)) is distinct from lower(btrim(v_invitation.email)) then
      return jsonb_build_object('ok', false, 'reason', 'email_mismatch');
    end if;
  end if;

  select partner_id into v_existing_partner_id
    from public.partner_accounts
   where id = v_account_id;

  if v_existing_partner_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'account_already_has_partner');
  end if;

  if v_invitation.partner_id is not null then
    v_partner_id := v_invitation.partner_id;
  else
    insert into public.partners (display_name, partner_city)
    values (
      coalesce(v_invitation.partner_hint->>'display_name', p_signer_name),
      v_invitation.partner_hint->>'partner_city'
    )
    returning id into v_partner_id;
  end if;

  -- full_name : seulement si pas déjà renseigné (ex. via "Mi cuenta" avant cette invitation) —
  -- jamais écraser silencieusement une valeur que le compte a lui-même choisie, même invraisemblable
  -- dans ce parcours (même invariant que update_my_account_profile).
  update public.partner_accounts
     set partner_id = v_partner_id,
         full_name = coalesce(partner_accounts.full_name, v_full_name)
   where id = v_account_id;

  update public.partner_codes
     set partner_id = v_partner_id
   where code = v_invitation.promo_code;

  if v_invitation.partner_id is null then
    v_roles := case v_invitation.onboarding_path
      when 'provider' then array['referrer', 'operator']
      else array['referrer']
    end;

    foreach v_role in array v_roles loop
      insert into public.partner_capabilities (partner_id, role, source)
      values (
        v_partner_id,
        v_role,
        case v_invitation.onboarding_path when 'provider' then 'newp' else 'newr' end
      );

      insert into public.role_agreements (
        partner_id, account_id, role, document_version, signer_name, explicit_consent, ip, user_agent
      )
      values (
        v_partner_id, v_account_id, v_role, p_document_version, p_signer_name, true, p_ip, p_user_agent
      );
    end loop;
  else
    v_roles := array(select role from public.partner_capabilities where partner_id = v_partner_id);
    foreach v_role in array v_roles loop
      insert into public.role_agreements (
        partner_id, account_id, role, document_version, signer_name, explicit_consent, ip, user_agent
      )
      values (
        v_partner_id, v_account_id, v_role, p_document_version, p_signer_name, true, p_ip, p_user_agent
      );
    end loop;
  end if;

  update public.partner_invitations
     set status = 'consumed',
         consumed_at = now(),
         consumed_by_account_id = v_account_id
   where id = v_invitation.id;

  return jsonb_build_object('ok', true, 'partner_id', v_partner_id, 'roles', v_roles);
end;
$function$;
