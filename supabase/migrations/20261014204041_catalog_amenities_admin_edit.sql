-- Equipamiento : renommer et supprimer un équipement depuis l'admin (arbitrage de Gabriel, au nom
-- de Jérôme), sur le modèle du dialogue « Editar o eliminar etiquetas » des étiquettes.
--
-- `catalog_amenities` reste une liste FERMÉE (décision du 2026-09-17) : aucun ajout depuis l'écran,
-- seulement le renommage et la suppression, par deux RPC admin auditées (log_admin_action) — là où
-- les étiquettes écrivent en direct sous RLS.
--
--   • Renommer : les libellés es ET en, les autres clés gardées. Le SLUG NE BOUGE PAS : c'est la clé
--     stable par laquelle `mockData/` (`"amenities": [slugs]`) et `supabase/scripts/seed-mock-data.mjs`
--     désignent un équipement — le recalculer casserait le prochain chargement. Doublon contrôlé sur
--     le libellé es (sans casse ni espaces de bord) parmi les AUTRES équipements → `duplicate_name`.
--   • Supprimer : EXACTEMENT comme une étiquette — la ligne part, et ses assignations
--     (establishment_amenity_assignments, product_amenity_assignments) avec elle, en cascade (FK
--     déjà `on delete cascade`, 20260917110000). L'écran annonce avant ce qui sera retiré. Une
--     proposition en attente qui le cite n'a besoin de rien : son `amenity_ids` est reconstruit
--     depuis catalog_amenities à l'approbation (20261013212500). ⚠️ Un équipement supprimé encore
--     cité par `mockData/` fait échouer seed-mock-data sur cet item — voulu : bruyant.
--
-- Écritures désormais AUDITÉES, donc RPC-only (CLAUDE.md §3.1 : « toute écriture nécessitant un
-- audit nominatif ») : la policy d'écriture admin directe de 20260917110000 est retirée et les
-- grants d'écriture révoqués — sans quoi un admin pourrait encore renommer ou supprimer sans trace.
-- Aucun code n'écrit cette table en direct (lectures seulement) ; les migrations de seed s'exécutent
-- en `postgres`, non concerné. Différence assumée avec catalog_tags, qui reste en écriture directe.

drop policy catalog_amenities_write_admin on public.catalog_amenities;
revoke insert, update, delete on public.catalog_amenities from authenticated, anon;

create function public.admin_rename_catalog_amenity(
  p_amenity_id uuid,
  p_label_es text,
  p_label_en text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_es text := btrim(coalesce(p_label_es, ''));
  v_en text := btrim(coalesce(p_label_en, ''));
  v_before jsonb;
  v_after jsonb;
begin
  if not (select public.is_admin((select auth.uid()))) then
    raise exception 'admin_rename_catalog_amenity réservé au rôle admin' using errcode = '42501';
  end if;

  if v_es = '' then
    return jsonb_build_object('ok', false, 'reason', 'label_es_required');
  end if;
  if v_en = '' then
    return jsonb_build_object('ok', false, 'reason', 'label_en_required');
  end if;

  select label into v_before from public.catalog_amenities where id = p_amenity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'amenity_not_found');
  end if;

  if exists (
    select 1 from public.catalog_amenities
     where id <> p_amenity_id
       and lower(btrim(label ->> 'es')) = lower(v_es)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_name');
  end if;

  v_after := v_before || jsonb_build_object('es', v_es, 'en', v_en);
  update public.catalog_amenities set label = v_after where id = p_amenity_id;

  perform public.log_admin_action(
    'catalog_amenity.rename', 'catalog_amenities', p_amenity_id,
    jsonb_build_object('label', v_before),
    jsonb_build_object('label', v_after),
    null
  );

  return jsonb_build_object('ok', true, 'label', v_after);
end;
$$;

comment on function public.admin_rename_catalog_amenity(uuid, text, text) is
  'Renomme un équipement (libellés es et en, autres clés gardées, slug inchangé — clé stable de '
  'mockData). Admin seul (42501 sinon), audité. Refus : label_es_required, label_en_required, '
  'amenity_not_found, duplicate_name.';

revoke all on function public.admin_rename_catalog_amenity(uuid, text, text) from public, anon;
grant execute on function public.admin_rename_catalog_amenity(uuid, text, text) to authenticated;

create function public.admin_delete_catalog_amenity(p_amenity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label jsonb;
  v_slug text;
  v_establishments int;
  v_products int;
begin
  if not (select public.is_admin((select auth.uid()))) then
    raise exception 'admin_delete_catalog_amenity réservé au rôle admin' using errcode = '42501';
  end if;

  select label, slug into v_label, v_slug
    from public.catalog_amenities where id = p_amenity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'amenity_not_found');
  end if;

  -- Ce que la cascade va retirer : rendu à l'écran et gardé dans l'audit.
  select count(*)::int into v_establishments
    from public.establishment_amenity_assignments where amenity_id = p_amenity_id;
  select count(*)::int into v_products
    from public.product_amenity_assignments where amenity_id = p_amenity_id;

  delete from public.catalog_amenities where id = p_amenity_id;

  perform public.log_admin_action(
    'catalog_amenity.delete', 'catalog_amenities', p_amenity_id,
    jsonb_build_object('label', v_label, 'slug', v_slug,
                       'establishments', v_establishments, 'products', v_products),
    null,
    null
  );

  return jsonb_build_object('ok', true, 'establishments', v_establishments, 'products', v_products);
end;
$$;

comment on function public.admin_delete_catalog_amenity(uuid) is
  'Supprime un équipement et, en cascade, ses assignations (établissements, fiches) — comme une '
  'étiquette. Admin seul (42501 sinon), audité avec ce qui a été retiré. Refus : amenity_not_found.';

revoke all on function public.admin_delete_catalog_amenity(uuid) from public, anon;
grant execute on function public.admin_delete_catalog_amenity(uuid) to authenticated;
