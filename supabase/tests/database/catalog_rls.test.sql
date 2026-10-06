-- Tranche 2 (catalogue) — RLS : lecture publique des produits vendables uniquement, écriture
-- réservée à l'admin, sur products et product_calendar.
begin;
select plan(23);

-- Helper local à cette transaction (jamais persisté, rollback en fin de fichier).
create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('33333333-3333-3333-3333-333333333333', 'Catalog Test Partner');

-- Feature 2 (products.establishment_id not null) : fixture ajoutée pour satisfaire la FK — sans
-- rapport avec ce qui est testé ici (RLS products/product_calendar, inchangée par cette feature).
insert into establishments (id, partner_id, name) values
  ('33330000-0000-4000-8000-000000000001', '33333333-3333-3333-3333-333333333333',
   jsonb_build_object('es', 'Catalog Test Establishment'));

insert into auth.users (id, email) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'catalog-admin@test.local'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'catalog-user@test.local');

insert into partner_capabilities (account_id, role, source, status)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333',
   '33330000-0000-4000-8000-000000000001',
   'activity', jsonb_build_object('es', 'Actividad publicada'), 100000, true, 'actividad-publicada'),
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333',
   '33330000-0000-4000-8000-000000000001',
   'activity', jsonb_build_object('es', 'Actividad no publicada'), 100000, false, 'actividad-no-publicada');

insert into product_calendar (product_id, date, open) values
  ('44444444-4444-4444-4444-444444444444', '2026-12-24', true);

-- lecture publique (anon) -----------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*) from products where id = '44444444-4444-4444-4444-444444444444')::int, 1,
  'anon voit un produit vendable (publié)'
);
select is(
  (select count(*) from products where id = '55555555-5555-5555-5555-555555555555')::int, 0,
  'anon ne voit pas un produit non vendable (non publié)'
);
select is(
  (select count(*) from product_calendar where product_id = '44444444-4444-4444-4444-444444444444')::int, 1,
  'anon lit le calendrier public'
);

-- authenticated non-admin : même restriction de lecture, écriture refusée -----
reset role;
set local role authenticated;
select test_login('ffffffff-ffff-ffff-ffff-ffffffffffff');

select is(
  (select count(*) from products where id = '55555555-5555-5555-5555-555555555555')::int, 0,
  'un compte non-admin ne voit pas un produit non vendable'
);
select throws_ok(
  $$ insert into products (partner_id, establishment_id, type, name, price_cop, slug)
     values ('33333333-3333-3333-3333-333333333333', '33330000-0000-4000-8000-000000000001',
             'activity', '{"es":"x"}', 1, 'x') $$,
  '42501'::char(5), null, 'un compte non-admin ne peut pas créer un produit'
);
-- L'UPDATE ne lève pas d'exception ici (contrairement à un GRANT révoqué en Tranche 1) : la
-- clause USING de la policy exclut la ligne de la sélection pour écriture, donc l'UPDATE
-- s'exécute normalement mais affecte 0 ligne — comportement RLS standard, pas une erreur.
update products set sellable = false
 where id = '44444444-4444-4444-4444-444444444444';

select is(
  (select sellable from products where id = '44444444-4444-4444-4444-444444444444'),
  true,
  'un compte non-admin ne peut pas modifier un produit (valeur inchangée)'
);
select throws_ok(
  $$ insert into product_calendar (product_id, date, open)
     values ('44444444-4444-4444-4444-444444444444', '2026-12-25', true) $$,
  '42501'::char(5), null, 'un compte non-admin ne peut pas écrire dans product_calendar'
);

