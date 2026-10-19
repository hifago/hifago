-- Prérequis du correctif Tranche 1 (granularité par établissement de la capacité operator) —
-- RLS directe sur establishments (feature 1, table minimale seulement) : lecture admin + compte du
-- partenaire propriétaire, écriture réservée à l'admin. Même pattern que products_write_admin
-- (Tranche 2, cf. catalog_rls.test.sql) : une policy "for all using(...)" sans with check explicite
-- réutilise la clause using comme with check, donc un INSERT non-admin lève une exception (42501)
-- alors qu'un UPDATE non-admin s'exécute silencieusement sans affecter la ligne exclue.
--
-- Feature 1 — RPC create_establishment : capacité operator en attente liée (pas dupliquée),
-- nouvelle ligne operator pour un partenaire ayant déjà un établissement, appel non-admin refusé.
begin;
select plan(20);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('99999999-9999-9999-9999-999999999999', 'Establishment Test Partner Owner'),
  ('88888888-8888-8888-8888-888888888888', 'Establishment Test Partner Other');

insert into auth.users (id, email) values
  ('99990000-0000-4000-8000-000000000001', 'estab-admin@test.local'),
  ('99990000-0000-4000-8000-000000000002', 'estab-owner@test.local'),
  ('99990000-0000-4000-8000-000000000003', 'estab-stranger@test.local');

insert into partner_capabilities (account_id, role, source, status)
  values ('99990000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

update partner_accounts set partner_id = '99999999-9999-9999-9999-999999999999'
  where id = '99990000-0000-4000-8000-000000000002';
update partner_accounts set partner_id = '88888888-8888-8888-8888-888888888888'
  where id = '99990000-0000-4000-8000-000000000003';

insert into establishments (id, partner_id, name) values
  ('c1111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999999',
   jsonb_build_object('es', 'Hostal de Prueba'));

-- lecture : propriétaire voit sa fiche, un autre partenaire ne la voit pas --------------------
set local role authenticated;
select test_login('99990000-0000-4000-8000-000000000002');
select is(
  (select count(*) from establishments where id = 'c1111111-1111-1111-1111-111111111111')::int, 1,
  'le compte du partenaire propriétaire voit son établissement'
);

select test_login('99990000-0000-4000-8000-000000000003');
select is(
  (select count(*) from establishments where id = 'c1111111-1111-1111-1111-111111111111')::int, 0,
  'un autre partenaire ne voit pas l''établissement'
);

-- écriture refusée pour un non-admin (INSERT lève, UPDATE affecte 0 ligne) --------------------
select throws_ok(
  $$ insert into establishments (partner_id, name)
     values ('88888888-8888-8888-8888-888888888888', '{"es":"Forge"}') $$,
  '42501'::char(5), null, 'un compte non-admin ne peut pas créer un établissement'
);

set local role authenticated;
select test_login('99990000-0000-4000-8000-000000000002');
update establishments set name = jsonb_build_object('es', 'Maquillé')
 where id = 'c1111111-1111-1111-1111-111111111111';
select is(
  (select name from establishments where id = 'c1111111-1111-1111-1111-111111111111'),
  jsonb_build_object('es', 'Hostal de Prueba'),
  'le propriétaire (non-admin) ne peut pas modifier sa propre fiche établissement (valeur inchangée)'
);

-- admin : voit tout, peut écrire ----------------------------------------------------------------
select test_login('99990000-0000-4000-8000-000000000001');
select is(
  (select count(*) from establishments where id = 'c1111111-1111-1111-1111-111111111111')::int, 1,
  'l''admin voit l''établissement d''un partenaire quelconque'
);
select lives_ok(
  $$ insert into establishments (partner_id, name)
     values ('88888888-8888-8888-8888-888888888888', '{"es":"Nuevo"}') $$,
  'l''admin peut créer un établissement'
);
select lives_ok(
  $$ update establishments set name = jsonb_build_object('es', 'Renombrado')
     where id = 'c1111111-1111-1111-1111-111111111111' $$,
  'l''admin peut modifier un établissement existant'
);

-- create_establishment (feature 1) ---------------------------------------------------------------
-- Retour au rôle par défaut (postgres, bypass RLS) pour les fixtures : partner_capabilities est
-- RPC-only (grants insert/update/delete révoqués, cf. correctif Tranche 1) — même le compte admin
-- encore actif ci-dessus (role authenticated) ne peut pas y écrire en direct, seule la RPC
-- create_establishment (security definer) le peut.
reset role;
insert into partners (id, display_name) values
  ('a9990001-0000-4000-8000-000000000001', 'Pending Operator Partner'),
  ('a9990002-0000-4000-8000-000000000002', 'Established Operator Partner');

-- Partenaire "pending" : referrer actif + operator active MAIS sans établissement encore rattaché
-- (establishment_id null), exactement ce que consume_partner_invitation produit aujourd'hui pour un
-- onboarding_path='provider' (statut 'active' par défaut de la colonne depuis
-- 20260820010000_partner_capabilities_active_by_default.sql — "pending" ici qualifie l'absence
-- d'établissement, plus un statut de capacité intermédiaire, retiré ce jour-là).
insert into partner_capabilities (partner_id, role, source, status) values
  ('a9990001-0000-4000-8000-000000000001', 'referrer', 'newp', 'active'),
  ('a9990001-0000-4000-8000-000000000001', 'operator', 'newp', 'active');

-- Partenaire "established" : referrer actif + operator déjà rattaché à un établissement existant.
insert into partner_capabilities (partner_id, role, source, status) values
  ('a9990002-0000-4000-8000-000000000002', 'referrer', 'newp', 'active');
insert into establishments (id, partner_id, name) values
  ('a9990002-0000-4000-8000-000000000003', 'a9990002-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento existente'));
insert into partner_capabilities (partner_id, establishment_id, role, source, status) values
  ('a9990002-0000-4000-8000-000000000002', 'a9990002-0000-4000-8000-000000000003',
   'operator', 'admin', 'active');

-- Fixtures posées, on repasse en authenticated/admin pour appeler la RPC comme un vrai client le
-- ferait (auth.uid() résolu depuis les claims, pas depuis le bypass postgres).
set local role authenticated;
select test_login('99990000-0000-4000-8000-000000000001');

select lives_ok(
  $$ select create_establishment('a9990001-0000-4000-8000-000000000001',
       jsonb_build_object('es', 'Nuevo Establecimiento Pending'), p_contact_phone => '+573001234567') $$,
  'create_establishment réussit pour un partenaire avec capacité operator en attente'
);
select is(
  (select count(*) from partner_capabilities
    where partner_id = 'a9990001-0000-4000-8000-000000000001' and role = 'operator')::int,
  1,
  'la ligne operator en attente est liée au nouvel établissement, pas dupliquée'
);
select is(
  (select establishment_id from partner_capabilities
    where partner_id = 'a9990001-0000-4000-8000-000000000001' and role = 'operator'),
  (select id from establishments where partner_id = 'a9990001-0000-4000-8000-000000000001'),
  'la ligne operator (auparavant en attente) est bien rattachée au nouvel établissement créé'
);

select lives_ok(
  $$ select create_establishment('a9990002-0000-4000-8000-000000000002',
       jsonb_build_object('es', 'Segundo Establecimiento'), p_contact_phone => '+573001234567') $$,
  'create_establishment réussit pour un partenaire ayant déjà un établissement'
);
select is(
  (select count(*) from partner_capabilities
    where partner_id = 'a9990002-0000-4000-8000-000000000002' and role = 'operator')::int,
  2,
  'une NOUVELLE ligne operator est créée pour le nouvel établissement, pas fusionnée avec l''existante'
);

-- appel non-admin → exception, aucun établissement créé ------------------------------------------
select test_login('99990000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select create_establishment('a9990001-0000-4000-8000-000000000001',
       jsonb_build_object('es', 'Forge'), p_contact_phone => '+573001234567') $$,
  '42501'::char(5),
  'create_establishment réservé au rôle admin',
  'create_establishment refuse un appelant non-admin'
);
select is(
  (select count(*) from establishments where name = jsonb_build_object('es', 'Forge'))::int, 0,
  'aucun établissement créé par l''appel non-admin refusé'
);

