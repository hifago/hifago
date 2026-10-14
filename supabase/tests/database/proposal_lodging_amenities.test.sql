-- Équipements d'un logement proposables par un socio, à la CRÉATION et en ÉDITION (migration
-- 20261013151206, demande Jérôme du 2026-10-13).
--
-- `amenity_ids` traverse une whitelist jsonb (submit_product_creation_proposal /
-- submit_product_proposal) PUIS une écriture explicite à l'approbation
-- (create_product_from_proposal / moderate_product_proposal). Un oubli dans l'une des quatre jette
-- la valeur EN SILENCE, entièrement côté Postgres : aucun test TypeScript ne peut le voir (même
-- classe de panne que proposal_edit_tags.test.sql).
--
-- Ce fichier prouve aussi ce qui ne se prouve qu'ici :
--   * la FORME GARDÉE — une proposition sans la clé ne retire aucun équipement ;
--   * un tableau VIDE, lui, les retire tous (c'est une demande explicite) ;
--   * un identifiant inconnu ou mal formé est écarté au dépôt, sans erreur de cast ;
--   * les équipements restent réservés aux LOGEMENTS, au dépôt comme à l'approbation.
begin;
select plan(17);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('7a660000-0000-4000-8000-000000000001', 'Equipamiento Test');

insert into establishments (id, partner_id, name) values
  ('7a660000-0000-4000-8000-000000000011', '7a660000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Hostal Equipamiento'));

insert into auth.users (id, email) values
  ('7a660000-0000-4000-8000-000000000021', 'equipamiento-socio@test.local'),
  ('7a660000-0000-4000-8000-000000000024', 'equipamiento-admin@test.local');

update partner_accounts set partner_id = '7a660000-0000-4000-8000-000000000001'
 where id = '7a660000-0000-4000-8000-000000000021';

insert into partner_capabilities (partner_id, role, source, status) values
  ('7a660000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('7a660000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '7a660000-0000-4000-8000-000000000011');
insert into partner_capabilities (account_id, role, source, status) values
  ('7a660000-0000-4000-8000-000000000024', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('7a660000-0000-4000-8000-000000000031', '7a660000-0000-4000-8000-000000000001',
   '7a660000-0000-4000-8000-000000000011', 'lodging',
   jsonb_build_object('es', 'Cabaña Equipamiento'), 80000, false, 'equipamiento-test-cabana'),
  ('7a660000-0000-4000-8000-000000000032', '7a660000-0000-4000-8000-000000000001',
   '7a660000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Caminata Equipamiento'), 50000, false, 'equipamiento-test-caminata');

insert into catalog_amenity_categories (key, label) values
  ('equipamiento_test', jsonb_build_object('es', 'Categoría de prueba'));
insert into catalog_amenities (id, label, slug, category_key) values
  ('7a660000-0000-4000-8000-0000000000a1', jsonb_build_object('es', 'Equipo Uno'), 'equipamiento-test-uno', 'equipamiento_test'),
  ('7a660000-0000-4000-8000-0000000000a2', jsonb_build_object('es', 'Equipo Dos'), 'equipamiento-test-dos', 'equipamiento_test'),
  ('7a660000-0000-4000-8000-0000000000a3', jsonb_build_object('es', 'Equipo Tres'), 'equipamiento-test-tres', 'equipamiento_test');

-- État de départ : le logement porte « Uno ».
insert into product_amenity_assignments (product_id, amenity_id) values
  ('7a660000-0000-4000-8000-000000000031', '7a660000-0000-4000-8000-0000000000a1');

