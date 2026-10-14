-- Étiquettes proposables en ÉDITION par un socio (migration 20261013144848, demande Jérôme du
-- 2026-10-13) — fiches ET établissements.
--
-- `tag_ids` traverse une whitelist jsonb (submit_product_proposal /
-- submit_establishment_edit_proposal) PUIS une écriture explicite à l'approbation
-- (moderate_product_proposal / moderate_establishment_proposal). Un oubli dans l'une des quatre
-- jette la valeur EN SILENCE, entièrement côté Postgres : aucun test TypeScript ne peut le voir
-- (même classe de panne que transport_departure_info_proposal_parity.test.sql).
--
-- Ce fichier prouve aussi ce qui ne se prouve qu'ici :
--   * la FORME GARDÉE — une proposition sans la clé ne retire aucune étiquette ;
--   * un tableau VIDE, lui, les retire toutes (c'est une demande explicite) ;
--   * un identifiant inconnu ou mal formé est écarté au dépôt, sans erreur de cast ;
--   * une étiquette supprimée entre le dépôt et l'approbation ne fait pas échouer l'approbation.
begin;
select plan(19);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('7a650000-0000-4000-8000-000000000001', 'Etiquetas Test');

insert into establishments (id, partner_id, name) values
  ('7a650000-0000-4000-8000-000000000011', '7a650000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Hostal Etiquetas'));

insert into auth.users (id, email) values
  ('7a650000-0000-4000-8000-000000000021', 'etiquetas-socio@test.local'),
  ('7a650000-0000-4000-8000-000000000024', 'etiquetas-admin@test.local');

update partner_accounts set partner_id = '7a650000-0000-4000-8000-000000000001'
 where id = '7a650000-0000-4000-8000-000000000021';

insert into partner_capabilities (partner_id, role, source, status) values
  ('7a650000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('7a650000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '7a650000-0000-4000-8000-000000000011');
insert into partner_capabilities (account_id, role, source, status) values
  ('7a650000-0000-4000-8000-000000000024', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('7a650000-0000-4000-8000-000000000031', '7a650000-0000-4000-8000-000000000001',
   '7a650000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Caminata Etiquetas'), 50000, false, 'etiquetas-test-caminata');

insert into catalog_tags (id, label, slug) values
  ('7a650000-0000-4000-8000-0000000000a1', jsonb_build_object('es', 'Etiqueta Uno'), 'etiquetas-test-uno'),
  ('7a650000-0000-4000-8000-0000000000a2', jsonb_build_object('es', 'Etiqueta Dos'), 'etiquetas-test-dos'),
  ('7a650000-0000-4000-8000-0000000000a3', jsonb_build_object('es', 'Etiqueta Tres'), 'etiquetas-test-tres');

-- État de départ : la fiche et l'établissement portent « Uno ».
insert into product_tag_assignments (product_id, tag_id) values
  ('7a650000-0000-4000-8000-000000000031', '7a650000-0000-4000-8000-0000000000a1');
insert into establishment_tag_assignments (establishment_id, tag_id) values
  ('7a650000-0000-4000-8000-000000000011', '7a650000-0000-4000-8000-0000000000a1');

-- Les slugs des étiquettes posées, dans l'ordre : une seule lecture pour toutes les assertions.
create function etiquetas_ficha() returns text language sql as $$
  select coalesce(string_agg(t.slug, ',' order by t.slug), '')
    from public.product_tag_assignments a join public.catalog_tags t on t.id = a.tag_id
   where a.product_id = '7a650000-0000-4000-8000-000000000031';