-- set_establishment_status (2026-08-20, migration 20260820020000_establishment_publish_toggle.sql)
-- — même patron que set_product_sellable (catalog_rls.test.sql) : security invoker, RLS
-- establishments_write_admin gate déjà l'UPDATE, message générique "introuvable ou non autorisé"
-- pour un non-admin comme pour un id inexistant. Toujours connecté '...002' (owner, non-admin) à
-- ce stade.
select throws_ok(
  $$ select set_establishment_status('c1111111-1111-1111-1111-111111111111', 'archived') $$,
  'P0001'::char(5), 'establecimiento introuvable ou non autorisé',
  'set_establishment_status refuse un appelant non-admin (même propriétaire de l''établissement)'
);
select is(
  (select status from establishments where id = 'c1111111-1111-1111-1111-111111111111'),
  'active',
  'status inchangé après un appel set_establishment_status refusé'
);

reset role;
set local role authenticated;
select test_login('99990000-0000-4000-8000-000000000001'); -- admin

select lives_ok(
  $$ select set_establishment_status('c1111111-1111-1111-1111-111111111111', 'archived', 'prueba') $$,
  'set_establishment_status réussit pour l''admin'
);
select is(
  (select status from establishments where id = 'c1111111-1111-1111-1111-111111111111'),
  'archived',
  'status mis à jour par l''appel admin'
);
select is(
  (select count(*) from audit_log
    where entity_id = 'c1111111-1111-1111-1111-111111111111' and action = 'establishment.unpublish')::int,
  1,
  'une ligne audit_log establishment.unpublish créée par l''appel admin réussi'
);
select throws_ok(
  $$ select set_establishment_status('c1111111-1111-1111-1111-111111111111', 'bogus') $$,
  'P0001'::char(5), null,
  'set_establishment_status refuse un statut invalide'
);

select * from finish();
rollback;