-- Feature 4 : set_product_sellable par un non-admin échoue (RLS bloque l'UPDATE sous-jacent →
-- if not found → même message générique qu'un produit inexistant, cf. plan).
select throws_ok(
  $$ select set_product_sellable('44444444-4444-4444-4444-444444444444', false) $$,
  'P0001'::char(5), 'produit introuvable ou non autorisé',
  'set_product_sellable refuse un appelant non-admin'
);
select is(
  (select sellable from products where id = '44444444-4444-4444-4444-444444444444'),
  true,
  'sellable inchangé après un appel set_product_sellable refusé'
);

-- admin : voit tout, peut écrire ----------------------------------------------
reset role;
set local role authenticated;
select test_login('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

-- Aucune ligne audit_log n'a été créée par l'appel non-admin ci-dessus (vérifié ici, sous
-- l'admin, seul rôle qui peut lire audit_log).
-- Scopé au produit visé par le refus, jamais en absolu (audit_log d'une base seedée n'est pas vide).
select is(
  (select count(*) from audit_log where entity_id = '44444444-4444-4444-4444-444444444444')::int, 0,
  'aucune ligne audit_log créée par l''appel set_product_sellable refusé'
);

select is(
  (select count(*) from products where id = '55555555-5555-5555-5555-555555555555')::int, 1,
  'l''admin voit aussi les produits non publiés'
);
select lives_ok(
  $$ update products set sort = 1 where id = '44444444-4444-4444-4444-444444444444' $$,
  'l''admin peut modifier un produit'
);
-- Corrigé (correctif Tranche 2/3, calendrier appliqué) : product_calendar est reclassée
-- RPC-only — l'admin ne peut plus y écrire en direct, seule set_product_availability le peut
-- désormais (grants révoqués, product_calendar_write_admin supprimée). Ce test affirmait
-- l'inverse avant ce correctif ; couverture plus complète dans product_availability_rpc.test.sql.
select throws_ok(
  $$ insert into product_calendar (product_id, date, open)
     values ('44444444-4444-4444-4444-444444444444', '2026-12-26', false) $$,
  '42501'::char(5), null, 'l''admin ne peut plus écrire dans product_calendar en direct (RPC-only)'
);

-- Feature 2 : establishment_id obligatoire, y compris pour l'admin (contrainte not null, pas une
-- question de RLS — testé sous l'admin pour isoler cette cause précise, sans se mélanger avec le
-- refus RLS déjà prouvé ci-dessus pour un non-admin).
select throws_ok(
  $$ insert into products (partner_id, type, name, price_cop, slug)
     values ('33333333-3333-3333-3333-333333333333', 'activity', '{"es":"Sin establecimiento"}',
             1, 'sin-establecimiento') $$,
  '23502'::char(5), null, 'establishment_id est obligatoire, même pour l''admin (contrainte not null)'
);

-- Feature 3 : price_cop <= 0 rejeté par products_price_cop_positive (pas une question de RLS,
-- le refus d'écriture non-admin reste couvert plus haut, pas de doublon — cf. plan).
select throws_ok(
  $$ insert into products (partner_id, establishment_id, type, name, price_cop, slug)
     values ('33333333-3333-3333-3333-333333333333', '33330000-0000-4000-8000-000000000001',
             'activity', '{"es":"Precio invalido"}', 0, 'precio-invalido') $$,
  '23514'::char(5), null, 'price_cop <= 0 est rejeté par products_price_cop_positive'
);

-- Feature 4 : set_product_sellable par l'admin sur un produit existant — sellable mis à jour et
-- une ligne audit_log correcte (action/before/after).
select lives_ok(
  $$ select set_product_sellable('55555555-5555-5555-5555-555555555555', true, 'publicación de prueba') $$,
  'set_product_sellable réussit pour l''admin sur un produit existant'
);
select is(
  (select sellable from products where id = '55555555-5555-5555-5555-555555555555'),
  true,
  'sellable mis à jour par l''appel admin'
);
select is(
  (select count(*) from audit_log where entity_id = '55555555-5555-5555-5555-555555555555')::int,
  1,
  'une ligne audit_log créée par l''appel admin réussi'
);
select is(
  (select jsonb_build_object('action', action, 'before', before, 'after', after)
     from audit_log where entity_id = '55555555-5555-5555-5555-555555555555'),
  jsonb_build_object(
    'action', 'product.publish',
    'before', jsonb_build_object('sellable', false),
    'after', jsonb_build_object('sellable', true)
  ),
  'audit_log enregistre action/before/after corrects'
);

-- Feature 4 : product_id inexistant → même exception que le refus non-admin (comportement voulu,
-- pas une régression — aucune fuite d'information sur la cause réelle de l'échec).
select throws_ok(
  $$ select set_product_sellable('99999999-0000-0000-0000-000000000000', true) $$,
  'P0001'::char(5), 'produit introuvable ou non autorisé',
  'set_product_sellable sur un product_id inexistant échoue avec le même message que le refus non-admin'
);

-- ===== establishments_select_public exige status = 'active' (20260827270000) ====================
-- Un établissement ARCHIVÉ portant un produit vendable ne doit pas être lisible par un anonyme :
-- `status` fait partie du grant colonne accordé à anon, donc sans condition dans la policy, un
-- simple GET sur PostgREST exposait nom, description, adresse et horaires d'un lieu dépublié.
-- L'admin, lui, continue de le voir — par establishments_select, qui n'a pas de condition de statut.
reset role;
insert into establishments (id, partner_id, name, status) values
  ('33330000-0000-4000-8000-000000000002', '33333333-3333-3333-3333-333333333333',
   jsonb_build_object('es', 'Establecimiento Archivado'), 'archived');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('44444444-4444-4444-4444-000000000002', '33333333-3333-3333-3333-333333333333',
   '33330000-0000-4000-8000-000000000002',
   'activity', jsonb_build_object('es', 'Actividad de archivado'), 100000, true, 'actividad-archivada');

-- Les claims d'un cas précédent survivent à `set local role` — sans ce reset, `auth.uid()` renvoie
-- encore l'admin et c'est establishments_select (qui n'a pas de condition de statut) qui répond.
-- Constaté en écrivant ce cas : le test passait pour la mauvaise raison.
select set_config('request.jwt.claims', null, true);
set local role anon;
select is(
  (select count(*)::int from establishments where id = '33330000-0000-4000-8000-000000000002'),
  0,
  'anon ne lit PAS un établissement archivé, même s''il porte un produit vendable'
);
select is(
  (select count(*)::int from establishments where id = '33330000-0000-4000-8000-000000000001'),
  1,
  'anon lit toujours un établissement actif portant un produit vendable (non-régression)'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'role', 'authenticated')::text, true);
select is(
  (select count(*)::int from establishments where id = '33330000-0000-4000-8000-000000000002'),
  1,
  'l''admin voit l''établissement archivé — establishments_select n''a pas de condition de statut'
);

select * from finish();
rollback;