-- Les slugs des équipements posés sur une fiche, dans l'ordre.
create function equipamiento_de(p_product_id uuid) returns text language sql as $$
  select coalesce(string_agg(c.slug, ',' order by c.slug), '')
    from public.product_amenity_assignments a join public.catalog_amenities c on c.id = a.amenity_id
   where a.product_id = p_product_id;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A. ÉDITION — dépôt : la whitelist laisse entrer amenity_ids, et seulement des équipements réels
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7a660000-0000-4000-8000-000000000021');
create temp table tmp_a as
  select (submit_product_proposal(
    '7a660000-0000-4000-8000-000000000031'::uuid,
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Cabaña Equipamiento'),
      'price_cop', 80000,
      'amenity_ids', jsonb_build_array(
        '7a660000-0000-4000-8000-0000000000a3',
        '7a660000-0000-4000-8000-0000000000a2',
        'esto-no-es-un-uuid',
        '7a660000-0000-4000-8000-0000000000ff'
      )
    )
  )->>'proposal_id')::uuid as id;

select is(
  (select payload -> 'amenity_ids' from product_proposals where id = (select id from tmp_a)),
  -- Ordre du slug (« dos » avant « tres ») : le tableau est RECONSTRUIT depuis catalog_amenities.
  jsonb_build_array('7a660000-0000-4000-8000-0000000000a2', '7a660000-0000-4000-8000-0000000000a3'),
  'édition, dépôt : amenity_ids traverse la whitelist, l''id mal formé et l''id inconnu sont écartés'
);

select is(equipamiento_de('7a660000-0000-4000-8000-000000000031'), 'equipamiento-test-uno',
  'édition, dépôt : rien n''est écrit avant l''approbation');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- B. ÉDITION — approbation : l'ensemble est REMPLACÉ
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7a660000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_a), 'approve', 1)->>'ok'),
  'true', 'édition : l''approbation réussit');

select is(equipamiento_de('7a660000-0000-4000-8000-000000000031'),
  'equipamiento-test-dos,equipamiento-test-tres',
  'édition, approbation : « Uno » retiré, « Dos » et « Tres » posés');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- C. ÉDITION — forme gardée : sans la clé, rien ne bouge
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7a660000-0000-4000-8000-000000000021');
create temp table tmp_c as
  select (submit_product_proposal(
    '7a660000-0000-4000-8000-000000000031'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Solo cambio de nombre'), 'price_cop', 80000)
  )->>'proposal_id')::uuid as id;

select is(
  (select payload ? 'amenity_ids' from product_proposals where id = (select id from tmp_c)),
  false,
  'édition, dépôt sans amenity_ids : la clé n''entre PAS dans le payload (ni même à null)'
);

select test_login('7a660000-0000-4000-8000-000000000024');
select moderate_product_proposal((select id from tmp_c), 'approve', 1);

select is(equipamiento_de('7a660000-0000-4000-8000-000000000031'),
  'equipamiento-test-dos,equipamiento-test-tres',
  'édition, forme gardée : une simple correction de nom ne retire AUCUN équipement');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- D. ÉDITION — un tableau VIDE retire tout (demande explicite, pas une absence)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7a660000-0000-4000-8000-000000000021');
create temp table tmp_d as
  select (submit_product_proposal(
    '7a660000-0000-4000-8000-000000000031'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Cabaña Equipamiento'), 'price_cop', 80000,
                       'amenity_ids', '[]'::jsonb)
  )->>'proposal_id')::uuid as id;

select test_login('7a660000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_d), 'approve', 1)->>'ok'),
  'true', 'édition : l''approbation d''un tableau vide réussit');

select is(equipamiento_de('7a660000-0000-4000-8000-000000000031'), '',
  'édition : un tableau vide retire tous les équipements');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- E. ÉDITION — réservé aux logements, au dépôt comme à l'approbation
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7a660000-0000-4000-8000-000000000021');
create temp table tmp_e as
  select (submit_product_proposal(
    '7a660000-0000-4000-8000-000000000032'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Caminata Equipamiento'), 'price_cop', 50000,
                       'amenity_ids', jsonb_build_array('7a660000-0000-4000-8000-0000000000a1'))
  )->>'proposal_id')::uuid as id;

select is(
  (select payload ? 'amenity_ids' from product_proposals where id = (select id from tmp_e)),
  false,
  'édition d''une activité : amenity_ids est écarté au dépôt'
);