$$;
create function etiquetas_establecimiento() returns text language sql as $$
  select coalesce(string_agg(t.slug, ',' order by t.slug), '')
    from public.establishment_tag_assignments a join public.catalog_tags t on t.id = a.tag_id
   where a.establishment_id = '7a650000-0000-4000-8000-000000000011';
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A. FICHE — dépôt : la whitelist laisse entrer tag_ids, et seulement des étiquettes réelles
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7a650000-0000-4000-8000-000000000021');
create temp table tmp_a as
  select (submit_product_proposal(
    '7a650000-0000-4000-8000-000000000031'::uuid,
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Caminata Etiquetas'),
      'price_cop', 50000,
      'tag_ids', jsonb_build_array(
        '7a650000-0000-4000-8000-0000000000a3',
        '7a650000-0000-4000-8000-0000000000a2',
        'esto-no-es-un-uuid',
        '7a650000-0000-4000-8000-0000000000ff'
      )
    )
  )->>'proposal_id')::uuid as id;

select is(
  (select payload -> 'tag_ids' from product_proposals where id = (select id from tmp_a)),
  -- Ordre du slug (« dos » avant « tres ») : le tableau est RECONSTRUIT depuis catalog_tags.
  jsonb_build_array('7a650000-0000-4000-8000-0000000000a2', '7a650000-0000-4000-8000-0000000000a3'),
  'fiche, dépôt : tag_ids traverse la whitelist, l''id mal formé et l''id inconnu sont écartés'
);

select is(etiquetas_ficha(), 'etiquetas-test-uno',
  'fiche, dépôt : rien n''est écrit avant l''approbation');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- B. FICHE — approbation : l'ensemble est REMPLACÉ
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7a650000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_a), 'approve', 1)->>'ok'),
  'true', 'fiche : l''approbation réussit');

select is(etiquetas_ficha(), 'etiquetas-test-dos,etiquetas-test-tres',
  'fiche, approbation : « Uno » retirée, « Dos » et « Tres » posées');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- C. FICHE — forme gardée : sans la clé, rien ne bouge
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7a650000-0000-4000-8000-000000000021');
create temp table tmp_c as
  select (submit_product_proposal(
    '7a650000-0000-4000-8000-000000000031'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Solo cambio de nombre'), 'price_cop', 50000)
  )->>'proposal_id')::uuid as id;

select is(
  (select payload ? 'tag_ids' from product_proposals where id = (select id from tmp_c)),
  false,
  'fiche, dépôt sans tag_ids : la clé n''entre PAS dans le payload (ni même à null)'
);

select test_login('7a650000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_c), 'approve', 1)->>'ok'),
  'true', 'fiche : l''approbation d''une édition sans étiquettes réussit');

select is(etiquetas_ficha(), 'etiquetas-test-dos,etiquetas-test-tres',
  'fiche, forme gardée : une simple correction de nom ne retire AUCUNE étiquette');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- D. FICHE — la correction de l'admin décide, et une étiquette supprimée ne casse rien
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7a650000-0000-4000-8000-000000000021');
create temp table tmp_d as
  select (submit_product_proposal(
    '7a650000-0000-4000-8000-000000000031'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Caminata Etiquetas'), 'price_cop', 50000,
                       'tag_ids', jsonb_build_array('7a650000-0000-4000-8000-0000000000a2'))
  )->>'proposal_id')::uuid as id;

-- « Tres » disparaît du catalogue entre le dépôt et l'approbation (la cascade retire son
-- assignation) ; l'admin, lui, corrige la proposition en « Uno » + « Tres » (page chargée avant).
delete from catalog_tags where id = '7a650000-0000-4000-8000-0000000000a3';

select test_login('7a650000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal(
     (select id from tmp_d), 'approve', 1,
     jsonb_build_object('name', jsonb_build_object('es', 'Caminata Etiquetas'), 'price_cop', 50000,
                        'tag_ids', jsonb_build_array('7a650000-0000-4000-8000-0000000000a1',
                                                     '7a650000-0000-4000-8000-0000000000a3'))
   )->>'ok'),
  'true',
  'fiche : approuver avec une étiquette SUPPRIMÉE entre-temps n''échoue pas sur la clé étrangère'
);

select is(etiquetas_ficha(), 'etiquetas-test-uno',
  'fiche : la correction de l''admin remplace la proposition, l''étiquette supprimée est écartée');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- E. FICHE — un tableau VIDE retire tout (demande explicite, pas une absence)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7a650000-0000-4000-8000-000000000021');
