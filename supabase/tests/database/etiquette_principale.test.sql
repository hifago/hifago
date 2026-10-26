-- L'étiquette PRINCIPALE (20261025100000, demande Jérôme du 2026-10-25) : seule la première
-- étiquette posée classe une carte dans la vitrine ; toutes restent cherchables en texte libre.
--
-- Le cas d'origine, reproduit tel quel : « L'expérience viking » porte, dans cet ordre, Actividad
-- náutica, Deportes, Tours, Adrenalina — et la vitrine la rangeait dans les quatre catégories.
-- Les slugs des fixtures sont choisis pour que la principale ne soit JAMAIS la première par ordre
-- alphabétique (`ep-adrenalina` < `ep-deportes` < `ep-nautica`) : l'ancien `min(slug)` du mélange
-- et toute lecture sans `order by position` échoueraient ici.
--
-- Ce fichier prouve :
--   * le déclencheur : chaque insertion se pose en fin de liste (un `insert` de plusieurs lignes
--     comme des insertions successives), et le rang envoyé est ignoré ;
--   * `catalog_tag_ids_in_order` : ordre gardé, doublons et identifiants inconnus écartés ;
--   * `catalog_card_primary_tag_id` : fiche / établissement groupé / couchage unique ;
--   * la vitrine : catégories, filtre par catégorie et « Otras » ne lisent que la principale, la
--     recherche en texte libre lit toutes les étiquettes ;
--   * c'est bien `position` qui décide (un `update` change la catégorie) ;
--   * `admin_update_product_inline` : un simple réordonnancement est écrit et audité.
--
-- ⚠️ Assertions SCOPÉES sur les fixtures (préfixe `e71c0000-`, slugs `ep-…`) : la base locale
-- accumule des données d'e2e. Les lectures de la vitrine tournent en `anon`, le rôle réel.
begin;
select plan(22);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Les slugs d'une fiche / d'un établissement, dans l'ordre de `position`.
create function ep_ficha(p uuid) returns text language sql as $$
  select coalesce(string_agg(t.slug, ',' order by a.position), '')
    from public.product_tag_assignments a join public.catalog_tags t on t.id = a.tag_id
   where a.product_id = p;
$$;
create function ep_slug(p_tag uuid) returns text language sql as $$
  select slug from public.catalog_tags where id = p_tag;
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into partners (id, display_name) values
  ('e71c0000-0000-4000-8000-000000000001', 'Etiqueta Principal Test Partner');

-- A : activités · B : DEUX couchages vendables (carte groupée) · C : UN couchage (carte produit).
insert into establishments (id, partner_id, name, status) values
  ('e71c0000-0000-4000-8000-00000000000a', 'e71c0000-0000-4000-8000-000000000001',
   '{"es":"Operador EP"}'::jsonb, 'active'),
  ('e71c0000-0000-4000-8000-00000000000b', 'e71c0000-0000-4000-8000-000000000001',
   '{"es":"Hotel Agrupado EP"}'::jsonb, 'active'),
  ('e71c0000-0000-4000-8000-00000000000c', 'e71c0000-0000-4000-8000-000000000001',
   '{"es":"Cabaña Única EP"}'::jsonb, 'active');

insert into products
  (id, partner_id, establishment_id, type, slug, name, price_cop, sellable, capacity, schedule)
