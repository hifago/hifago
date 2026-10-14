-- Renommer et supprimer un équipement depuis l'admin (20261014204041_catalog_amenities_admin_edit).
--
-- Ce fichier tient :
--   • la GARDE : un visiteur n'a pas EXECUTE, un compte sans capacité admin est refusé (42501) ;
--   • le RENOMMAGE : es et en, autres clés gardées, slug INCHANGÉ (clé stable de mockData), refus
--     (vide, introuvable, doublon du libellé es sans casse ni espaces), audit ;
--   • la SUPPRESSION : équipement utilisé (assignations retirées en cascade, comptes rendus et
--     audités) et non utilisé ;
--   • la table devenue RPC-only en écriture : un admin ne l'écrit plus en direct.
begin;
select plan(24);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('9b140000-0000-4000-8000-000000000001', 'Equipamiento Admin Test');

insert into establishments (id, partner_id, name) values
  ('9b140000-0000-4000-8000-000000000011', '9b140000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Hostal Equipamiento Admin'));

insert into auth.users (id, email) values
  ('9b140000-0000-4000-8000-000000000021', 'equipamiento-admin-tiers@test.local'),
  ('9b140000-0000-4000-8000-000000000022', 'equipamiento-admin-admin@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('9b140000-0000-4000-8000-000000000022', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('9b140000-0000-4000-8000-000000000031', '9b140000-0000-4000-8000-000000000001',
   '9b140000-0000-4000-8000-000000000011', 'lodging',
   jsonb_build_object('es', 'Cabaña Equipamiento Admin'), 80000, false, 'equipamiento-admin-cabana');

insert into catalog_amenity_categories (key, label) values
  ('equipamiento_admin_test', jsonb_build_object('es', 'Categoría de prueba admin'));
insert into catalog_amenities (id, label, slug, category_key) values
  ('9b140000-0000-4000-8000-0000000000a1',
   jsonb_build_object('es', 'Sauna Prueba', 'en', 'Test sauna', 'pt', 'Sauna teste'),
   'equipamiento-admin-sauna', 'equipamiento_admin_test'),
  ('9b140000-0000-4000-8000-0000000000a2',
   jsonb_build_object('es', 'Hamaca Prueba', 'en', 'Test hammock'),
   'equipamiento-admin-hamaca', 'equipamiento_admin_test'),
  ('9b140000-0000-4000-8000-0000000000a3',
   jsonb_build_object('es', 'Fogata Prueba', 'en', 'Test campfire'),
   'equipamiento-admin-fogata', 'equipamiento_admin_test');

-- La hamaca est utilisée : par l'établissement ET par la cabaña.
insert into establishment_amenity_assignments (establishment_id, amenity_id) values
  ('9b140000-0000-4000-8000-000000000011', '9b140000-0000-4000-8000-0000000000a2');
insert into product_amenity_assignments (product_id, amenity_id) values
  ('9b140000-0000-4000-8000-000000000031', '9b140000-0000-4000-8000-0000000000a2');

-- ── Garde ─────────────────────────────────────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.admin_rename_catalog_amenity(uuid, text, text)', 'execute'),
  'un visiteur (anon) ne peut pas appeler le renommage'
);
select ok(
  not has_function_privilege('anon', 'public.admin_delete_catalog_amenity(uuid)', 'execute'),
  'un visiteur (anon) ne peut pas appeler la suppression'
);

set local role authenticated;
select test_login('9b140000-0000-4000-8000-000000000021');
select throws_ok(
  $$ select public.admin_rename_catalog_amenity('9b140000-0000-4000-8000-0000000000a1', 'X', 'Y') $$,
  '42501', null,
  'un compte sans capacité admin ne renomme rien'
);
select throws_ok(
  $$ select public.admin_delete_catalog_amenity('9b140000-0000-4000-8000-0000000000a1') $$,
  '42501', null,
  'un compte sans capacité admin ne supprime rien'
);
reset role;

-- ── Renommage, en admin ───────────────────────────────────────────────────────────────────────
set local role authenticated;
select test_login('9b140000-0000-4000-8000-000000000022');

select is(
  public.admin_rename_catalog_amenity('9b140000-0000-4000-8000-0000000000a1', '  ', 'Sauna') ->> 'reason',
  'label_es_required', 'libellé es vide : refusé'
);
select is(
  public.admin_rename_catalog_amenity('9b140000-0000-4000-8000-0000000000a1', 'Sauna', '') ->> 'reason',
  'label_en_required', 'libellé en vide : refusé'
);
select is(
  public.admin_rename_catalog_amenity('9b140000-0000-4000-8000-0000000000ff', 'Sauna', 'Sauna') ->> 'reason',
  'amenity_not_found', 'équipement inconnu : refusé'
);
select is(
  public.admin_rename_catalog_amenity('9b140000-0000-4000-8000-0000000000a1', '  hamaca PRUEBA ', 'Other') ->> 'reason',
  'duplicate_name', 'libellé es d''un AUTRE équipement (casse et espaces différents) : doublon refusé'
);