create temp table tmp_e as
  select (submit_product_proposal(
    '7a650000-0000-4000-8000-000000000031'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Caminata Etiquetas'), 'price_cop', 50000,
                       'tag_ids', '[]'::jsonb)
  )->>'proposal_id')::uuid as id;

select test_login('7a650000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_e), 'approve', 1)->>'ok'),
  'true', 'fiche : l''approbation d''un tableau vide réussit');

select is(etiquetas_ficha(), '', 'fiche : un tableau vide retire toutes les étiquettes');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- F. ÉTABLISSEMENT — dépôt puis approbation
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7a650000-0000-4000-8000-000000000021');
create temp table tmp_f as
  select (submit_establishment_edit_proposal(
    '7a650000-0000-4000-8000-000000000011'::uuid,
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Hostal Etiquetas'),
      'tag_ids', jsonb_build_array('7a650000-0000-4000-8000-0000000000a2', 'esto-no-es-un-uuid')
    )
  )->>'proposal_id')::uuid as id;

select is(
  (select payload -> 'tag_ids' from establishment_proposals where id = (select id from tmp_f)),
  jsonb_build_array('7a650000-0000-4000-8000-0000000000a2'),
  'établissement, dépôt : tag_ids traverse la whitelist, l''id mal formé est écarté'
);

select test_login('7a650000-0000-4000-8000-000000000024');
select is(
  (select moderate_establishment_proposal((select id from tmp_f), 'approve', 1)->>'ok'),
  'true', 'établissement : l''approbation réussit');

select is(etiquetas_establecimiento(), 'etiquetas-test-dos',
  'établissement, approbation : « Uno » retirée, « Dos » posée');

select is(
  (select payload -> 'tag_ids' from establishment_proposals where id = (select id from tmp_f)),
  jsonb_build_array('7a650000-0000-4000-8000-0000000000a2'),
  'établissement : le payload archivé garde la trace des étiquettes approuvées'
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- G. ÉTABLISSEMENT — forme gardée, puis repli clé par clé sur la proposition
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7a650000-0000-4000-8000-000000000021');
create temp table tmp_g as
  select (submit_establishment_edit_proposal(
    '7a650000-0000-4000-8000-000000000011'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Hostal Etiquetas Renombrado'))
  )->>'proposal_id')::uuid as id;

select is(
  (select payload ? 'tag_ids' from establishment_proposals where id = (select id from tmp_g)),
  false,
  'établissement, dépôt sans tag_ids : la clé n''entre PAS dans le payload'
);

select test_login('7a650000-0000-4000-8000-000000000024');
select moderate_establishment_proposal((select id from tmp_g), 'approve', 1);

select is(etiquetas_establecimiento(), 'etiquetas-test-dos',
  'établissement, forme gardée : une correction de nom ne retire AUCUNE étiquette');

select test_login('7a650000-0000-4000-8000-000000000021');
create temp table tmp_h as
  select (submit_establishment_edit_proposal(
    '7a650000-0000-4000-8000-000000000011'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Hostal Etiquetas'),
                       'tag_ids', jsonb_build_array('7a650000-0000-4000-8000-0000000000a1'))
  )->>'proposal_id')::uuid as id;

-- L'admin corrige le nom SANS renvoyer tag_ids : la proposition du socio reste la référence.
select test_login('7a650000-0000-4000-8000-000000000024');
select is(
  (select moderate_establishment_proposal(
     (select id from tmp_h), 'approve', 1,
     jsonb_build_object('name', jsonb_build_object('es', 'Hostal Etiquetas Corregido'))
   )->>'ok'),
  'true', 'établissement : l''approbation avec un payload corrigé sans tag_ids réussit');

select is(etiquetas_establecimiento(), 'etiquetas-test-uno',
  'établissement : sans tag_ids dans la correction, ce sont les étiquettes PROPOSÉES qui s''appliquent');

select * from finish();
rollback;