values
  ('e71c0000-0000-4000-8000-000000000101', 'e71c0000-0000-4000-8000-000000000001',
   'e71c0000-0000-4000-8000-00000000000a', 'activity', 'ep-vikinga',
   '{"es":"Experiencia vikinga EP"}'::jsonb, 80000, true, null, 'date'),
  ('e71c0000-0000-4000-8000-000000000102', 'e71c0000-0000-4000-8000-000000000001',
   'e71c0000-0000-4000-8000-00000000000a', 'activity', 'ep-paseo',
   '{"es":"Paseo EP"}'::jsonb, 50000, true, null, 'date'),
  ('e71c0000-0000-4000-8000-000000000201', 'e71c0000-0000-4000-8000-000000000001',
   'e71c0000-0000-4000-8000-00000000000b', 'lodging', 'ep-hab-b1',
   '{"es":"Hab B1 EP"}'::jsonb, 90000, true, 2, 'date'),
  ('e71c0000-0000-4000-8000-000000000202', 'e71c0000-0000-4000-8000-000000000001',
   'e71c0000-0000-4000-8000-00000000000b', 'lodging', 'ep-hab-b2',
   '{"es":"Hab B2 EP"}'::jsonb, 95000, true, 2, 'date'),
  ('e71c0000-0000-4000-8000-000000000203', 'e71c0000-0000-4000-8000-000000000001',
   'e71c0000-0000-4000-8000-00000000000c', 'lodging', 'ep-cabana-unica',
   '{"es":"Cabaña única EP"}'::jsonb, 120000, true, 2, 'date');

insert into catalog_tags (id, label, slug) values
  ('e71c0000-0000-4000-8000-000000000301', '{"es":"Náutica EP"}'::jsonb, 'ep-nautica'),
  ('e71c0000-0000-4000-8000-000000000302', '{"es":"Deportes EP"}'::jsonb, 'ep-deportes'),
  ('e71c0000-0000-4000-8000-000000000303', '{"es":"Tours EP"}'::jsonb, 'ep-tours'),
  ('e71c0000-0000-4000-8000-000000000304', '{"es":"Adrenalina EP"}'::jsonb, 'ep-adrenalina'),
  ('e71c0000-0000-4000-8000-000000000305', '{"es":"Precio EP"}'::jsonb, 'ep-precio'),
  ('e71c0000-0000-4000-8000-000000000306', '{"es":"Cabaña EP"}'::jsonb, 'ep-cabana');

-- La vikinga : UN insert de quatre lignes, dans l'ordre du partenaire.
insert into product_tag_assignments (product_id, tag_id) values
  ('e71c0000-0000-4000-8000-000000000101', 'e71c0000-0000-4000-8000-000000000301'),
  ('e71c0000-0000-4000-8000-000000000101', 'e71c0000-0000-4000-8000-000000000302'),
  ('e71c0000-0000-4000-8000-000000000101', 'e71c0000-0000-4000-8000-000000000303'),
  ('e71c0000-0000-4000-8000-000000000101', 'e71c0000-0000-4000-8000-000000000304');

-- Le paseo : deux insertions SUCCESSIVES, dans la même transaction (même `created_at`) — seule la
-- colonne `position` peut les départager. Puis une troisième avec un rang envoyé, à ignorer.
insert into product_tag_assignments (product_id, tag_id) values
  ('e71c0000-0000-4000-8000-000000000102', 'e71c0000-0000-4000-8000-000000000302');
insert into product_tag_assignments (product_id, tag_id) values
  ('e71c0000-0000-4000-8000-000000000102', 'e71c0000-0000-4000-8000-000000000301');
insert into product_tag_assignments (product_id, tag_id, position) values
  ('e71c0000-0000-4000-8000-000000000102', 'e71c0000-0000-4000-8000-000000000303', -5);

-- Hotel groupé : « Precio » puis « Cabaña » sur l'établissement, « Tours » sur une chambre (ignorée
-- pour une carte groupée). Cabaña unique : « Cabaña » sur l'établissement, « Precio » sur la fiche.
insert into establishment_tag_assignments (establishment_id, tag_id) values
  ('e71c0000-0000-4000-8000-00000000000b', 'e71c0000-0000-4000-8000-000000000305'),
  ('e71c0000-0000-4000-8000-00000000000b', 'e71c0000-0000-4000-8000-000000000306'),
  ('e71c0000-0000-4000-8000-00000000000c', 'e71c0000-0000-4000-8000-000000000306');
insert into product_tag_assignments (product_id, tag_id) values
  ('e71c0000-0000-4000-8000-000000000201', 'e71c0000-0000-4000-8000-000000000303'),
  ('e71c0000-0000-4000-8000-000000000203', 'e71c0000-0000-4000-8000-000000000305');

