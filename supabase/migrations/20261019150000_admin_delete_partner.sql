-- Suppression définitive d'un partenaire (demande Jérôme, 2026-10-19) : « quand je supprime, c'est
-- comme si ça n'avait jamais existé » — l'adresse e-mail et le code redeviennent libres pour une
-- nouvelle invitation. L'offboarding (20260814160000) reste le chemin de tout partenaire qui a déjà
-- vendu : il ne supprime rien, par construction.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- QUAND C'EST PERMIS — partner_deletion_blocker, une seule source pour l'écran et la RPC
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Même invariant que delete_product (20260815220000) : « une fiche déjà commandée ne se supprime
-- jamais ». Une commande est rattachée à un partenaire par CINQ chemins, tous vérifiés :
-- orders.referrer_partner_id, orders.attribution_code (ses codes), orders.account_id (ses comptes,
-- s'ils ont réservé comme clients), order_lines (ses activités, celles de ses établissements, son
-- rôle de référent, ses comptes) et ledger_entries. N'importe quel statut compte, une ligne annulée
-- comprise : elle prouve qu'une commande a existé.
-- Deux autres refus : le partenaire plateforme (propriétaire d'un lieu `is_place`, 20261013195100 —
-- « Hifago » doit exister dans toute base), et un compte rattaché qui est admin ou qui a déjà agi
-- comme admin (audit_log.actor_id le retiendrait, et supprimer un admin n'est pas ce geste-là).
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE FAIT PAS ELLE-MÊME
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Les comptes de connexion (auth.users) : jamais en SQL — l'API Admin Supabase depuis le Route
-- Handler (même règle que delete_my_account, 20260911140000 : le schéma `auth` appartient à
-- supabase_auth_admin). Elle DÉTACHE donc ses comptes (partner_id = null) et rend leurs ids ; le
-- Route Handler les supprime ensuite, ce qui emporte partner_accounts par cascade. Si l'API échoue,
-- il reste un compte sans partenaire ni capacité — il ne donne accès à rien, mais garde l'adresse :
-- la route le dit à l'écran, jamais en silence.
-- Les fichiers Storage : même raison, elle rend les chemins que plus aucune fiche ne référence.
-- audit_log : JAMAIS touché (décision du 2026-10-19 : la trace de qui a fait quoi reste, c'est la
-- seule preuve). Une ligne `partner.delete` s'y ajoute, sans e-mail ni donnée de contact.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- CONCURRENCE
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Pas une opération critique au sens de CLAUDE.md §4.1 (aucun compteur, aucune réservation), donc
-- pas de squelette anti-survente. Une commande créée pendant la suppression : order_lines.product_id
-- n'a pas de cascade, le `delete from products` lève alors foreign_key_violation et TOUT est annulé
-- — échec fermé, jamais une commande orpheline. Le `for update` sur partners sérialise deux
-- suppressions du même partenaire.

-- 1. Le motif du refus, ou null. Interne : appelée seulement par les deux fonctions ci-dessous
-- (security definer, exécutées en tant que propriétaire) — EXECUTE retiré à tout rôle d'API.
create or replace function public.partner_deletion_blocker(p_partner_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_accounts uuid[];
  v_establishments uuid[];
  v_products uuid[];
  v_codes text[];
begin
  if not exists (select 1 from public.partners where id = p_partner_id) then
    return 'not_found';
  end if;

  if exists (
    select 1 from public.establishments
     where partner_id = p_partner_id and is_place
  ) then
    return 'platform_partner';
  end if;

  select coalesce(array_agg(id), '{}') into v_accounts
    from public.partner_accounts where partner_id = p_partner_id;
  select coalesce(array_agg(id), '{}') into v_establishments
    from public.establishments where partner_id = p_partner_id;
  select coalesce(array_agg(id), '{}') into v_products
    from public.products
   where partner_id = p_partner_id or establishment_id = any(v_establishments);
  select coalesce(array_agg(code), '{}') into v_codes
    from public.partner_codes where partner_id = p_partner_id;

  if exists (
       select 1 from public.orders
        where referrer_partner_id = p_partner_id
           or account_id = any(v_accounts)
           or attribution_code = any(v_codes)
     )
     or exists (
       select 1 from public.order_lines
        where referrer_partner_id = p_partner_id
           or account_id = any(v_accounts)
           or product_id = any(v_products)
     )
     or exists (
       select 1 from public.ledger_entries
        where referrer_partner_id = p_partner_id
           or establishment_id = any(v_establishments)
     )
  then
    return 'has_orders';
  end if;

  if exists (
       select 1 from public.partner_capabilities
        where account_id = any(v_accounts) and role = 'admin'
     )
     or exists (select 1 from public.audit_log where actor_id = any(v_accounts))
  then
    return 'admin_account';
  end if;

  return null;
end;
$$;

revoke all on function public.partner_deletion_blocker(uuid) from public, anon, authenticated;

-- 2. Lecture pour la fiche admin : le bouton n'apparaît que si `deletable`.
create or replace function public.admin_partner_deletion_check(p_partner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_partner_deletion_check réservé au rôle admin' using errcode = '42501';
  end if;

  v_reason := public.partner_deletion_blocker(p_partner_id);
  return jsonb_build_object('deletable', v_reason is null, 'reason', v_reason);
end;
$$;

revoke all on function public.admin_partner_deletion_check(uuid) from public, anon, authenticated;
grant execute on function public.admin_partner_deletion_check(uuid) to authenticated;

-- 3. La suppression. Rend { ok, account_ids, storage_paths } ou { ok: false, reason } — un refus
-- n'est pas une exception : l'écran affiche le motif.
create or replace function public.admin_delete_partner(p_partner_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_reason text;
  v_accounts uuid[];
  v_establishments uuid[];
  v_products uuid[];
  v_codes text[];
  v_invitations uuid[];
  v_media_paths text[];
  v_orphan_paths text[];
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_delete_partner réservé au rôle admin' using errcode = '42501';
  end if;

  select display_name into v_display_name
    from public.partners where id = p_partner_id
   for update;

  v_reason := public.partner_deletion_blocker(p_partner_id);
  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  select coalesce(array_agg(id), '{}') into v_accounts
    from public.partner_accounts where partner_id = p_partner_id;
  select coalesce(array_agg(id), '{}') into v_establishments
    from public.establishments where partner_id = p_partner_id;
  select coalesce(array_agg(id), '{}') into v_products
    from public.products
   where partner_id = p_partner_id or establishment_id = any(v_establishments);
  select coalesce(array_agg(code), '{}') into v_codes
    from public.partner_codes where partner_id = p_partner_id;
  select coalesce(array_agg(id), '{}') into v_invitations
    from public.partner_invitations
   where partner_id = p_partner_id
      or consumed_by_account_id = any(v_accounts)
      or promo_code = any(v_codes);

  -- Relevés AVANT les cascades qui les emportent.
  select coalesce(array_agg(distinct storage_path), '{}') into v_media_paths
    from (
      select storage_path from public.establishment_media where establishment_id = any(v_establishments)
      union all
      select storage_path from public.product_media where product_id = any(v_products)
    ) m;

  -- Activités : tables sans cascade (mêmes trois que delete_product), plus les paniers de TOUS les
  -- clients qui en contiennent une — sinon la FK cart_items.product_id bloque.
  delete from public.cart_items where product_id = any(v_products);
  delete from public.product_calendar where product_id = any(v_products);
  delete from public.product_availability where product_id = any(v_products);

  -- Propositions (socio → admin), y compris celles encore en attente de revue.
  delete from public.product_proposals
   where product_id = any(v_products)
      or establishment_id = any(v_establishments)
      or partner_id = p_partner_id
      or submitted_by = any(v_accounts)
      or establishment_proposal_id in (
        select id from public.establishment_proposals
         where establishment_id = any(v_establishments)
            or partner_id = p_partner_id
            or submitted_by = any(v_accounts)
      );
  delete from public.establishment_proposals
   where establishment_id = any(v_establishments)
      or partner_id = p_partner_id
      or submitted_by = any(v_accounts);

  -- Établissements : tables sans cascade. Aucune n'est rattachée à une commande (vérifié par le
  -- blocker) : des fermetures manuelles, un calendrier de ressources, une file PMS vide.
  delete from public.availability_blocks where establishment_id = any(v_establishments);
  delete from public.provider_resource_calendar where establishment_id = any(v_establishments);
  delete from public.pms_cancellation_queue where establishment_id = any(v_establishments);
  delete from public.establishment_payout_accounts where establishment_id = any(v_establishments);

  -- Capacités : celles du partenaire, et toute capacité operator d'un autre partenaire sur l'un de
  -- ses établissements (l'établissement disparaît avec lui).
  delete from public.partner_capabilities
   where partner_id = p_partner_id or establishment_id = any(v_establishments);

  -- Le reste cascade : médias, tags, amenities, tarifs par date, créneaux, miroir et état PMS.
  delete from public.products where id = any(v_products);
  delete from public.establishments where id = any(v_establishments);

  -- Comptes : tout ce qui retiendrait leur suppression par l'API Admin, sauf ce que le blocker a
  -- déjà exclu (commandes, audit).
  delete from public.cart_items where account_id = any(v_accounts);
  delete from public.carts where account_id = any(v_accounts);
  delete from public.comm_campaign_targets where account_id = any(v_accounts);
  delete from public.role_agreements where partner_id = p_partner_id or account_id = any(v_accounts);
  delete from public.notification_emails
   where recipient_account_id = any(v_accounts)
      or (related_table = 'partner_invitations' and related_id = any(v_invitations));
  delete from public.partner_invitations where id = any(v_invitations);

  -- Codes : libérés. Un client qui avait enregistré ce code (ou un panier qui le porte) le perd —
  -- sinon il attribuerait plus tard une vente au prochain partenaire qui recevrait ce code.
  update public.partner_accounts set saved_attribution_code = null
   where saved_attribution_code = any(v_codes);
  update public.carts set attribution_code = null where attribution_code = any(v_codes);
  delete from public.partner_codes where code = any(v_codes);

  update public.partner_accounts set partner_id = null, updated_at = now()
   where id = any(v_accounts);

  delete from public.partner_offboarding where partner_id = p_partner_id;
  delete from public.partner_payout_accounts where partner_id = p_partner_id;
  delete from public.partner_crm_profile where partner_id = p_partner_id;
  delete from public.partners where id = p_partner_id;

  -- Un même fichier peut servir à plusieurs fiches (données de démonstration) : seuls les chemins
  -- que plus rien ne référence partent de Storage.
  select coalesce(array_agg(p), '{}') into v_orphan_paths
    from unnest(v_media_paths) p
   where not exists (select 1 from public.establishment_media where storage_path = p)
     and not exists (select 1 from public.product_media where storage_path = p)
     and not exists (select 1 from public.catalog_tags where image_path = p);

  perform public.log_admin_action(
    'partner.delete', 'partners', p_partner_id,
    jsonb_build_object(
      'display_name', v_display_name,
      'accounts', coalesce(array_length(v_accounts, 1), 0),
      'establishments', coalesce(array_length(v_establishments, 1), 0),
      'products', coalesce(array_length(v_products, 1), 0),
      'codes', to_jsonb(v_codes)
    ),
    null, null
  );

  return jsonb_build_object(
    'ok', true,
    'account_ids', to_jsonb(v_accounts),
    'storage_paths', to_jsonb(v_orphan_paths)
  );
end;
$$;

revoke all on function public.admin_delete_partner(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_partner(uuid) to authenticated;
