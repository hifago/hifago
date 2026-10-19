-- Fiche admin d'un socio : identité, contact et profil commercial deviennent modifiables (demande
-- Jérôme du 2026-10-19 — « tous les champs doivent être changeables, par moi, par admin »).
--
-- Jusqu'ici, seule la création (create_partner_direct) écrivait ces champs ; la fiche les relisait
-- en lecture seule (PartnerIdentitySection, « la modification attend une RPC d'écriture auditée »).
-- Seuls le nom (admin_rename_partner, liste) et l'adresse (set_partner_location) avaient un chemin.
--
-- 1. Trois colonnes neuves sur `partners` — instagram, facebook, website (choix Jérôme du
--    2026-10-19 : trois champs séparés plutôt qu'une liste libre). Texte libre (un @ ou un lien),
--    jamais publiées : `partners` n'a aucune lecture publique (partners_select = propre
--    organisation + admin), et le grant de TABLE `authenticated` (20260813163456) couvre déjà
--    toute colonne neuve.
--
-- 2. admin_update_partner_profile — UNE RPC, et pas l'update direct que la RLS autorise déjà
--    (partners_update) : la fiche enregistre en une fois des champs de DEUX tables, dont
--    partner_crm_profile qui est RPC-only en écriture (20260814233000). Un seul aller-retour
--    atomique — tout passe ou rien — et une ligne d'audit_log nominative (même raison que
--    admin_rename_partner, 20261013145629).
--
-- Frontière RLS / RPC-only (CLAUDE.md §3) : aucune policy, aucun grant de table ne change.
-- PAS une RPC critique (§4.1) : aucune table de capacité n'est lue ni écrite.
--
-- Le moyen de paiement (`bank`) ne fait jamais l'aller-retour : la fiche n'en reçoit que le
-- résumé (resumenMetodoPago, suffixe seul), donc la clé `bank` REMPLACE l'objet entier ou l'efface
-- (null) — jamais une fusion avec un numéro que l'écran n'a pas vu. L'audit n'en garde que le fait
-- (« [oculto] »), jamais le numéro : audit_log n'a pas à devenir une seconde copie des comptes.
--
-- Refus métier rendus dans `reason` (jamais levés), comme admin_update_product_inline ; une clé
-- inconnue ou un type JSON faux est une erreur d'appelant et lève. Toute validation précède la
-- première écriture : un `ok:false` ne laisse rien derrière lui.
-- Prouvé par supabase/tests/database/admin_update_partner_profile.test.sql.

alter table public.partners
  add column instagram text,
  add column facebook text,
  add column website text;

comment on column public.partners.instagram is
  'Instagram du socio (@ ou lien), saisi par l''admin. Jamais publié.';
comment on column public.partners.facebook is
  'Facebook du socio (lien ou nom de page), saisi par l''admin. Jamais publié.';
comment on column public.partners.website is
  'Site web du socio, saisi par l''admin. Jamais publié (le contact public est sur establishments).';