insert into auth.users (id, email) values
  ('e71c0000-0000-4000-8000-000000000031', 'etiqueta-principal-admin@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('e71c0000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

-- ── 1. Le déclencheur ────────────────────────────────────────────────────────────────────────────
select is(ep_ficha('e71c0000-0000-4000-8000-000000000101'),
  'ep-nautica,ep-deportes,ep-tours,ep-adrenalina',
  'un insert de plusieurs lignes garde l''ordre d''insertion');

select is(ep_ficha('e71c0000-0000-4000-8000-000000000102'),
  'ep-deportes,ep-nautica,ep-tours',
  'des insertions successives se posent en fin de liste, même au même instant');

select is(
  (select position from product_tag_assignments
    where product_id = 'e71c0000-0000-4000-8000-000000000102'
      and tag_id = 'e71c0000-0000-4000-8000-000000000303'),
  3, 'le rang envoyé à l''insertion est ignoré : la nouvelle étiquette va en fin de liste');

-- ── 2. catalog_tag_ids_in_order ──────────────────────────────────────────────────────────────────
select is(
  catalog_tag_ids_in_order(jsonb_build_array(
    'e71c0000-0000-4000-8000-000000000303', 'pas-un-uuid', 'e71c0000-0000-4000-8000-000000000301',
    'e71c0000-0000-4000-8000-000000000303', 'e71c0000-0000-4000-8000-0000000003ff', 42)),
  array['e71c0000-0000-4000-8000-000000000303', 'e71c0000-0000-4000-8000-000000000301']::uuid[],
  'ordre du tableau gardé ; doublon, id malformé, id inconnu et non-texte écartés');

select is(catalog_tag_ids_in_order('{"pas":"un tableau"}'::jsonb), '{}'::uuid[],
  'un argument qui n''est pas un tableau rend un tableau vide');

-- ── 3. catalog_card_primary_tag_id ───────────────────────────────────────────────────────────────
select is(
  ep_slug(catalog_card_primary_tag_id(
    'e71c0000-0000-4000-8000-000000000101', 'activity', 'e71c0000-0000-4000-8000-00000000000a', false)),
  'ep-nautica', 'fiche : la première étiquette posée, pas la première par slug');

select is(
  ep_slug(catalog_card_primary_tag_id(
    null, 'lodging', 'e71c0000-0000-4000-8000-00000000000b', true)),
  'ep-precio', 'carte groupée : la première étiquette de l''établissement, jamais celle d''une chambre');

select is(
  ep_slug(catalog_card_primary_tag_id(
    'e71c0000-0000-4000-8000-000000000203', 'lodging', 'e71c0000-0000-4000-8000-00000000000c', false)),
  'ep-cabana', 'couchage unique : l''étiquette de l''établissement passe avant celle de la fiche');

-- ── 4. La vitrine, vue par un visiteur ───────────────────────────────────────────────────────────
set local role anon;

select is(
  (select array_agg(coalesce(categoria_slug, '(otras)'))
     from search_catalog_categorias(p_tipo => 'activity')
    where id = 'e71c0000-0000-4000-8000-000000000101'),
  array['ep-nautica'],
  'la vikinga ne figure que dans la catégorie de sa première étiquette');

select is(
  (select count(*)::int from search_catalog_categorias(p_tipo => 'activity')
    where categoria_slug = 'ep-adrenalina'),
  0, 'une catégorie que ne portent que des étiquettes SECONDAIRES n''apparaît pas');

select is(
  (select array_agg(slug order by slug) from search_catalog(p_limite => 100000, p_tag_slug => 'ep-deportes')
    where slug in ('ep-vikinga', 'ep-paseo')),
  array['ep-paseo'],
  'la page d''une catégorie ne montre que les cartes dont c''est la principale');

select is(
  (select array_agg(slug order by slug) from search_catalog(p_limite => 100000, p_tag_slug => 'ep-nautica')
    where slug in ('ep-vikinga', 'ep-paseo')),
  array['ep-vikinga'],
  '…dans les deux sens : le paseo, náutica en second, n''est pas rangé sous Náutica');

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_query => 'Adrenalina EP')
    where slug = 'ep-vikinga'),
  1, 'la recherche en texte libre trouve la vikinga par une étiquette SECONDAIRE');

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tipos => array['activity'], p_sin_tag => true)
    where slug in ('ep-vikinga', 'ep-paseo')),
  0, 'une carte classée n''est jamais dans « Otras »');