-- Le payload corrigé par l'admin ne repasse pas par la whitelist du dépôt : la garde de type de
-- moderate_product_proposal est le seul rempart sur ce chemin.
select test_login('7a660000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal(
     (select id from tmp_e), 'approve', 1,
     jsonb_build_object('name', jsonb_build_object('es', 'Caminata Equipamiento'), 'price_cop', 50000,
                        'amenity_ids', jsonb_build_array('7a660000-0000-4000-8000-0000000000a1'))
   )->>'ok'),
  'true', 'édition d''une activité : l''approbation avec amenity_ids corrigé réussit');

select is(equipamiento_de('7a660000-0000-4000-8000-000000000032'), '',
  'édition d''une activité : aucun équipement n''est posé, même via le payload corrigé');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- F. CRÉATION d'un logement — dépôt puis approbation
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7a660000-0000-4000-8000-000000000021');
create temp table tmp_f as
  select (submit_product_creation_proposal(
    '7a660000-0000-4000-8000-000000000011'::uuid, 'lodging',
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Cabaña Nueva Equipamiento'),
      'price_cop', 90000,
      'amenity_ids', jsonb_build_array('7a660000-0000-4000-8000-0000000000a1', 'esto-no-es-un-uuid')
    )
  )->>'proposal_id')::uuid as id;

select is(
  (select payload -> 'amenity_ids' from product_proposals where id = (select id from tmp_f)),
  jsonb_build_array('7a660000-0000-4000-8000-0000000000a1'),
  'création, dépôt : amenity_ids traverse la whitelist, l''id mal formé est écarté'
);

select test_login('7a660000-0000-4000-8000-000000000024');
create temp table tmp_f_product as
  select (moderate_product_proposal((select id from tmp_f), 'approve', 1)->>'product_id')::uuid as id;

select isnt((select id from tmp_f_product), null, 'création : l''approbation crée le logement');

select is(equipamiento_de((select id from tmp_f_product)), 'equipamiento-test-uno',
  'création, approbation : l''équipement proposé est posé sur le logement créé');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- G. CRÉATION — sans la clé, et hors logement
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7a660000-0000-4000-8000-000000000021');
create temp table tmp_g as
  select (submit_product_creation_proposal(
    '7a660000-0000-4000-8000-000000000011'::uuid, 'lodging',
    jsonb_build_object('name', jsonb_build_object('es', 'Cabaña Sin Equipamiento'), 'price_cop', 90000)
  )->>'proposal_id')::uuid as id;

select is(
  (select payload ? 'amenity_ids' from product_proposals where id = (select id from tmp_g)),
  false,
  'création, dépôt sans amenity_ids : la clé n''entre PAS dans le payload'
);

create temp table tmp_h as
  select (submit_product_creation_proposal(
    '7a660000-0000-4000-8000-000000000011'::uuid, 'activity',
    jsonb_build_object('name', jsonb_build_object('es', 'Caminata Nueva Equipamiento'), 'price_cop', 40000,
                       'amenity_ids', jsonb_build_array('7a660000-0000-4000-8000-0000000000a1'))
  )->>'proposal_id')::uuid as id;

select is(
  (select payload ? 'amenity_ids' from product_proposals where id = (select id from tmp_h)),
  false,
  'création d''une activité : amenity_ids est écarté au dépôt'
);

select test_login('7a660000-0000-4000-8000-000000000024');
create temp table tmp_h_product as
  select (moderate_product_proposal(
     (select id from tmp_h), 'approve', 1,
     jsonb_build_object('name', jsonb_build_object('es', 'Caminata Nueva Equipamiento'), 'price_cop', 40000,
                        'amenity_ids', jsonb_build_array('7a660000-0000-4000-8000-0000000000a1'))
   )->>'product_id')::uuid as id;

select is(equipamiento_de((select id from tmp_h_product)), '',
  'création d''une activité : aucun équipement n''est posé, même via le payload corrigé');

select * from finish();
rollback;