create function public.admin_update_partner_profile(
  p_partner_id uuid,
  p_changes jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_partner_keys constant text[] := array[
    'display_name', 'legal_name', 'identification_type', 'identification_number', 'partner_city',
    'email', 'phone', 'instagram', 'facebook', 'website'
  ];
  c_crm_text_keys constant text[] := array['barrio', 'notes'];
  v_key text;
  v_value jsonb;
  v_text text;
  v_max_length int;
  v_current jsonb;
  v_current_crm jsonb;
  v_new jsonb := '{}'::jsonb;
  v_new_crm jsonb := '{}'::jsonb;
  v_tags text[];
  v_bank jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_update_partner_profile réservé au rôle admin' using errcode = '42501';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'p_changes doit être un objet jsonb';
  end if;

  -- `for no key update` : protège contre un autre admin sans bloquer les insertions filles
  -- (capacités, codes) qui prennent un verrou de clé sur cette ligne.
  select to_jsonb(p) into v_current
    from public.partners p
   where p.id = p_partner_id
     for no key update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select to_jsonb(c) into v_current_crm
    from public.partner_crm_profile c
   where c.partner_id = p_partner_id
     for no key update;
  v_current_crm := coalesce(v_current_crm, '{}'::jsonb);

  -- ---------- Validation (aucune écriture avant la fin de cette boucle) ------------------------
  for v_key, v_value in select * from jsonb_each(p_changes) loop
    if v_key = any(c_partner_keys) or v_key = any(c_crm_text_keys) then
      if jsonb_typeof(v_value) not in ('string', 'null') then
        raise exception '% doit être une chaîne ou null', v_key;
      end if;
      -- Chaîne vide = champ effacé (null), jamais une chaîne vide stockée.
      v_text := nullif(btrim(v_value #>> '{}'), '');

      if v_key = 'display_name' and v_text is null then
        return jsonb_build_object('ok', false, 'reason', 'invalid_name');
      end if;
      v_max_length := 300;
      if v_key = 'notes' then
        v_max_length := 5000;
      end if;
      if v_text is not null and char_length(v_text) > v_max_length then
        return jsonb_build_object('ok', false, 'reason', 'too_long', 'field', v_key);
      end if;
      if v_key = 'email' and v_text is not null and v_text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_email');
      end if;

      if v_key = any(c_partner_keys) then
        v_new := v_new || jsonb_build_object(v_key, v_text);
      else
        v_new_crm := v_new_crm || jsonb_build_object(v_key, v_text);
      end if;

    elsif v_key = 'commercial_status' then
      if jsonb_typeof(v_value) <> 'string'
         or (v_value #>> '{}') not in ('prospecto', 'activo', 'inactivo', 'pausa') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_commercial_status');
      end if;
      v_new_crm := v_new_crm || jsonb_build_object(v_key, v_value #>> '{}');

    elsif v_key = 'tags' then
      if jsonb_typeof(v_value) <> 'array' then
        raise exception 'tags doit être un tableau';
      end if;
      -- Nettoyées, dédoublonnées dans l'ordre de saisie ; un élément non textuel lève.
      select coalesce(array_agg(t.tag order by t.first_pos), '{}'::text[]) into v_tags
        from (
          select btrim(e.value #>> '{}') as tag, min(e.pos) as first_pos
            from jsonb_array_elements(v_value) with ordinality as e(value, pos)
           where btrim(e.value #>> '{}') <> ''
           group by btrim(e.value #>> '{}')
        ) t;
      if exists (select 1 from jsonb_array_elements(v_value) e where jsonb_typeof(e) <> 'string') then
        raise exception 'tags doit être un tableau de chaînes';
      end if;
      if exists (select 1 from unnest(v_tags) t where char_length(t) > 50)
         or cardinality(v_tags) > 30 then
        return jsonb_build_object('ok', false, 'reason', 'too_long', 'field', 'tags');
      end if;
      v_new_crm := v_new_crm || jsonb_build_object('tags', to_jsonb(v_tags));

    elsif v_key = 'bank' then
      if jsonb_typeof(v_value) = 'null' then
        v_bank := null;
      elsif jsonb_typeof(v_value) = 'object' then
        -- Même forme que create_partner_direct / NewPartnerForm : nombre + un seul moyen.
        if exists (select 1 from jsonb_object_keys(v_value) k
                    where k not in ('nombre', 'bancolombia', 'nequi', 'received_at')) then
          raise exception 'bank : clé non autorisée';
        end if;
        if (v_value ? 'bancolombia') and (v_value ? 'nequi') then
          return jsonb_build_object('ok', false, 'reason', 'invalid_bank');
        end if;
        v_bank := (v_value - 'received_at') || jsonb_build_object('received_at', now());
      else
        raise exception 'bank doit être un objet ou null';
      end if;
      v_new_crm := v_new_crm || jsonb_build_object('bank', v_bank);

    else
      raise exception 'clé non autorisée : %', v_key;
    end if;
  end loop;

  -- ---------- Ne garder que ce qui change, pour l'écriture comme pour l'audit -----------------
  for v_key, v_value in select * from jsonb_each(v_new) loop
    if v_value is distinct from coalesce(v_current -> v_key, 'null'::jsonb) then
      v_before := v_before || jsonb_build_object(v_key, v_current -> v_key);
      v_after := v_after || jsonb_build_object(v_key, v_value);
    else
      v_new := v_new - v_key;
    end if;
  end loop;

  for v_key, v_value in select * from jsonb_each(v_new_crm) loop
    if v_value is distinct from coalesce(v_current_crm -> v_key, 'null'::jsonb) then
      if v_key = 'bank' then
        v_before := v_before || jsonb_build_object('bank',
          case when v_current_crm -> 'bank' is null or v_current_crm -> 'bank' = 'null'::jsonb
               then null else '[oculto]' end);
        v_after := v_after || jsonb_build_object('bank',
          case when v_value = 'null'::jsonb then null else '[oculto]' end);
      else
        v_before := v_before || jsonb_build_object(v_key, v_current_crm -> v_key);
        v_after := v_after || jsonb_build_object(v_key, v_value);
      end if;
    else
      v_new_crm := v_new_crm - v_key;
    end if;
  end loop;

  if v_after = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  -- ---------- Écritures ------------------------------------------------------------------------
  if v_new <> '{}'::jsonb then
    update public.partners p
       set display_name = case when v_new ? 'display_name' then v_new ->> 'display_name' else p.display_name end,
           legal_name = case when v_new ? 'legal_name' then v_new ->> 'legal_name' else p.legal_name end,
           identification_type = case when v_new ? 'identification_type' then v_new ->> 'identification_type' else p.identification_type end,
           identification_number = case when v_new ? 'identification_number' then v_new ->> 'identification_number' else p.identification_number end,
           partner_city = case when v_new ? 'partner_city' then v_new ->> 'partner_city' else p.partner_city end,
           email = case when v_new ? 'email' then v_new ->> 'email' else p.email end,
           phone = case when v_new ? 'phone' then v_new ->> 'phone' else p.phone end,
           instagram = case when v_new ? 'instagram' then v_new ->> 'instagram' else p.instagram end,
           facebook = case when v_new ? 'facebook' then v_new ->> 'facebook' else p.facebook end,
           website = case when v_new ? 'website' then v_new ->> 'website' else p.website end,
           updated_at = now()
     where p.id = p_partner_id;
  end if;

  if v_new_crm <> '{}'::jsonb then
    -- La plupart des socios n'ont encore aucune ligne de profil (jamais géocodés) : on la crée.
    insert into public.partner_crm_profile (partner_id) values (p_partner_id)
    on conflict (partner_id) do nothing;

    update public.partner_crm_profile c
       set barrio = case when v_new_crm ? 'barrio' then v_new_crm ->> 'barrio' else c.barrio end,
           notes = case when v_new_crm ? 'notes' then v_new_crm ->> 'notes' else c.notes end,
           commercial_status = case when v_new_crm ? 'commercial_status' then v_new_crm ->> 'commercial_status' else c.commercial_status end,
           tags = case when v_new_crm ? 'tags'
                       then array(select jsonb_array_elements_text(v_new_crm -> 'tags'))
                       else c.tags end,
           bank = case when v_new_crm ? 'bank' then nullif(v_new_crm -> 'bank', 'null'::jsonb) else c.bank end,
           updated_at = now()
     where c.partner_id = p_partner_id;
  end if;

  perform public.log_admin_action(
    'partner.update_profile', 'partners', p_partner_id, v_before, v_after, p_note
  );

  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

revoke all on function public.admin_update_partner_profile(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_update_partner_profile(uuid, jsonb, text) to authenticated;