select is(
  (select array_agg(categoria_slug)
     from search_catalog_categorias(p_tipo => 'lodging')
    where id = 'e71c0000-0000-4000-8000-00000000000b'),
  array['ep-precio'],
  'carte groupée : une seule catégorie, la principale de l''établissement');

select is(
  (select array_agg(categoria_slug)
     from search_catalog_categorias(p_tipo => 'lodging')
    where id = 'e71c0000-0000-4000-8000-000000000203'),
  array['ep-cabana'],
  'couchage unique : une seule catégorie, celle de son établissement');

reset role;

-- ── 5. C'est `position` qui décide ───────────────────────────────────────────────────────────────
update product_tag_assignments set position = 0
 where product_id = 'e71c0000-0000-4000-8000-000000000101'
   and tag_id = 'e71c0000-0000-4000-8000-000000000304';

set local role anon;
select is(
  (select array_agg(categoria_slug)
     from search_catalog_categorias(p_tipo => 'activity')
    where id = 'e71c0000-0000-4000-8000-000000000101'),
  array['ep-adrenalina'],
  'remonter une étiquette en tête change la catégorie de la carte');
reset role;

-- ── 6. L'édition en ligne de l'admin : un réordonnancement est un changement ─────────────────────
set local role authenticated;
select test_login('e71c0000-0000-4000-8000-000000000031');

select is(
  admin_update_product_inline(
    'e71c0000-0000-4000-8000-000000000102',
    jsonb_build_object('tag_ids', jsonb_build_array(
      'e71c0000-0000-4000-8000-000000000301', 'e71c0000-0000-4000-8000-000000000302',
      'e71c0000-0000-4000-8000-000000000303'))
  ) ->> 'ok',
  'true', 'le même ensemble dans un autre ordre est accepté');

reset role;

select is(ep_ficha('e71c0000-0000-4000-8000-000000000102'),
  'ep-nautica,ep-deportes,ep-tours',
  '…et écrit : Náutica devient la principale du paseo');

select is(
  (select after -> 'tag_ids' from audit_log
    where entity_id = 'e71c0000-0000-4000-8000-000000000102'
    order by created_at desc limit 1),
  jsonb_build_array('e71c0000-0000-4000-8000-000000000301', 'e71c0000-0000-4000-8000-000000000302',
                    'e71c0000-0000-4000-8000-000000000303'),
  '…et audité, dans le nouvel ordre');

select is(
  (select before -> 'tag_ids' from audit_log
    where entity_id = 'e71c0000-0000-4000-8000-000000000102'
    order by created_at desc limit 1),
  jsonb_build_array('e71c0000-0000-4000-8000-000000000302', 'e71c0000-0000-4000-8000-000000000301',
                    'e71c0000-0000-4000-8000-000000000303'),
  '…l''état d''avant aussi, dans l''ordre où il était');

-- Le même ordre renvoyé tel quel : rien ne change, rien n'est audité de plus.
set local role authenticated;
select test_login('e71c0000-0000-4000-8000-000000000031');
select admin_update_product_inline(
  'e71c0000-0000-4000-8000-000000000102',
  jsonb_build_object('tag_ids', jsonb_build_array(
    'e71c0000-0000-4000-8000-000000000301', 'e71c0000-0000-4000-8000-000000000302',
    'e71c0000-0000-4000-8000-000000000303')));
reset role;

select is(
  (select count(*)::int from audit_log where entity_id = 'e71c0000-0000-4000-8000-000000000102'),
  1, 'renvoyer le même ordre n''écrit rien de plus');

select * from finish();
rollback;