-- ⚠️ Appel en instruction À PART, jamais joint à la lecture qui le vérifie.
select is(
  (public.admin_rename_catalog_amenity('9b140000-0000-4000-8000-0000000000a1', ' Sauna seca ', ' Dry sauna ') ->> 'ok')::boolean,
  true, 'un admin renomme un équipement'
);
select is(
  public.admin_rename_catalog_amenity('9b140000-0000-4000-8000-0000000000a1', 'SAUNA SECA', 'Dry sauna') ->> 'ok',
  'true', 'renommer avec son PROPRE libellé (casse différente) n''est pas un doublon'
);
reset role;

select is(
  (select label from public.catalog_amenities where id = '9b140000-0000-4000-8000-0000000000a1'),
  jsonb_build_object('es', 'SAUNA SECA', 'en', 'Dry sauna', 'pt', 'Sauna teste'),
  'libellés es et en remplacés (sans espaces de bord), autres langues gardées'
);
select is(
  (select slug from public.catalog_amenities where id = '9b140000-0000-4000-8000-0000000000a1'),
  'equipamiento-admin-sauna',
  'le slug ne bouge pas : clé stable par laquelle mockData désigne l''équipement'
);
select is(
  (select label ->> 'es' from public.catalog_amenities where id = '9b140000-0000-4000-8000-0000000000a2'),
  'Hamaca Prueba', 'le doublon refusé n''a rien écrit'
);
select is(
  (select count(*)::int from public.audit_log
    where action = 'catalog_amenity.rename' and entity_id = '9b140000-0000-4000-8000-0000000000a1'),
  2, 'chaque renommage est journalisé (les refus non)'
);

-- ── Suppression, en admin ─────────────────────────────────────────────────────────────────────
set local role authenticated;
select test_login('9b140000-0000-4000-8000-000000000022');
select is(
  public.admin_delete_catalog_amenity('9b140000-0000-4000-8000-0000000000a2'),
  jsonb_build_object('ok', true, 'establishments', 1, 'products', 1),
  'équipement UTILISÉ : supprimé, avec ce que la cascade a retiré'
);
select is(
  public.admin_delete_catalog_amenity('9b140000-0000-4000-8000-0000000000a3'),
  jsonb_build_object('ok', true, 'establishments', 0, 'products', 0),
  'équipement non utilisé : supprimé'
);
select is(
  public.admin_delete_catalog_amenity('9b140000-0000-4000-8000-0000000000a3') ->> 'reason',
  'amenity_not_found', 'déjà supprimé : refusé'
);
reset role;

select is(
  (select count(*)::int from public.catalog_amenities
    where id in ('9b140000-0000-4000-8000-0000000000a2', '9b140000-0000-4000-8000-0000000000a3')),
  0, 'les deux équipements ont disparu'
);
select is(
  (select count(*)::int from public.establishment_amenity_assignments
    where amenity_id = '9b140000-0000-4000-8000-0000000000a2'),
  0, 'son assignation à l''établissement est partie avec lui (cascade, comme une étiquette)'
);
select is(
  (select count(*)::int from public.product_amenity_assignments
    where amenity_id = '9b140000-0000-4000-8000-0000000000a2'),
  0, 'son assignation à la cabaña aussi'
);
select is(
  (select before from public.audit_log
    where action = 'catalog_amenity.delete' and entity_id = '9b140000-0000-4000-8000-0000000000a2'),
  jsonb_build_object('label', jsonb_build_object('es', 'Hamaca Prueba', 'en', 'Test hammock'),
                     'slug', 'equipamiento-admin-hamaca', 'establishments', 1, 'products', 1),
  'la suppression est journalisée avec le libellé, le slug et ce qui a été retiré'
);

-- ── Écriture directe fermée : RPC-only ────────────────────────────────────────────────────────
set local role authenticated;
select test_login('9b140000-0000-4000-8000-000000000022');
select throws_ok(
  $$ update public.catalog_amenities set label = jsonb_build_object('es', 'Directo')
      where id = '9b140000-0000-4000-8000-0000000000a1' $$,
  '42501', null,
  'même admin, plus aucune écriture directe : renommer passe par la RPC auditée'
);
select throws_ok(
  $$ delete from public.catalog_amenities where id = '9b140000-0000-4000-8000-0000000000a1' $$,
  '42501', null,
  'ni suppression directe'
);
select is(
  (select count(*)::int from public.catalog_amenities where id = '9b140000-0000-4000-8000-0000000000a1'),
  1, 'la lecture, elle, reste ouverte'
);
reset role;

select * from finish();
rollback;
